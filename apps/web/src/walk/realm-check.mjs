// The realm client's movement boundary in two real browsers: fixed-step staging on slow frames, one jump per
// press, a published collision revision, a room placement, and every PLAYER_FIELDS field against the room's own.
// It runs the actual KingdomRoom (uWS, dev reference services, memory only) in this process so it can publish
// a revision like an authority, and the dev court page from a vite dev server. It is a diagnostic of the
// Predict/revision boundary, not kingdom acceptance: that is `capture.mjs` on the kingdom's own walk entry.
// Usage: node apps/web/src/walk/realm-check.mjs [--realm-port 5188] [--web-port 5189] [--out shots/walk/wc06]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const { values } = parseArgs({ options: {
  'realm-port': { type: 'string', default: '5188' }, 'web-port': { type: 'string', default: '5189' },
  out: { type: 'string', default: 'shots/walk/wc06' },
} });
const realmPort = Number(values['realm-port']), webPort = Number(values['web-port']);
for (const port of [realmPort, webPort]) assertCapturePort(port);
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'grounded', 'yaw', 'distance', 'collisionRevision'];
const WALL_X = 4.5, RADIUS = .28, FACE = WALL_X - RADIUS;
const LAUNCH = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox',
  // The court page asks for the realm on 5191; this check's own room listens elsewhere.
  `--host-rules=MAP 127.0.0.1:5191 127.0.0.1:${realmPort}`];
