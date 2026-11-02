/* global AbortController, structuredClone */
// From the square to the tables and back: three walkers on a founded kingdom cross the installed tavern door, two of
// them play Pong, Stones and Hearth Dice to their results while the third watches, and all three walk out again. A
// fourth person stays on the square the whole time, so every transfer is seen from both rooms at once.
// Headless realm clients only (no browser, no capture lock). Temporary reference sessions, memory only.
// Run: nice -n 10 node apps/web/src/games/door-to-table.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer as createPortProbe } from 'node:net';
import { setInterval, clearInterval, setTimeout } from 'node:timers';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';
import { createServer } from 'vite';
import { listenLocalRealm } from './local-listener.mjs';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${repo}/work/evidence/gather`;
const host = '127.0.0.10';
const seed = process.env.GATHER_PLAN_SEED ?? 'tobi4s_';
const level = Number(process.env.GATHER_TAVERN_LEVEL ?? 1);
assert.ok([1, 2, 3, 4].includes(level), 'GATHER_TAVERN_LEVEL is a tavern growth level, 1 to 4');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cancellation = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cancellation.abort(new Error(`Cancelled by ${signal}`)));
const until = async (predicate, description, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await sleep(20);
  }
};
const freePort = async () => {
  for (const port of [5183, 5184, 5185, 5186, 5188, 5189, 5170, 5171, 5172, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182]) {
    const probe = createPortProbe();
    if (await new Promise(resolve => { probe.once('error', () => resolve(false)); probe.listen(port, host, () => probe.close(() => resolve(true))); })) return port;
  }
  throw new Error('No approved free port on the gather loopback address.');
};

const report = { started: new Date().toISOString(),
  fixture: `Temporary reference sessions with synthetic identities, memory only. The kingdom is a founded hamlet generated from the seed "${seed}" with its tavern at growth level ${level}, not an adopted plan from a database.`,
  limitations: [
    'Headless realm clients drive the walk; the door crossing uses predicted feet the way the kingdom walk will, and play performs the transfer in the product.',
    'The kingdom room spawns arrivals at the portal return anchor because this fixture tells it to; choosing that anchor on return is the kingdom room\'s decision (play/integrator).',
    'The kingdom room places a new arrival at yaw 0 (its spawn has feet only); the walker faces out from its first standing input, as the kingdom walk would turn to the anchor. A spawn yaw is the kingdom room\'s change.',
    'No browser, Twitch identity, durable session, database or GPU is involved.',
  ], checks: [], walkers: {}, games: {} };
let loader, realm;
const rooms = [];
try {
  const port = await freePort();
  report.ports = { host, realm: port };
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: '/tmp/chatdom-gather/vite-harness-loader',
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false } });
  const load = path => loader.ssrLoadModule(path);
  const [{ createRealmServer }, { referenceServices, REFERENCE_KINGDOM }, shared, { KingdomRoomState }, { createTavernInterior, TAVERN_ENTRY, TAVERN_EXIT },
    { seatApproachDriver }, { installGatherStore, MemoryGatherStore }, { tavernPortalFor }, worldPkg, { createGrowthState }, { createRealmState },
    { createNativeTown, assembleFoundedScene, compileFoundedScene }, { stepPlayer }] = await Promise.all([
    load('/apps/realm/src/server.ts'), load('/apps/realm/src/reference.ts'), load('/packages/shared/src/index.ts'), load('/packages/shared/src/realm/index.ts'),
    load('/apps/realm/src/games/interior.ts'), load('/apps/web/src/games/walker.ts'), load('/apps/realm/src/games/store.ts'),
    load('/apps/realm/src/games/portal.ts'), load('/packages/world/src/index.ts'), load('/packages/world/src/growth/index.ts'),
    load('/packages/world/src/realm/reducer.ts'), load('/apps/realm/src/founded/index.ts'), load('/packages/world/src/movement/step.ts'),
  ]);
  const { TavernRoomState, starterCitizenLook, createThresholdWatch, insideTavernThreshold } = shared;

  // The founded kingdom: its own plan, installed tavern and exact collision. Nothing here edits the scene.
  const plan = worldPkg.generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
  const growth = createGrowthState(REFERENCE_KINGDOM, 'simulated');
  const state = { ...createRealmState(REFERENCE_KINGDOM, 'simulated'),
    growth: { ...growth, civic: { ...growth.civic, levels: { tavern: level, forge: level, market: level, bridge: level, 'castle-court': level } } } };
  const { scene } = await assembleFoundedScene({ kingdomId: REFERENCE_KINGDOM, plan, native: createNativeTown(plan), state, collisionRevision: 7 });
  const placementsBefore = JSON.stringify(scene.placements);
  const world = compileFoundedScene(scene);
  const portal = tavernPortalFor(REFERENCE_KINGDOM, scene, world);
  assert.ok(portal, 'the installed tavern offers a door');
  assert.equal(JSON.stringify(scene.placements), placementsBefore, 'deriving the door changes no placement');
  const tavern = scene.placements.find(piece => piece.id === 'civic:growth:v1:tavern');
  report.kingdom = { seed, level, placements: scene.placements.length, homes: plan.homes.length, tavern: { position: tavern.position, rotation: tavern.rotation },
    door: portal.door, returnAnchor: portal.returnAnchor, collisionRevision: world.revision };
  report.checks.push(`The installed tavern (turn ${tavern.rotation}) offers a door; the derivation moved none of the ${scene.placements.length} placements.`);

  // Fresh single-use tickets for one signed-in principal, as play's transfer asks for one per room.
  const base = referenceServices(), byTicket = new Map(), again = new Map();
  const services = { ...base, auth: { ...base.auth, authenticate: async join => {
    const carried = again.get(join.ticket);
    if (carried) { again.delete(join.ticket); return carried; }
    const principal = { ...await base.auth.authenticate(join) };
    principal.look = starterCitizenLook(principal.personId);
    byTicket.set(join.ticket, principal);
    return principal;
  } }, open: async kingdomId => {
    const handle = await base.open(kingdomId);
    let effects;
    return { ...handle, layoutRevision: scene.layoutRevision, world, spawn: () => [...portal.returnAnchor.feet],
      bootstrap: principal => ({ ...handle.bootstrap(principal), layoutRevision: scene.layoutRevision, collisionRevision: world.revision }),
      recoverWalker: (id, revision) => revision === world.revision && !!effects?.placeWalker(id, [...portal.returnAnchor.feet], revision),
      bindRoom: bound => { effects = bound; const off = handle.bindRoom(bound); return () => { if (effects === bound) effects = undefined; off(); }; } };
  } };
  const fresh = principal => { const ticket = randomUUID(); again.set(ticket, principal); return { ticket, kingdomId: REFERENCE_KINGDOM, protocol: 1 }; };
  installGatherStore(services, new MemoryGatherStore());
  const created = createRealmServer(services); realm = created.server;
  await listenLocalRealm(realm, created.transport, port, host);
  const sdk = new Client(`http://${host}:${port}`);
  const quiet = room => { room.reconnection.enabled = false; rooms.push(room); return room; };
  // Play's transfer holds one room at a time: a person's next room opens only after the last one has closed.
  const open = (person, room) => { assert.equal(person.open ?? null, null, `${person.label} opens a room while still in ${person.open?.roomId}`); person.open = room; return room; };
  const close = async person => { const room = person.open; person.open = null; await room.leave(); };

  // --- The square: three walkers arrive outside the door and walk in. ---
  const kingdomJoin = async (person, ticket) => {
    if (person.open) throw new Error(`${person.label} is still in ${person.open.roomId}`);
    const room = open(person, quiet(await sdk.joinOrCreate('kingdom', ticket, KingdomRoomState)));
    room.onMessage('*', () => {});
    await until(() => room.state.walkers.get(room.sessionId), 'kingdom walker placed');
    return room;
  };
  const walkers = [];
  for (const label of ['player one', 'player two', 'watcher']) {
    const ticket = base.issue(), person = { label }, room = await kingdomJoin(person, ticket);
    walkers.push(Object.assign(person, { principal: byTicket.get(ticket.ticket), kingdom: room, ticket }));
  }
  // Someone who stays outside: the square's own view of every departure and return.
  const observer = { label: 'square observer' };
  { const ticket = base.issue(); observer.kingdom = await kingdomJoin(observer, ticket); observer.principal = byTicket.get(ticket.ticket); }
  const square = observer.kingdom;
  await until(() => square.state.walkers.size === 4, 'four people on the square');
  for (const walker of walkers) {
    const body = walker.kingdom.state.walkers.get(walker.kingdom.sessionId);
    walker.arrived = [body.x, body.y, body.z];
    assert.ok(Math.hypot(body.x - portal.returnAnchor.feet[0], body.z - portal.returnAnchor.feet[2]) < .01, `${walker.label} starts at the door`);
  }
  report.checks.push('Three walkers stand on the square outside the tavern door in one kingdom room, with a fourth person who stays outside throughout.');

  // Cross the door with the kingdom walk's own prediction: the same inputs drive the server and the local body.
  const crossIn = async walker => {
    const room = walker.kingdom, server = room.state.walkers.get(room.sessionId), watch = createThresholdWatch(portal.door);
    const body = { x: server.x, y: server.y, z: server.z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: server.yaw, distance: 0, collisionRevision: world.revision };
    const [tx, tz] = portal.door.through, input = room.input({ mode: 'reliable' });
    const step = { moveX: Math.round(tx * 127), moveZ: Math.round(tz * 127), buttons: 0, yaw: (portal.returnAnchor.yaw + 128) % 256, collisionRevision: world.revision };
    watch([body.x, body.y, body.z]);
    let crossed = null, ticks = 0;
    await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (++ticks > 120) { clearInterval(timer); reject(new Error(`${walker.label} never crossed the door`)); return; }
        Object.assign(input.data, step, { placement: room.state.walkers.get(room.sessionId).placement }); input.send();
        stepPlayer(body, step, 1 / 30, world);
        if (watch([body.x, body.y, body.z])) { crossed = { tick: ticks, predicted: [body.x, body.y, body.z] }; clearInterval(timer); resolve(); }
      }, 1000 / 30);
    });
    await sleep(250);
    const authoritative = room.state.walkers.get(room.sessionId);
    crossed.authoritative = [authoritative.x, authoritative.y, authoritative.z];
    crossed.agreement = Math.hypot(authoritative.x - body.x, authoritative.z - body.z);
    return crossed;
  };
  const tavernState = room => {
    const state = { tables: null, self: null, receipt: null, receipts: new Map(), interior: null, exits: 0 };
    room.onMessage('interior', message => { state.interior = message; });
    room.onMessage('transient', () => {});
    room.onMessage('receipt', message => state.receipts.set(message.id, message.accepted));
    room.onMessage('private', message => { if (message.type === 'receipt') state.receipt = message.receipt; });
    room.onMessage('tables', message => { state.tables = message; for (const listener of state.listeners) listener(message); });
    room.onMessage('self', message => { state.self = message; });
    room.onMessage('exit', () => { state.exits++; });
    state.listeners = [];
    return state;
  };
  for (const walker of walkers) {
    walker.door = await crossIn(walker);
    // Play's transfer: leave the square first, then enter the tavern with a fresh ticket for the same person.
    const leaving = walker.kingdom.sessionId;
    await close(walker);
    await until(() => !square.state.walkers.has(leaving), `${walker.label} left the square`);
    await assert.rejects(sdk.joinOrCreate('tavern', walker.ticket, TavernRoomState), 'the spent kingdom ticket never opens the tavern');
    const room = open(walker, quiet(await sdk.joinOrCreate('tavern', fresh(walker.principal), TavernRoomState)));
    walker.tavern = room; walker.state = tavernState(room);
    room.send('bootstrap');
    await until(() => walker.state.tables && walker.state.self && walker.state.interior && room.state.walkers.get(room.sessionId), `${walker.label} inside`);
    const inside = room.state.walkers.get(room.sessionId);
    assert.equal(inside.name, walker.principal.publicName); assert.equal(inside.look, walker.principal.look);
    assert.deepEqual([inside.x, inside.y, inside.z].map(n => +n.toFixed(3)), TAVERN_ENTRY.feet.map(n => +n.toFixed(3)), `${walker.label} arrives at the interior entry`);
    report.walkers[walker.label] = { name: walker.principal.publicName, look: walker.principal.look, door: walker.door, tavernRoom: room.roomId };
  }
  const [one, two, watcher] = walkers;
  await until(() => watcher.tavern.state.walkers.size === 3, 'three walkers in the tavern');
  assert.equal(one.tavern.roomId, `t:${REFERENCE_KINGDOM}`);
  assert.ok(walkers.every(w => w.tavern.roomId === one.tavern.roomId), 'one tavern room for the kingdom');
  assert.equal(square.state.walkers.size, 1, 'only the observer is left on the square');
  report.checks.push(`All three crossed the exterior door inward (predicted and authoritative feet within ${Math.max(...walkers.map(w => w.door.agreement)).toFixed(3)} m), left the kingdom room (the observer on the square saw each go before the tavern opened), were refused with the spent ticket, and entered ${one.tavern.roomId} with a fresh ticket as the same name and look, at the interior entry.`);

  // --- The room: walk to chairs through the interior's collision, sit, play, stand. ---
  const interior = createTavernInterior();
  // Just in front of the counter (the bar's boxes end at z 1.875 m), between the second and third stools' line.
  const BAR_FRONT = [3, TAVERN_ENTRY.feet[1], 2.375];
  const walkTo = async (walker, goal) => {
    const room = walker.tavern, body = room.state.walkers.get(room.sessionId);
    walker.from = [body.x, body.y, body.z];
    const driver = seatApproachDriver(interior.world, [body.x, body.y, body.z], goal, [14, 10]);
    const input = room.input({ mode: 'reliable' });
    const timer = setInterval(() => {
      const current = room.state.walkers.get(room.sessionId);
      if (current && !driver.done) { Object.assign(input.data, driver.input(current), { placement: current.placement }); input.send(); }
    }, 1000 / 30);
    try { await until(() => driver.done, `${walker.label} walks`, 40_000); }
    catch (error) {
      const at = room.state.walkers.get(room.sessionId);
      error.message += ` (from ${JSON.stringify(walker.from)} to ${JSON.stringify(goal)}, at ${JSON.stringify([at.x, at.y, at.z])}, ${JSON.stringify(driver.progress)})`;
      throw error;
    } finally { clearInterval(timer); }
  };
  let intents = 0;
  const interact = async (walker, targetId, action) => {
    const id = `door-to-table-${++intents}`;
    walker.tavern.send('intent', { version: 1, type: 'interact', id, targetId, action });
    await until(() => walker.state.receipt?.id === id, `${walker.label} ${action} receipt`);
    return walker.state.receipt;
  };
  const sit = async (walker, chair) => {
    const target = interior.registry.get(chair);
    assert.ok(target, `${chair} exists`);
    await walkTo(walker, target.target.approach);
    const receipt = await interact(walker, chair, 'tavern');
    assert.equal(receipt.status, 'applied', `${walker.label} sits at ${chair}: ${receipt.message ?? ''}`);
    const [, table] = chair.split(':');
    await until(() => walker.state.self?.table === table, `${walker.label} seated at ${table}`);
  };
  const stand = async (walker, chair) => {
    const receipt = await interact(walker, chair, 'stand');
    assert.equal(receipt.status, 'applied', `${walker.label} stands`);
    await until(() => walker.state.self?.table == null, `${walker.label} standing`);
  };
  const tableOf = (walker, id) => walker.state.tables?.tables.find(table => table.table === id);
  let starts = 0;
  const start = async (walker, table) => {
    const id = `door-to-table-start-${++starts}`, revision = tableOf(walker, table).revision;
    walker.tavern.send('start', { table, revision, id });
    await until(() => walker.state.receipts.has(id), `${table} start receipt`);
    assert.equal(walker.state.receipts.get(id), true, `${table} start accepted`);
  };
  // The watcher sees each public table frame: the miniature on the table is drawn from exactly these frames.
  const watch = (id, field) => {
    const seen = [];
    watcher.state.listeners.push(message => {
      const view = message.tables.find(table => table.table === id)?.[field];
      const key = view?.revision ?? view?.tick;
      if (view && seen.at(-1)?.key !== key) seen.push({ ...structuredClone(view), key });
    });
    return seen;
  };
  // A chair is refused only when it is taken: the watcher tries the first chair while player one holds it.
  const refusedTaken = async chair => {
    const target = interior.registry.get(chair);
    await walkTo(watcher, target.target.approach);
    const receipt = await interact(watcher, chair, 'tavern');
    assert.notEqual(receipt.status, 'applied', 'a taken chair is refused');
    return receipt;
  };

  // Pong at the middle table: both players track the real ball; each point has one planned miss after a short rally.
  {
    const seen = watch('middle', 'pong'), id = 'middle';
    await sit(one, 'tavern:middle:seat:1'); await sit(two, 'tavern:middle:seat:2');
    const refusal = await refusedTaken('tavern:middle:seat:1');
    report.checks.push(`Both players walked to the Pong chairs and sat; the watcher was refused the taken chair (${refusal.status}).`);
    await start(one, id);
    const losers = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1];
    const sequences = [0, 0], timers = [];
    for (const [seat, walker] of [[0, one], [1, two]]) timers.push(setInterval(() => {
      const pong = tableOf(walker, id)?.pong;
      if (!pong || !['serve', 'rally'].includes(pong.phase)) return;
      const point = pong.score[0] + pong.score[1], rally = (pong.contacts ?? []).filter(c => c.kind === 'paddle' && c.tick > (walker.pointTick ?? -1)).length;
      if (walker.lastPoint !== point) { walker.lastPoint = point; walker.pointTick = pong.tick; }
      const towardMe = seat === 0 ? pong.ball.vy > 0 : pong.ball.vy < 0;
      const missing = losers[point % losers.length] === seat && rally >= 2 && towardMe;
      const target = missing ? (pong.ball.x > 0 ? -1 : 1) : Math.max(-1, Math.min(1, pong.ball.x));
      walker.tavern.send('paddle', { match: pong.match, sequence: ++sequences[seat], paddle: target });
    }, 1000 / 30));
    try { await until(() => ['finished', 'interrupted'].includes(tableOf(one, id)?.pong?.phase), 'Pong to seven', 240_000); }
    finally { for (const timer of timers) clearInterval(timer); }
    const final = tableOf(one, id).pong;
    await until(() => tableOf(watcher, id)?.pong?.phase === 'finished', 'the watcher sees the end');
    const watched = tableOf(watcher, id).pong;
    assert.equal(final.phase, 'finished'); assert.equal(final.reason, 'points'); assert.equal(Math.max(...final.score), 7);
    assert.equal(watched.match, final.match); assert.deepEqual(watched.score, final.score); assert.equal(watched.winner, final.winner);
    const paddleContacts = seen.flatMap(view => view.contacts ?? []).filter(c => c.kind === 'paddle');
    const scoreSteps = new Set(seen.map(view => view.score.join(':'))).size;
    assert.ok(scoreSteps >= 8, 'the watcher saw every score');
    report.games.pong = { match: final.match, score: final.score, winner: tableOf(one, id).players?.[final.winner] ?? final.winner, reason: final.reason,
      watcherFrames: seen.length, watcherScores: scoreSteps, paddleContactsSeen: new Set(paddleContacts.map(c => c.sequence)).size };
    report.checks.push(`Pong ended ${final.score.join('–')} on points; the watcher's table showed the same match, the same ${scoreSteps - 1} points as they happened and the same result.`);
    await stand(one, 'tavern:middle:seat:1'); await stand(two, 'tavern:middle:seat:2');
  }

  // Stones at the east table: win if you can, block if you must, otherwise the column nearest the centre.
  {
    const seen = watch('east', 'stones'), id = 'east';
    await sit(one, 'tavern:east:seat:1'); await sit(two, 'tavern:east:seat:2');
    await start(two, id);
    await until(() => tableOf(one, id)?.stones?.phase === 'playing', 'Stones starts');
    const lowest = (board, column) => { for (let row = 0; row < 6; row++) if (board[row * 7 + column] === 0) return row; return -1; };
    const wins = (board, column, stone) => {
      const row = lowest(board, column); if (row < 0) return false;
      const next = [...board]; next[row * 7 + column] = stone;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        let count = 1;
        for (const sign of [1, -1]) for (let x = column + dx * sign, y = row + dy * sign; x >= 0 && x < 7 && y >= 0 && y < 6 && next[y * 7 + x] === stone; x += dx * sign, y += dy * sign) count++;
        if (count >= 4) return true;
      }
      return false;
    };
    // Player one blocks; player two only looks for its own four, so the match ends in a real line rather than a draw.
    const choose = (board, stone, order, blocks) => {
      const legal = order.filter(column => lowest(board, column) >= 0);
      return legal.find(c => wins(board, c, stone)) ?? (blocks ? legal.find(c => wins(board, c, 3 - stone)) : undefined)
        ?? legal.find(c => { const row = lowest(board, c); if (row >= 5) return true; const next = [...board]; next[row * 7 + c] = stone; return !wins(next, c, 3 - stone); }) ?? legal[0];
    };
    const orders = { [one.principal.publicName]: [3, 2, 4, 1, 5, 0, 6], [two.principal.publicName]: [3, 4, 2, 5, 1, 6, 0] };
    let moves = 0, duplicate = null;
    while (tableOf(one, id).stones.phase === 'playing') {
      const view = tableOf(one, id).stones, players = tableOf(one, id).players, name = players[view.turn];
      const walker = walkers.find(w => w.principal.publicName === name), other = walker === one ? two : one;
      const column = choose(view.board, view.turn + 1, orders[name], walker === one), move = `stones-${++moves}`;
      if (moves === 3) {
        // Out of turn and stale: the other player's drop and a replay of an old revision change nothing.
        other.tavern.send('move', { action: 'drop', id: `${move}-out-of-turn`, table: id, match: view.match, revision: view.revision, column });
        await until(() => other.state.receipts.has(`${move}-out-of-turn`), 'out-of-turn receipt');
        assert.equal(other.state.receipts.get(`${move}-out-of-turn`), false);
        assert.equal(tableOf(one, id).stones.revision, view.revision, 'an out-of-turn drop changes nothing');
      }
      walker.tavern.send('move', { action: 'drop', id: move, table: id, match: view.match, revision: view.revision, column });
      await until(() => walker.state.receipts.has(move), 'drop receipt');
      assert.equal(walker.state.receipts.get(move), true, `drop ${moves} accepted`);
      await until(() => tableOf(one, id).stones.revision > view.revision, 'drop published');
      if (moves === 3) {
        walker.tavern.send('move', { action: 'drop', id: move, table: id, match: view.match, revision: view.revision, column });
        await until(() => walker.state.receipts.size > 0 && tableOf(one, id).stones.revision >= view.revision + 1, 'duplicate settled');
        await sleep(200);
        duplicate = tableOf(one, id).stones.revision;
        assert.equal(duplicate, view.revision + 1, 'a duplicated drop changes nothing');
      }
    }
    const final = tableOf(one, id).stones;
    await until(() => tableOf(watcher, id)?.stones?.phase === 'finished', 'the watcher sees the end');
    const watched = tableOf(watcher, id).stones;
    assert.equal(watched.match, final.match); assert.deepEqual(watched.board, final.board); assert.equal(watched.winner, final.winner);
    assert.equal(final.reason, 'four'); assert.equal(final.winning.length >= 4, true);
    assert.ok(seen.length >= moves, 'the watcher saw every drop');
    report.games.stones = { match: final.match, moves, reason: final.reason, winner: final.winner === null ? null : tableOf(one, id).players[final.winner],
      winning: final.winning, board: final.board, watcherFrames: seen.length };
    report.checks.push(`Stones ended by ${final.reason} after ${moves} drops; an out-of-turn drop and a duplicated drop changed nothing; the watcher's frame showed the same board and result.`);
    await stand(one, 'tavern:east:seat:1'); await stand(two, 'tavern:east:seat:2');
  }

  // Hearth Dice at the hearth: roll until ten in the pot or the win is in reach, then hold.
  {
    const seen = watch('hearth', 'dice'), id = 'hearth';
    await sit(one, 'tavern:hearth:seat:1'); await sit(two, 'tavern:hearth:seat:3');
    await start(one, id);
    await until(() => tableOf(one, id)?.dice?.phase === 'playing', 'Dice starts');
    // Meanwhile the watcher walks the room: every chair's approach, then the bar front, through the real collision.
    const tour = (async () => {
      const chairs = interior.registry.targets().filter(target => target.kind === 'tavern-seat');
      const reached = [];
      for (const chair of chairs) { await walkTo(watcher, chair.approach); reached.push(chair.id); }
      await walkTo(watcher, BAR_FRONT);
      const body = watcher.tavern.state.walkers.get(watcher.tavern.sessionId);
      return { chairs: reached, total: chairs.length, bar: [body.x, body.y, body.z] };
    })();
    let moves = 0, busts = 0;
    while (tableOf(one, id).dice.phase === 'playing') {
      const view = tableOf(one, id).dice, players = tableOf(one, id).players, name = players[view.turn];
      const walker = walkers.find(w => w.principal.publicName === name);
      const action = view.pot >= 10 || view.scores[view.turn] + view.pot >= 50 ? 'hold' : 'roll', move = `dice-${++moves}`;
      walker.tavern.send('move', { action, id: move, table: id, match: view.match, revision: view.revision });
      await until(() => walker.state.receipts.has(move), 'dice receipt');
      assert.equal(walker.state.receipts.get(move), true, `dice move ${moves} accepted`);
      await until(() => tableOf(one, id).dice.revision > view.revision, 'dice published');
      if (tableOf(one, id).dice.last === 'bust') busts++;
      assert.ok(moves < 400, 'Dice reaches fifty');
    }
    const final = tableOf(one, id).dice;
    await until(() => tableOf(watcher, id)?.dice?.phase === 'finished', 'the watcher sees the end');
    const watched = tableOf(watcher, id).dice;
    assert.equal(watched.match, final.match); assert.deepEqual(watched.scores, final.scores); assert.equal(watched.winner, final.winner);
    assert.equal(final.reason, 'fifty'); assert.ok(Math.max(...final.scores) >= 50);
    const toured = await tour;
    assert.equal(toured.chairs.length, toured.total);
    assert.ok(Math.abs(toured.bar[2] - BAR_FRONT[2]) < .15 && Math.abs(toured.bar[0] - BAR_FRONT[0]) < .15, 'the watcher stands at the bar');
    report.tour = toured;
    report.checks.push(`During the Dice match the watcher walked to all ${toured.total} chair approaches and to the bar front through the room's collision.`);
    report.games.dice = { match: final.match, moves, busts, scores: final.scores, winner: tableOf(one, id).players[final.winner], watcherFrames: seen.length };
    report.checks.push(`Hearth Dice ended ${final.scores.join('–')} after ${moves} moves (${busts} ones); the watcher saw the same pegs and winner.`);
    await stand(one, 'tavern:hearth:seat:1'); await stand(two, 'tavern:hearth:seat:3');
  }

  // --- Out again: the interior doorway tells only the walker who crosses it; they come back to the square. ---
  // Both rooms are watched while each person transfers: by the watcher inside (until the watcher goes last) and by the
  // observer on the square. A person is never in both at once, and opens the square only after the tavern has closed.
  const named = (room, name) => room ? [...room.state.walkers.values()].filter(w => w.name === name) : [];
  const walkOut = async (walker, inside) => {
    const name = walker.principal.publicName, samples = { both: 0, tavern: 0, square: 0, neither: 0 };
    const sample = () => {
      const t = named(inside?.tavern, name).length > 0, q = named(square, name).length > 0;
      samples[t && q ? 'both' : t ? 'tavern' : q ? 'square' : 'neither']++;
    };
    const watching = [square, inside?.tavern].filter(Boolean);
    for (const room of watching) room.onStateChange(sample);
    try {
      await walkTo(walker, TAVERN_ENTRY.feet);
      const room = walker.tavern, input = room.input({ mode: 'reliable' }), others = walkers.filter(w => w !== walker).map(w => w.state.exits);
      const [ex, ez] = TAVERN_EXIT.through;
      const timer = setInterval(() => {
        const current = room.state.walkers.get(room.sessionId);
        Object.assign(input.data, { moveX: Math.round(ex * 127), moveZ: Math.round(ez * 127), buttons: 0, yaw: 0, collisionRevision: interior.world.revision, placement: current.placement });
        input.send();
      }, 1000 / 30);
      try { await until(() => walker.state.exits === 1, `${walker.label} reaches the interior doorway`, 15_000); } finally { clearInterval(timer); }
      assert.deepEqual(walkers.filter(w => w !== walker).map(w => w.state.exits), others, 'only the crosser is told');
      const leaving = room.sessionId;
      await close(walker);
      if (inside) await until(() => !inside.tavern.state.walkers.has(leaving), `${walker.label} left the tavern`);
      assert.equal(named(square, name).length, 0, `${walker.label} is not on the square before the tavern closed`);
      const kingdom = await kingdomJoin(walker, fresh(walker.principal));
      walker.kingdom = kingdom;
      const body = kingdom.state.walkers.get(kingdom.sessionId), spawnYaw = body.yaw;
      // Standing still on the step, the walker first looks along the wall (so the square's view must change before
      // the check can pass, even where the spawn's default already faces out), then turns to the anchor's facing as
      // the kingdom walk does with its first input.
      const turn = kingdom.input({ mode: 'reliable' });
      const face = async (yaw, what) => {
        const turning = setInterval(() => {
          const current = kingdom.state.walkers.get(kingdom.sessionId);
          Object.assign(turn.data, { moveX: 0, moveZ: 0, buttons: 0, yaw, collisionRevision: world.revision, placement: current.placement });
          turn.send();
        }, 1000 / 30);
        try { await until(() => named(square, name)[0]?.yaw === yaw, `${walker.label} ${what}`); } finally { clearInterval(turning); }
      };
      const aside = (portal.returnAnchor.yaw + 64) % 256, asideRadians = aside * Math.PI / 128;
      await face(aside, 'looks along the wall');
      assert.ok(Math.sin(asideRadians) * portal.door.through[0] + Math.cos(asideRadians) * portal.door.through[1] > -.5, 'looking along the wall is not facing out');
      await face(portal.returnAnchor.yaw, 'faces out on the square');
      await sleep(400);
      // The square's own view of the returned person: where they stand and which way they actually face.
      const seen = named(square, name);
      assert.equal(seen.length, 1, `${walker.label} is on the square exactly once`);
      const actual = seen[0], returned = [actual.x, actual.y, actual.z], radians = actual.yaw * Math.PI / 128;
      const facing = Math.sin(radians) * portal.door.through[0] + Math.cos(radians) * portal.door.through[1];
      assert.ok(facing < -.999, `${walker.label} actually faces out (${facing.toFixed(4)})`);
      assert.ok(Math.hypot(returned[0] - portal.returnAnchor.feet[0], returned[2] - portal.returnAnchor.feet[2]) < .01, `${walker.label} stands at the return anchor`);
      assert.equal(insideTavernThreshold(portal.door, returned), false, 'the return is off the door');
      assert.equal(createThresholdWatch(portal.door)(returned), false, 'arriving outside never fires the door');
      assert.equal(actual.look, walker.principal.look, `${walker.label} keeps the same look`);
      assert.equal(samples.both, 0, `${walker.label} was never in both rooms`);
      return { feet: returned, spawnYaw, asideYaw: aside, actualYaw: actual.yaw, facingOut: +facing.toFixed(4), onSquare: seen.length, samples };
    } finally { for (const room of watching) room.onStateChange.remove(sample); }
  };
  for (const walker of [one, two]) report.walkers[walker.label].returned = await walkOut(walker, watcher);
  assert.equal(watcher.tavern.state.walkers.size, 1, 'the tavern holds only the watcher');
  report.walkers.watcher.returned = await walkOut(watcher, null);
  await until(() => square.state.walkers.size === 4, 'everyone back on the square');
  const names = [...square.state.walkers.values()].map(w => w.name);
  assert.equal(new Set(names).size, 4, 'each person is on the square once');
  report.checks.push('All three walked out through the interior doorway; only the crosser was told. Each closed the tavern before opening the square, was never seen in both rooms (sampled on every patch of both rooms), and came back once at the return anchor, off the door, as the same name and look. The square\'s view of each returned walker shows its actual yaw: first looking along the wall, then facing out.');
  assert.equal(JSON.stringify(scene.placements), placementsBefore, 'the kingdom is unchanged');
  report.result = 'passed';
} catch (error) {
  report.result = 'failed';
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  await Promise.all(rooms.map(room => room.leave().catch(() => {})));
  await realm?.gracefullyShutdown(false).catch(() => {});
  await loader?.close().catch(() => {});
  await mkdir(output, { recursive: true });
  const name = process.env.GATHER_EVIDENCE ?? 'ga10-door-to-table';
  assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name));
  await writeFile(`${output}/${name}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ result: report.result, checks: report.checks, games: report.games, failure: report.failure }, null, 2));
}
