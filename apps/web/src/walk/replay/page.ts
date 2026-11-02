/**
 * Mouse look replay (PL13, dev only: never a route, never in the app build). The real walk controller, look.ts and
 * the shoulder rig run in a real browser at its own refresh rate. Recorded and synthetic locked mouse streams are
 * fed in as they would arrive, every event at its own time and drawn on the next animation frame, and the page
 * measures how far the camera turned per count and whether anything turns after the hand stops.
 *
 * The lock is a stand-in (as in mouse-look.test.ts), so the run never takes the real cursor of the machine it runs
 * on. Served by replay.mjs; read the result from the still.
 */
import * as THREE from 'three';
import type { RealmWalkerPose } from '../../realm/client';
import { createWalkController, LOOK, type WalkRealm } from '../index';
import { wrapAngle } from '../input/direction';

type Move = readonly [at: number, dx: number, dy: number];
interface Stream { readonly name: string; readonly filter: boolean; readonly moves: readonly Move[]; readonly hand: { x: number; y: number } }

/** Recorded by Tobias in the mouse lab (Linux, Firefox 158 on X11, 343 fps), as in look.test.ts. */
const FIREFOX_X11_ECHOES: readonly (readonly [number, number])[] = [[0, 1], [-978, 105], [0, 1], [-978, 106], [1, 0], [-977, 106], [0, 1], [-977, 107],
  [1, 0], [-976, 107], [1, 0], [-974, 107], [1, 0], [-973, 107], [1, 0], [-972, 107], [1, 0], [-971, 107], [-971, 106], [1, 0], [-970, 106], [0, -1],
  [-970, 105], [0, -1], [-970, 104], [0, -1], [-970, 103], [0, -1], [-970, 102], [0, -1], [-970, 101], [0, -1], [-970, 100], [-1, 0], [-971, 100],
  [-1, 0], [-972, 100], [-1, 0], [-973, 100], [-974, 100]];

const sum = (moves: readonly (readonly [number, number])[]) => moves.reduce((s, [x, y]) => ({ x: s.x + x, y: s.y + y }), { x: 0, y: 0 });

function steady(perPoll: number, ms: number): Stream {
  const moves: Move[] = [];
  for (let at = 1; at <= ms; at++) moves.push([at, perPoll, 0]);
  return { name: `A steady turn, 1000 Hz mouse, ${perPoll} counts a poll for ${ms} ms`, filter: false, moves, hand: { x: perPoll * ms, y: 0 } };
}
function flick(): Stream {
  // A fast flick as Windows Chrome delivers it at 1000 Hz: a bell up to 80 counts a poll and back, 2,400 counts.
  const moves: Move[] = [];
  let hand = 0;
  for (let i = 0; i < 60; i++) { const dx = Math.round(80 * Math.sin(Math.PI * (i + .5) / 60)); moves.push([i + 1, dx, 0]); hand += dx; }
  return { name: 'A fast flick, 1000 Hz mouse, up to 80 counts a poll', filter: false, moves, hand: { x: hand, y: 0 } };
}
function recorded(filter: boolean): Stream {
  const moves: Move[] = FIREFOX_X11_ECHOES.map(([x, y], i) => [2 + i * 2, x, y]);
  const hand = sum(FIREFOX_X11_ECHOES.filter(([x, y]) => Math.abs(x) < 50 && Math.abs(y) < 50));
  return { name: `Tobias's recorded Firefox X11 stream, ${FIREFOX_X11_ECHOES.length} events`, filter, moves, hand };
}
function echoing(from: readonly [number, number], ms: number): Stream {
  // Firefox on X11: each real count (500 Hz) is followed by the hidden cursor's offset, drifting with the hand.
  const moves: Move[] = [];
  let ox = from[0], oy = from[1], hx = 0, hy = 0;
  for (let at = 2; at <= ms; at += 2) {
    const [rx, ry] = at % 4 ? [1, 0] : [0, 1];
    moves.push([at, rx, ry]); hx += rx; hy += ry; ox += rx; oy += ry;
    moves.push([at, ox, oy]);
  }
  return { name: `Firefox X11 echoes, slow look for ${ms / 1000} s, lock begun ${from.join(', ')} from the centre`, filter: true, moves, hand: { x: hx, y: hy } };
}

const STREAMS: readonly Stream[] = [steady(3, 300), flick(), recorded(true), echoing([-978, 105], 2000), echoing([6, -3], 2000), echoing([-40, 0], 2000)];
const STILL_MS = 1500;

const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));