const log = { started: new Date().toISOString(), realm: `127.0.0.1:${realmPort} (dev reference services, memory only)`, page: '', steps: {} };
const problems = [];
const check = (ok, message) => { if (!ok) throw new Error(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const release = await acquireCaptureLock();
let loader, web, realm, browser;
try {
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
  const { createRealmServer } = await loader.ssrLoadModule('/apps/realm/src/server.ts');
  const { referenceServices } = await loader.ssrLoadModule('/apps/realm/src/reference.ts');
  const { REFERENCE_BLOCKS } = await loader.ssrLoadModule('/packages/world/src/realm/reference.ts');
  const wallBlocks = [...REFERENCE_BLOCKS, { min: [WALL_X, 0, -18], max: [WALL_X + .2, 3, 18] }];
  const revision2 = { revision: 2, query: bounds => wallBlocks.filter(b => b.min.every((n, axis) => n <= bounds.max[axis] && b.max[axis] >= bounds.min[axis])) };
  const base = referenceServices();
  let effects;
  const services = { auth: base.auth, open: async id => {
    const handle = await base.open(id);
    return { ...handle, bindRoom: bound => { effects = bound; return handle.bindRoom(bound); } };
  } };
  const created = createRealmServer(services);
  realm = created.server;
  created.transport.app.post('/reference/session', response => {
    response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store').writeHeader('Content-Type', 'application/json').end(JSON.stringify(base.issue()));
  });
  await realm.listen(realmPort, '127.0.0.1');

  web = await createServer({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts`, logLevel: 'error', server: { host: '127.0.0.1', port: webPort, strictPort: true, hmr: false } });
  await web.listen();
  const url = `http://127.0.0.1:${webPort}/-/realm`;
  log.page = url;

  browser = await chromium.launch({ channel: 'chrome', headless: true, args: LAUNCH });
  const sizes = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true }];
  const pages = [];
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch });
    const page = await context.newPage();
    page.on('pageerror', error => problems.push(`${size.name}: ${error.message}`));
    page.on('console', message => {
      const text = message.text();
      if (message.type() === 'error' && !(message.location().url ?? '').endsWith('/favicon.ico')) problems.push(`${size.name}: ${text}`);
      if (message.type() === 'warning' && /@colyseus\/sdk/.test(text)) problems.push(`${size.name}: ${text}`);
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    pages.push({ ...size, page });
  }
  for (const { name, page } of pages) {
    await page.waitForFunction(() => window.__chatdomWalk?.ready === true && !!window.__chatdomRealm?.client, null, { timeout: 120_000 })
      .catch(() => { throw new Error(`${name}: the court never placed a connected citizen`); });
  }
  const [desk, phone] = pages;
  const id = page => page.evaluate(() => window.__chatdomRealm.client.selfId);
  const deskId = await id(desk.page), phoneId = await id(phone.page);
  check(deskId !== phoneId, 'Both browsers were given the same citizen');
  const truth = walkerId => { const p = effects.readWalker(walkerId); return Object.fromEntries(FIELDS.map(f => [f, p[f]])); };
  const predicted = page => page.evaluate(fields => Object.fromEntries(fields.map(f => [f, window.__chatdomRealm.client.predicted[f]])), FIELDS);
  // An idle walker's state stops changing, and the court keeps sending idle inputs every frame: wait until the
  // prediction and the room's own walker hold the same value in every field.
  const agree = async (page, walkerId, label) => {
    const end = Date.now() + 10_000;
    for (;;) {
      const local = await predicted(page), room = truth(walkerId);
      const differ = FIELDS.filter(f => local[f] !== room[f]);
      if (differ.length === 0) return room;
      if (Date.now() > end) throw new Error(`${label}: predicted and room disagree in ${differ.join(', ')}: ${JSON.stringify({ local, room })}`);
      await pause(100);
    }
  };
  const seenBy = async (page, walkerId, room, label) => {
    await page.waitForFunction(({ walkerId, x, z }) => { const p = window.__chatdomRealm.client.room.state.walkers.get(walkerId); return !!p && p.x === x && p.z === z; }, { walkerId, x: room.x, z: room.z }, { timeout: 10_000 })
      .catch(() => { throw new Error(`${label}: the other browser does not hold the walker where the room put it`); });
  };

  // 1. Slow rendering: each frame blocks ~90 ms. Count the inputs each frame sends while Shift+W runs.
  await desk.page.evaluate(() => {
    const client = window.__chatdomRealm.client, handle = client.room.input({ mode: 'reliable' }), send = handle.send.bind(handle);
    const record = window.__wc06 = { frames: [], current: 0, sends: [], slow: true };
    handle.send = () => { record.current++; const d = handle.data; record.sends.push({ buttons: d.buttons, collisionRevision: d.collisionRevision }); return send(); };
    const frame = () => {
      record.frames.push(record.current); record.current = 0;
      if (record.slow) { const end = window.performance.now() + 90; while (window.performance.now() < end) { /* a slow renderer */ } }
      window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
  });
  const start = truth(deskId);
  await desk.page.mouse.move(desk.width * .7, desk.height * .45);
  await desk.page.keyboard.down('ShiftLeft'); await desk.page.keyboard.down('KeyW');
  await pause(1500);
  await desk.page.keyboard.up('KeyW'); await desk.page.keyboard.up('ShiftLeft');
  const sendsBeforeJump = await desk.page.evaluate(() => window.__wc06.sends.length);
  await desk.page.keyboard.down('Space'); await pause(1000); await desk.page.keyboard.up('Space');
  await pause(400);
  const slow = await desk.page.evaluate(() => { const r = window.__wc06; r.slow = false; return { frames: r.frames, sends: r.sends }; });
  const walkFrames = slow.frames.filter(n => n > 0);
  const histogram = {}; for (const n of slow.frames) histogram[n] = (histogram[n] ?? 0) + 1;
  const jumps = slow.sends.slice(sendsBeforeJump).filter(s => s.buttons & 2).length;
  check(walkFrames.filter(n => n >= 2).length > 5, `slow frames never staged several fixed inputs: ${JSON.stringify(histogram)}`);
  check(jumps === 1, `holding Space through slow frames sent ${jumps} jumps`);
  const afterWalk = await agree(desk.page, deskId, 'slow walk');
  check(Math.hypot(afterWalk.x - start.x, afterWalk.z - start.z) > 3, 'Shift+W did not move the authoritative citizen');
  await seenBy(phone.page, deskId, afterWalk, 'slow walk');
  log.steps.slowWalk = { inputsPerFrame: histogram, jumpBitsWhileSpaceHeld: jumps, from: start, room: afterWalk, predictedEqualsRoom: true, phoneHoldsRoomPosition: true };

  // 2. A published wall. The court page has only revision 1, so it must hold prediction and show the room's walk.
  check(effects.placeWalker(deskId, [WALL_X - 3, 0, 7], 1), 'the room refused a clear placement');
  await agree(desk.page, deskId, 'placement before publication');
  await desk.page.evaluate(() => {
    const record = window.__wc06; record.drawn = []; record.held = 0; record.frames2 = 0;
    const each = () => {
      const self = window.__chatdomWalk.self, client = window.__chatdomRealm.client;
      if (self) record.drawn.push(self.x);
      record.frames2++; if (!client.predicting) record.held++;
      record.furthest = Math.max(record.furthest ?? -Infinity, client.predicted.x, self?.x ?? -Infinity);
      if (record.watch) window.requestAnimationFrame(each);
    };
    record.watch = true; window.requestAnimationFrame(each);
  });
  const positions = new Map();
  for (const walkerId of [deskId, phoneId]) { const p = effects.readWalker(walkerId); positions.set(walkerId, walkerId === deskId ? [WALL_X - 4, 0, 7] : [p.x, p.y, p.z]); }
  effects.adoptWorld(revision2, 'reference-court-v2', positions);
  await pause(800);
  const popped = await desk.page.evaluate(({ a, b }) => window.__wc06.drawn.every(x => Math.abs(x - a) < .01 || Math.abs(x - b) < .01), { a: WALL_X - 3, b: WALL_X - 4 });
  check(popped, 'the published placement was glided rather than drawn at once');
  await desk.page.evaluate(() => window.__chatdomRealm.setInput({ moveX: 127, moveZ: 0, buttons: 1, yaw: 64 }));
  await pause(2000);
  await desk.page.evaluate(() => window.__chatdomRealm.setInput(null));
  const atWall = await desk.page.evaluate(() => { const r = window.__wc06; r.watch = false; return { furthest: r.furthest, held: r.held, frames: r.frames2, predicting: window.__chatdomRealm.client.predicting, revision: window.__chatdomRealm.client.room.state.collisionRevision }; });
  const wallRoom = truth(deskId);
  check(atWall.revision === 2 && wallRoom.collisionRevision === 2, 'the room did not publish revision 2');
  check(!atWall.predicting && atWall.held > atWall.frames * .9, 'the court predicted a revision it does not have');
  check(atWall.furthest <= FACE + 1e-9, `the court drew its citizen at x ${atWall.furthest}, inside the published wall (face ${FACE})`);
  check(Math.abs(wallRoom.x - FACE) < 1e-6, `the room did not stop the walker at the wall: x ${wallRoom.x}`);
  const heldAgree = await agree(desk.page, deskId, 'held at the wall');
  await seenBy(phone.page, deskId, heldAgree, 'held at the wall');
  log.steps.publishedWall = { wallFaceX: FACE, roomX: wallRoom.x, furthestDrawnOrPredicted: atWall.furthest, framesHeld: `${atWall.held}/${atWall.frames}`, predicting: atWall.predicting, placementDrawnAtOnce: popped, predictedEqualsRoom: true };

  // 3. A third client in the same desktop page, with a revision source that has revision 2: it predicts the wall.
  const blocks2 = JSON.parse(JSON.stringify(wallBlocks));
  const third = await desk.page.evaluate(async ({ blocks2, WALL_X, realmUrl }) => {
    const { connectRealm } = await import('/src/realm/client.ts');
    const worldOf = (revision, blocks) => ({ revision, query: b => blocks.filter(s => s.min.every((n, axis) => n <= b.max[axis] && s.max[axis] >= b.min[axis])) });
    const source = { world: revision => revision === 2 ? worldOf(2, blocks2) : null };
    const scope = Array.from(window.crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
    const client = await connectRealm(realmUrl, { kingdomId: '999000001', resumeScope: scope, ticket: async () => (await fetch(`${realmUrl}/reference/session`, { method: 'POST' })).json() }, source);
    const record = window.__wc06third = { client, predicting: 0, frames: 0, furthest: -Infinity, sample: { moveX: 0, moveZ: 0, buttons: 0, yaw: 64, collisionRevision: 0 } };
    const frame = now => {
      client.tick(now, record.sample); record.frames++;
      if (client.predicting) record.predicting++;
      record.furthest = Math.max(record.furthest, client.predicted.x);
      if (!record.stop) window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
    return { id: client.selfId, x: client.predicted.x, wall: WALL_X };
  }, { blocks2, WALL_X, realmUrl: 'http://127.0.0.1:5191' });
  check(effects.placeWalker(third.id, [WALL_X - 2, 0, 9], 2), 'the room refused to place the third walker');
  await pause(600);
  await desk.page.evaluate(() => { window.__wc06third.sample = { moveX: 127, moveZ: 0, buttons: 1, yaw: 64, collisionRevision: 0 }; });
  await pause(1500);
  await desk.page.evaluate(() => { window.__wc06third.sample = { moveX: 0, moveZ: 0, buttons: 0, yaw: 64, collisionRevision: 0 }; });
  await pause(1000);
  const thirdState = await desk.page.evaluate(fields => { const r = window.__wc06third; return { predicted: Object.fromEntries(fields.map(f => [f, r.client.predicted[f]])), predicting: r.predicting, frames: r.frames, furthest: r.furthest }; }, FIELDS);
  const thirdRoom = truth(third.id);
  const thirdDiffer = FIELDS.filter(f => thirdState.predicted[f] !== thirdRoom[f]);
  check(thirdState.predicting > thirdState.frames * .9, 'the revision-2 client did not predict with its world');
  check(thirdState.furthest <= FACE + 1e-9, `the revision-2 client predicted into the wall: ${thirdState.furthest}`);
  check(thirdDiffer.length === 0, `revision-2 prediction disagrees with the room in ${thirdDiffer.join(', ')}`);
  await seenBy(phone.page, third.id, thirdRoom, 'third walker');
  log.steps.predictedWall = { roomX: thirdRoom.x, furthestPredicted: thirdState.furthest, framesPredicting: `${thirdState.predicting}/${thirdState.frames}`, predictedEqualsRoom: true };

  // 4. A room placement across the wall is drawn at once on the court page.
  await desk.page.evaluate(() => { const r = window.__wc06; r.drawn = []; r.watch = true; const each = () => { const s = window.__chatdomWalk.self; if (s) r.drawn.push(s.x); if (r.watch) window.requestAnimationFrame(each); }; window.requestAnimationFrame(each); });
  const fromX = truth(deskId).x;
  check(effects.placeWalker(deskId, [WALL_X + 3, 0, 7.5], 2), 'the room refused the placement past the wall');
  await pause(1200);
  const jumpDrawn = await desk.page.evaluate(({ a, b }) => { const r = window.__wc06; r.watch = false; return { ok: r.drawn.every(x => Math.abs(x - a) < .01 || Math.abs(x - b) < .01), last: r.drawn.at(-1), frames: r.drawn.length }; }, { a: fromX, b: WALL_X + 3 });
  check(jumpDrawn.ok && Math.abs(jumpDrawn.last - (WALL_X + 3)) < .01, `the placement past the wall was glided: ${JSON.stringify(jumpDrawn)}`);
  const placedRoom = await agree(desk.page, deskId, 'placed past the wall');
  await seenBy(phone.page, deskId, placedRoom, 'placed past the wall');
  log.steps.placement = { from: fromX, to: placedRoom.x, frames: jumpDrawn.frames, drawnAtOnce: true, predictedEqualsRoom: true };

  // Pictures: both browsers, three citizens, after the flow. The phone's walker is placed south of the other two,
  // facing them, so its view holds the other browsers' citizens too.
  check(effects.placeWalker(phoneId, [6, 0, 2], 2), 'the room refused to place the phone walker');
  await agree(phone.page, phoneId, 'phone placement');
  await phone.page.evaluate(() => window.__chatdomRealm.setInput({ moveX: 0, moveZ: 0, buttons: 0, yaw: 0 }));
  await pause(1500);
  await mkdir(values.out, { recursive: true });
  const shots = [];
  for (const { name, page, width, height } of pages) {
    await pause(500);
    const path = `${values.out}/court-after-revision@${width}x${height}.png`;
    await page.screenshot({ path });
    shots.push(path);
    log.steps[`${name}Walkers`] = await page.evaluate(() => window.__chatdomRealm.client.room.state.walkers.size);
  }
  log.shots = shots;
  check(problems.length === 0, `page problems:\n${problems.join('\n')}`);
  log.ok = true;
} catch (error) {
  log.ok = false; log.error = error instanceof Error ? error.message : String(error); log.problems = problems;
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await web?.close().catch(() => {});
  await realm?.gracefullyShutdown(false).catch(() => {});
  await loader?.close().catch(() => {});
  await release();
}
await mkdir(values.out, { recursive: true });
await writeFile(`${values.out}/route.json`, `${JSON.stringify(log, null, 2)}\n`);
console.log(JSON.stringify(log, null, 2));
process.exit(process.exitCode ?? 0);
