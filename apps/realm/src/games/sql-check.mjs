// Embedded SQL evidence, not live Postgres/pool acceptance. Install the pinned external test tool only in /tmp:
// npm install --prefix /tmp/chatdom-gather/sql-deps --no-save @electric-sql/pglite@0.5.14
// nice -n 10 node apps/realm/src/games/sql-check.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createServer } from 'vite';

const { AbortController, structuredClone } = globalThis;
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const toolDirectory = '/tmp/chatdom-gather/sql-deps/node_modules/@electric-sql/pglite';
const pinnedVersion = '0.5.14';
const evidencePrefix = process.env.GATHER_EVIDENCE ?? 'ga10-turn';
assert.match(evidencePrefix, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const evidencePath = `${root}/work/evidence/gather/${evidencePrefix}-sql.json`;
const migrationPath = 'apps/realm/src/persistence/migrations/0016_realm_gather.sql';
const report = {
  at: new Date().toISOString(), node: process.version, status: 'running',
  tool: { name: '@electric-sql/pglite', pinnedVersion, installedVersion: null },
  sources: ['https://pglite.dev/docs/filesystems', 'https://pglite.dev/docs/api'],
  method: 'Execute the exact gather migration and Vite-loaded production store against a file-backed embedded PostgreSQL WASM engine. The shim translates result shapes and serializes entire transactions; it never replaces SQL or advisory locks.',
  limitations: [
    'One embedded backend with a transaction-wide mutex. Concurrent requests exercise CAS and receipt decisions, not multi-backend advisory-lock contention or transaction-isolation behavior.',
    'No pgwire connection, live pg.Pool, network, authentication, database deployment, realm writer fencing or socket lifecycle is exercised.',
    'File durability is demonstrated after a clean engine close and reopen, not process kill, host crash, power loss or filesystem failure.',
    'Seeded fixture participants and command inputs only; no live identities, sessions, environment credentials or external services are read.',
    'The native Postgres integration suite remains separately required for deployment acceptance.',
  ],
  checks: [], cleanup: {},
};
let loader, db, runDirectory, gameTables;

/** A pg.Pool-shaped shim over one actual SQL backend. A checked-out client owns the mutex until release. */
function embeddedPool(engine) {
  let tail = Promise.resolve();
  async function acquire() {
    const previous = tail;
    let unlock;
    tail = new Promise(resolve => { unlock = resolve; });
    await previous;
    let released = false;
    return () => { if (!released) { released = true; unlock(); } };
  }
  async function query(text, parameters = []) {
    const result = await engine.query(text, parameters);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }
  return {
    async query(text, parameters) {
      const release = await acquire();
      try { return await query(text, parameters); } finally { release(); }
    },
    async connect() {
      const release = await acquire();
      return { query, release };
    },
  };
}
async function check(name, run) {
  report.activeCheck = name;
  const result = await run();
  report.checks.push({ name, passed: true, ...result });
  delete report.activeCheck;
}
function command(id, actor = '1', payload = JSON.stringify({ action: 'roll' })) {
  return { id, actor, payload, at: 1001 };
}
function snapshot(version, state, table = 'hearth') {
  return { table, version, kind: 'hearth-dice', match: state.match,
    players: [{ person: '1', name: 'Juniper', seat: 0 }, { person: '2', name: 'Moss', seat: 1 }],
    state: structuredClone(state), at: 1001 };
}
function digest(text) { return createHash('sha256').update(text).digest('hex'); }
function gameView(tables, id, now) {
  const table = tables.view(now).tables.find(candidate => candidate.table === id);
  assert.ok(table, 'Expected configured game table.');
  return table;
}
function gameProjection(tables, now) {
  return ['west', 'hearth'].map(id => {
    const { table, players, stones, dice } = gameView(tables, id, now);
    return { table, players, stones, dice };
  });
}
async function sit(tables, table, seat, personId, name) {
  const admission = await tables.host.admit({ table, seat, personId, signal: new AbortController().signal });
  assert.equal(admission.admitted, true, 'A physical fixture chair must admit its owner.');
  admission.seated({ generation: 1, targetId: `tavern:${table}:seat:${seat}` });
  tables.name(personId, name);
}

try {
  const packageInfo = JSON.parse(await readFile(`${toolDirectory}/package.json`, 'utf8'));
  assert.equal(packageInfo.version, pinnedVersion, 'Install the pinned /tmp-only PGlite version before running.');
  report.tool.installedVersion = packageInfo.version;
  const { PGlite } = await import(pathToFileURL(`${toolDirectory}/dist/index.js`).href);
  await mkdir('/tmp/chatdom-gather', { recursive: true });
  runDirectory = await mkdtemp('/tmp/chatdom-gather/sql-run-');
  const dataDirectory = `${runDirectory}/database`;
  report.dataDirectory = dataDirectory;
  db = await PGlite.create(dataDirectory);
  report.engine = (await db.query('SELECT version() AS version')).rows[0].version;
  const migration = await readFile(`${root}/${migrationPath}`, 'utf8');
  report.migration = { path: migrationPath, sha256: digest(migration) };
  await db.exec('CREATE SCHEMA realm_gather; SET search_path TO realm_gather');
  await check('exact migration executes in isolated realm_gather schema', async () => {
    await db.exec(migration);
    const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'realm_gather' ORDER BY tablename");
    assert.deepEqual(tables.rows.map(row => row.tablename), ['gather_table_checkpoints', 'gather_table_moves']);
    return { tables: tables.rows.map(row => row.tablename) };
  });
  loader = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false } });
  const { createPostgresGatherStore } = await loader.ssrLoadModule('/apps/realm/src/games/store.ts');
  const { startDice, actDice, diceView } = await loader.ssrLoadModule('/apps/realm/src/games/dice.ts');
  const { GatherTables, TAVERN_TABLES } = await loader.ssrLoadModule('/apps/realm/src/games/tables.ts');
  report.store = { path: 'apps/realm/src/games/store.ts', sha256: digest(await readFile(`${root}/apps/realm/src/games/store.ts`, 'utf8')) };
  let pool = embeddedPool(db), store = createPostgresGatherStore(pool);
  const kingdom = 'sql-fixture:1';
  const state = startDice('sql-fixture:match', 713, 1000, 2);
  let current = snapshot(1, state);

  await check('production store commits checkpoint and move using real advisory-lock SQL', async () => {
    assert.equal(await store.commit(kingdom, null, current, command('start', null, JSON.stringify({ action: 'start' }))), 'committed');
    assert.equal(actDice(state, 0, 0, 'roll', 1001), true);
    assert.ok(state.cursor > 0);
    current = snapshot(2, state);
    assert.equal(await store.commit(kingdom, 1, current, command('roll')), 'committed');
    assert.deepEqual(await store.load(kingdom), [current]);
    const rows = await pool.query('SELECT version, snapshot FROM gather_table_moves WHERE kingdom_id = $1 ORDER BY version', [kingdom]);
    assert.equal(rows.rows.length, 2);
    assert.deepEqual(JSON.parse(rows.rows[1].snapshot), current);
    return { checkpoints: 1, acceptedMoves: rows.rows.length, privateSeedCursorDeadlineRetained: true };
  });
  await check('receipts bind exact payload, table and expected version without writes', async () => {
    assert.equal(await store.commit(kingdom, 1, current, command('roll')), 'duplicate');
    assert.equal(await store.commit(kingdom, 1, current, command('roll', '1', JSON.stringify({ action: 'hold' }))), 'conflict');
    assert.equal(await store.commit(kingdom, 2, snapshot(3, state), command('roll')), 'conflict');
    assert.equal(await store.commit(kingdom, 1, snapshot(2, state, 'another'), command('roll')), 'conflict');
    assert.deepEqual(await store.load(kingdom), [current]);
    assert.equal((await pool.query('SELECT command_id FROM gather_table_moves WHERE kingdom_id = $1', [kingdom])).rows.length, 2);
    return { exactRetry: 'duplicate', changedPayloadTableOrExpectedVersion: 'conflict', rowsUnchanged: true };
  });
  await check('load and commit use private copies', async () => {
    const loaded = await store.load(kingdom);
    loaded[0].state.seed = 0; loaded[0].state.scores[0] = 999;
    loaded[0].players[0].name = 'Changed';
    assert.deepEqual(await store.load(kingdom), [current]);
    const next = snapshot(3, state), expected = structuredClone(next);
    const saving = store.commit(kingdom, 2, next, command('copy'));
    next.state.cursor = 999;
    assert.equal(await saving, 'committed');
    current = expected;
    assert.deepEqual(await store.load(kingdom), [current]);
    return { callerMutationsCannotChangeSavedState: true };
  });
  await check('append trigger failure rolls back checkpoint and does not consume the receipt', async () => {
    await db.exec(`CREATE FUNCTION gather_test_fail_append() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.command_id = 'fail-write' THEN RAISE EXCEPTION 'Injected append failure' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER gather_test_fail_append BEFORE INSERT ON gather_table_moves FOR EACH ROW EXECUTE FUNCTION gather_test_fail_append();`);
    const next = snapshot(4, state);
    await assert.rejects(store.commit(kingdom, 3, next, command('fail-write')), error => error.code === 'P0001');
    assert.deepEqual(await store.load(kingdom), [current]);
    assert.equal((await pool.query('SELECT command_id FROM gather_table_moves WHERE kingdom_id = $1 AND command_id = $2', [kingdom, 'fail-write'])).rows.length, 0);
    await db.exec('DROP TRIGGER gather_test_fail_append ON gather_table_moves; DROP FUNCTION gather_test_fail_append()');
    assert.equal(await store.commit(kingdom, 3, next, command('fail-write')), 'committed');
    current = next;
    return { failureSqlstate: 'P0001', checkpointRolledBack: true, receiptReusableAfterFailure: true };
  });
  await check('concurrent CAS requests admit one writer on the serialized embedded backend', async () => {
    const next = snapshot(5, state);
    const outcomes = await Promise.all(['race:a', 'race:b'].map(id => store.commit(kingdom, 4, next, command(id))));
    assert.deepEqual([...outcomes].sort(), ['committed', 'conflict']);
    current = next;
    assert.deepEqual(await store.load(kingdom), [current]);
    const rejected = outcomes[0] === 'conflict' ? 'race:a' : 'race:b';
    const after = snapshot(6, state);
    assert.equal(await store.commit(kingdom, 5, after, command(rejected)), 'committed');
    current = after;
    return { outcomes, rejectedCommandRemainsReusable: true, multiBackendLockProof: false };
  });
  await check('concurrent exact retries append once on the serialized embedded backend', async () => {
    const first = snapshot(1, state, 'retry');
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => store.commit(kingdom, null, first, command('retry'))));
    assert.equal(outcomes.filter(outcome => outcome === 'committed').length, 1);
    assert.equal(outcomes.filter(outcome => outcome === 'duplicate').length, 5);
    assert.equal((await pool.query('SELECT command_id FROM gather_table_moves WHERE kingdom_id = $1 AND table_id = $2', [kingdom, 'retry'])).rows.length, 1);
    return { committed: 1, duplicates: 5, multiBackendLockProof: false };
  });
  await check('accepted move history rejects UPDATE and DELETE', async () => {
    await assert.rejects(pool.query('UPDATE gather_table_moves SET payload = $1 WHERE kingdom_id = $2', ['{}', kingdom]), error => error.code === '23000');
    await assert.rejects(pool.query('DELETE FROM gather_table_moves WHERE kingdom_id = $1', [kingdom]), error => error.code === '23000');
    return { updateSqlstate: '23000', deleteSqlstate: '23000' };
  });
  await check('close and reopen the file-backed database preserves checkpoint, history and private RNG', async () => {
    const before = await store.load(kingdom);
    const movesBefore = await pool.query('SELECT table_id, version, snapshot FROM gather_table_moves WHERE kingdom_id = $1 ORDER BY table_id, version', [kingdom]);
    const entries = await readdir(dataDirectory);
    assert.ok(entries.length > 0);
    await db.close(); db = undefined;
    db = await PGlite.create(dataDirectory);
    await db.exec('SET search_path TO realm_gather');
    pool = embeddedPool(db); store = createPostgresGatherStore(pool);
    assert.deepEqual(await store.load(kingdom), before);
    const movesAfter = await pool.query('SELECT table_id, version, snapshot FROM gather_table_moves WHERE kingdom_id = $1 ORDER BY table_id, version', [kingdom]);
    assert.deepEqual(movesAfter.rows, movesBefore.rows);
    const recovered = (await store.load(kingdom)).find(table => table.table === 'hearth');
    assert.equal(recovered.state.seed, state.seed);
    assert.equal(recovered.state.cursor, state.cursor);
    assert.equal(recovered.state.deadline, state.deadline);
    assert.equal(await store.commit(kingdom, 1, snapshot(2, state), command('roll')), 'duplicate');
    return { cleanCloseAndReopen: true, filesInDataDirectory: entries.length, checkpointsRestored: before.length,
      acceptedMovesRestored: movesAfter.rows.length, privateSeedCursorDeadlineRestored: true,
      historySha256Before: digest(JSON.stringify(movesBefore.rows)), historySha256After: digest(JSON.stringify(movesAfter.rows)) };
  });
  const gameKingdom = 'turn-game-test';
  let beforeGames, savedGames;
  report.tableAuthority = { path: 'apps/realm/src/games/tables.ts', sha256: digest(await readFile(`${root}/apps/realm/src/games/tables.ts`, 'utf8')) };
  await check('actual GatherTables starts and plays Stones and sparse-chair Hearth Dice through SQL', async () => {
    gameTables = new GatherTables(TAVERN_TABLES, { kingdom: gameKingdom, store });
    await gameTables.restore(10_000);
    await sit(gameTables, 'west', '1', '101', 'Juniper');
    await sit(gameTables, 'west', '2', '102', 'Moss');
    await sit(gameTables, 'hearth', '1', '103', 'Rowan');
    await sit(gameTables, 'hearth', '4', '104', 'Briar');
    for (const [id, person] of [['west', '101'], ['hearth', '103']]) {
      assert.equal(await gameTables.start(person, { table: id, id: `start:${id}`, revision: gameView(gameTables, id, 10_000).revision }, 10_000), true);
    }
    const stones = gameView(gameTables, 'west', 10_000).stones;
    assert.equal(await gameTables.move('101', { action: 'drop', id: 'stones:first', table: 'west', match: stones.match, revision: stones.revision, column: 0 }, 10_001), true);
    const dice = gameView(gameTables, 'hearth', 10_000).dice;
    assert.equal(await gameTables.move('103', { action: 'roll', id: 'dice:first', table: 'hearth', match: dice.match, revision: dice.revision }, 10_001), true);
    await gameTables.flush();
    beforeGames = gameProjection(gameTables, 10_001);
    assert.equal(beforeGames[0].stones.board[0], 1);
    assert.equal(beforeGames[0].stones.turn, 1);
    assert.equal(beforeGames[0].stones.deadline, 40_001);
    assert.equal(beforeGames[1].dice.deadline, 40_001);
    assert.deepEqual(gameView(gameTables, 'hearth', 10_001).seats, ['Rowan', null]);
    assert.deepEqual(gameView(gameTables, 'hearth', 10_001).extraSeats, [null, 'Briar']);
    assert.equal(/"(?:seed|cursor)":/.test(JSON.stringify(gameTables.view(10_001))), false, 'Public game projection must exclude RNG.');
    savedGames = await store.load(gameKingdom);
    assert.equal(savedGames.length, 2);
    const savedDice = savedGames.find(game => game.table === 'hearth');
    assert.ok(savedDice.state.cursor > 0, 'The first accepted roll must advance private RNG.');
    assert.deepEqual(savedDice.players.map(player => player.seat), [0, 3]);
    const moves = await pool.query('SELECT table_id, version FROM gather_table_moves WHERE kingdom_id = $1 ORDER BY table_id, version', [gameKingdom]);
    assert.equal(moves.rows.length, 4);
    return { physicalPlayers: 4, games: ['stones', 'hearth-dice'], sparseDiceChairs: [1, 4], checkpoints: 2, acceptedStartsAndMoves: 4,
      stonesTurn: 1, stonesDeadline: 40_001, diceDeadline: 40_001, publicRngFieldsAbsent: true };
  });
  await check('actual GatherTables restores both games after file reopen and continues the persisted dice sequence', async () => {
    await gameTables.close(); gameTables = undefined;
    await db.close(); db = undefined;
    db = await PGlite.create(dataDirectory);
    await db.exec('SET search_path TO realm_gather');
    pool = embeddedPool(db); store = createPostgresGatherStore(pool);
    assert.ok(isDeepStrictEqual(await store.load(gameKingdom), savedGames), 'Private game checkpoints must survive file reopen unchanged.');
    gameTables = new GatherTables(TAVERN_TABLES, { kingdom: gameKingdom, store });
    await gameTables.restore(10_002);
    assert.deepEqual(gameProjection(gameTables, 10_002), beforeGames);
    for (const id of ['west', 'hearth']) assert.equal(gameView(gameTables, id, 10_002).status, 'ready');
    // Recovery reserves the original chairs without inventing authenticated bodies or granting game input.
    assert.deepEqual(gameView(gameTables, 'west', 10_002).seats, ['Juniper', 'Moss']);
    assert.deepEqual(gameView(gameTables, 'hearth', 10_002).seats, ['Rowan', null]);
    assert.deepEqual(gameView(gameTables, 'hearth', 10_002).extraSeats, [null, 'Briar']);
    assert.deepEqual(gameTables.self('104'), { table: null, seat: null, seatIndex: null, playerIndex: null });
    const stranger = await gameTables.host.admit({ table: 'west', seat: '1', personId: '999', signal: new AbortController().signal });
    assert.equal(stranger.admitted, false, 'A recovery reservation must refuse a stranger.');
    assert.equal(await gameTables.move('102', { action: 'drop', id: 'stones:unseated', table: 'west', match: beforeGames[0].stones.match, revision: beforeGames[0].stones.revision, column: 1 }, 10_003), false);
    for (const [table, seat, person, name] of [
      ['west', '1', '101', 'Juniper'], ['west', '2', '102', 'Moss'],
      ['hearth', '1', '103', 'Rowan'], ['hearth', '4', '104', 'Briar'],
    ]) await sit(gameTables, table, seat, person, name);
    const restoredStones = gameView(gameTables, 'west', 10_002).stones;
    assert.equal(await gameTables.move('102', { action: 'drop', id: 'stones:resumed', table: 'west', match: restoredStones.match, revision: restoredStones.revision, column: 1 }, 10_003), true);
    const expectedBoard = [...beforeGames[0].stones.board]; expectedBoard[1] = 2;
    assert.deepEqual(gameView(gameTables, 'west', 10_003).stones.board, expectedBoard);
    const savedDice = savedGames.find(game => game.table === 'hearth');
    const expectedDice = structuredClone(savedDice.state), activePlayer = savedDice.players[expectedDice.turn];
    const priorRevision = expectedDice.revision;
    assert.equal(actDice(expectedDice, expectedDice.turn, priorRevision, 'roll', 10_003), true);
    assert.equal(await gameTables.move(activePlayer.person, { action: 'roll', id: 'dice:resumed', table: 'hearth', match: expectedDice.match, revision: priorRevision }, 10_003), true);
    assert.deepEqual(gameView(gameTables, 'hearth', 10_003).dice, diceView(expectedDice));
    await gameTables.flush();
    const savedAfter = await store.load(gameKingdom);
    assert.ok(isDeepStrictEqual(savedAfter.find(game => game.table === 'hearth').state, expectedDice), 'Resumed roll must match the persisted private seed and cursor.');
    const moves = await pool.query('SELECT table_id, version FROM gather_table_moves WHERE kingdom_id = $1 ORDER BY table_id, version', [gameKingdom]);
    assert.equal(moves.rows.length, 6);
    assert.ok(savedAfter.every(game => game.version === 3));
    assert.equal(/"(?:seed|cursor)":/.test(JSON.stringify(gameTables.view(10_003))), false);
    return { cleanCloseAndReopen: true, gamesRestored: 2, immutableParticipantNamesRestored: true, physicalChairsRequireReseating: true, recoveryChairsReservedWithoutBodies: true,
      stonesBoardTurnAndDeadlineRestored: true, stonesNextPlayerAccepted: true, sparseDiceChairMappingRestored: true,
      nextDiceRollMatchesPersistedPrivateRng: true, acceptedStartsAndMovesAfterResume: moves.rows.length,
      persistedVersions: savedAfter.map(game => ({ table: game.table, version: game.version })), publicRngFieldsAbsent: true };
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = { name: error.name, code: error.code ?? null,
    message: error.code === 'ERR_ASSERTION' ? 'SQL check assertion failed; inspect the active check and runner source. Private values are omitted.' : error.message };
  process.exitCode = 1;
} finally {
  for (const [name, cleanup] of [
    ['gameTablesClosed', async () => { if (gameTables) await gameTables.close(); }],
    ['databaseClosed', async () => { if (db) await db.close(); }],
    ['loaderClosed', async () => { if (loader) await loader.close(); }],
    ['temporaryDataRemoved', async () => { if (runDirectory) await rm(runDirectory, { recursive: true, force: true }); }],
  ]) {
    try { await cleanup(); report.cleanup[name] = true; }
    catch (error) { report.cleanup[name] = false; report.status = 'failed'; report.cleanup.failure = error.message; process.exitCode = 1; }
  }
  await mkdir(`${root}/work/evidence/gather`, { recursive: true });
  await writeFile(evidencePath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