async function measureHz() {
  const first = await frame();
  let frames = 0, last = first;
  while (last - first < 1000) { last = await frame(); frames++; }
  return frames / ((last - first) / 1000);
}

interface Result { readonly frames: number; readonly turned: number; readonly residual: number }

async function play(stream: Stream): Promise<Result> {
  const keyboard = new EventTarget(), page = Object.assign(new EventTarget(), { hidden: false });
  const lockDocument = Object.assign(new EventTarget(), { pointerLockElement: null as unknown, exitPointerLock() {} });
  const surface = Object.assign(new EventTarget(), {
    clientWidth: 1440, clientHeight: 900, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }),
    requestPointerLock() { lockDocument.pointerLockElement = surface; lockDocument.dispatchEvent(new Event('pointerlockchange')); },
  });
  const self = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, placement: 0 };
  const signal = Object.assign(() => {}, { remove() {} });
  const realm: WalkRealm = {
    selfId: 'me',
    room: { onLeave: signal, onDrop: signal, state: { collisionRevision: 1, walkers: { get: () => self } } },
    tick: () => [{ id: 'me', name: 'Replay', look: 'a', homeSlot: 65535, ...self, distance: 0, self: true } as RealmWalkerPose],
  };
  let clock = performance.now();
  const controller = createWalkController({ camera: new THREE.PerspectiveCamera(), surface, realm, keyboard, page, lockDocument, coarse: false,
    clock: () => clock, heading: 0, keyboardLock: null, echoFilter: stream.filter });
  const begin = await frame();
  clock = begin; controller.frame(begin);
  controller.cursor.capture({ isTrusted: true, type: 'pointerdown', button: 0 });
  await Promise.resolve(); await Promise.resolve();
  const start = controller.debug.camera.yaw;
  const end = stream.moves.at(-1)![0];
  let next = 0, frames = 0, now = begin;
  // Every event arrives at its own time and is drawn on the next frame, as a browser delivers locked mousemove.
  while (next < stream.moves.length) {
    now = await frame(); frames++;
    while (next < stream.moves.length && begin + stream.moves[next]![0] <= now) {
      const [at, movementX, movementY] = stream.moves[next++]!;
      clock = begin + at;
      lockDocument.dispatchEvent(Object.assign(new Event('mousemove'), { movementX, movementY }));
    }
    clock = now; controller.frame(now);
  }
  // Past the filter's longest hold, then the hand rests: nothing may turn from here on.
  while (now - begin < end + 50) { now = await frame(); frames++; clock = now; controller.frame(now); }
  const turned = wrapAngle(start - controller.debug.camera.yaw);
  const after = controller.debug.camera.yaw;
  const rest = now;
  while (now - rest < STILL_MS) { now = await frame(); frames++; clock = now; controller.frame(now); }
  const residual = Math.abs(wrapAngle(after - controller.debug.camera.yaw));
  controller.dispose();
  return { frames, turned, residual };
}

async function run() {
  const hz = await measureHz();
  (document.getElementById('env') as HTMLElement).textContent =
    `${navigator.userAgent.match(/(Firefox|Chrome)\/[\d.]+/)?.[0] ?? navigator.userAgent} · ${hz.toFixed(0)} frames a second measured · ` +
    `dpr ${devicePixelRatio} · LOOK.radiansPerPx ${LOOK.radiansPerPx} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const rows = document.getElementById('rows') as HTMLElement;
  const results = [];
  for (const stream of STREAMS) {
    const { frames, turned, residual } = await play(stream);
    const counts = turned / LOOK.radiansPerPx, error = counts - stream.hand.x;
    const perCount = stream.hand.x ? turned / stream.hand.x : 0;
    const ok = Math.abs(error) <= 3 && residual === 0;
    results.push({ name: stream.name, filter: stream.filter, frames, hand: stream.hand.x, counts, error, perCount, residual, ok });
    const row = document.createElement('tr');
    for (const [text, cls] of [[stream.name, ''], [stream.filter ? 'Firefox' : 'none', ''], [String(frames), ''], [String(stream.hand.x), ''],
      [counts.toFixed(2), ''], [(Math.abs(error) < .005 ? 0 : error).toFixed(2), ''], [`${perCount.toFixed(6)} rad`, ''], [`${residual} rad`, ''], [ok ? 'pass' : 'FAIL', ok ? 'ok' : 'bad']] as const) {
      const cell = document.createElement('td'); cell.textContent = text; if (cls) cell.className = cls; row.append(cell);
    }
    rows.append(row);
  }
  Object.assign(window, { __replay: { hz, results }, __chatdomReady: true });
}

void run();
