/**
 * A dev-only bench for the door between two rooms: the real transfer and curtain over a still of a dusk street, with a
 * stand-in room behind the door. Served by the web dev server at /src/play/bench/portal.html; never in the build.
 *
 * Query: state=closed|stranded|refused|journey · reduced=1. `journey` runs in, waits, and back out, with the sounds.
 * window.__door.enter() and .leave() drive it by hand.
 */
import type { KingdomId } from '@chatdom/shared';
import backdrop from '../../../../../work/evidence/PL03/street-final@1920x1080.png?url';
import { createPortalCurtain } from '../hud/portal-curtain';
import { createPortalTransfer, type PortalDescriptor } from '../portal';
import './bench.css';

const query = new URLSearchParams(location.search);
const stage = document.querySelector<HTMLDivElement>('#stage')!;
stage.style.setProperty('--bench-backdrop', `url("${backdrop}")`);
const reduced = query.get('reduced') === '1';
const state = query.get('state') ?? 'journey';
const kingdomId = '1' as KingdomId;
const door: PortalDescriptor = { id: 'bench-door', kingdomId, sourceRoom: 'kingdom', destinationRoom: 'bench-room',
  entryAnchor: { feet: [0, 0, 0], yaw: 0 }, returnAnchor: { feet: [0, 0, 0], yaw: 0 } };
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
let failBack = state === 'stranded';
const transfer = createPortalTransfer({ curtain: () => createPortalCurtain({ reducedMotion: () => reduced }), readyMs: 4000 });
transfer.bindSource({ kingdomId, title: 'Lanternmere', endpoint: 'bench', self: null,
  entry: { kingdomId, resumeScope: 'bench-scope-0123456789', ticket: async () => { throw new Error('The bench has no realm.'); } },
  leave: async () => { await wait(120); stage.style.visibility = 'hidden'; },
  rejoin: async () => { await wait(300); if (failBack) { failBack = false; throw new Error('bench: the way back is shut once'); } stage.style.visibility = ''; } });
transfer.registerDestination({ room: 'bench-room', title: 'The tavern', mount(host) {
  // A stand-in room: warm plaster and a hearth glow, so the curtain has something to open onto.
  const room = document.createElement('div');
  room.style.cssText = 'position:absolute;inset:0;background:radial-gradient(ellipse 60% 50% at 50% 70%,#e09a4f 0%,#7a3f1f 45%,#2a160c 100%)';
  host.append(room);
  return { ready: state === 'refused' ? wait(500).then(() => { throw new Error('bench: refused'); }) : wait(600), dispose: () => { room.remove(); } };
} });
Object.assign(window, { __door: { transfer, enter: () => transfer.enter(door), leave: () => transfer.leave() } });

const ready = (window as Window & { __chatdomReady?: boolean });
void document.fonts.ready.then(async () => {
  if (state === 'closed') {
    // Hold the curtain closed going in, for a still.
    const curtain = createPortalCurtain({ reducedMotion: () => reduced });
    await curtain.close({ label: 'Through the door', title: 'The tavern' });
  } else if (state === 'stranded') {
    void transfer.enter(door).then(() => transfer.leave());
    await wait(3200);
  } else if (state === 'refused') {
    await transfer.enter(door);
    await wait(500);
  }
  ready.__chatdomReady = true;
});
