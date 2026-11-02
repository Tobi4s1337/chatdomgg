// Focused authority cost, without socket, walker, storage or host scheduling overhead.
// nice -n 10 node apps/realm/src/games/bench.mjs
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const prefix = process.env.GATHER_EVIDENCE ?? 'ga10-pong';
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(prefix)) throw new Error('Invalid evidence prefix.');
const loader = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const { startPong, inputPong, tickPong, pongView } = await loader.ssrLoadModule('/apps/realm/src/games/pong.ts');
  const { GatherTables } = await loader.ssrLoadModule('/apps/realm/src/games/tables.ts');
  const cases = [];
  for (const count of [1, 5]) {
    const games = Array.from({ length: count }, (_, i) => startPong(`bench-${i}`, 713 + i, Date.now()));
    const times = [], batch = 1000;
    let sequence = 0;
    const tick = () => {
      for (let i = 0; i < games.length; i++) {
        let game = games[i];
        if (game.phase === 'finished') games[i] = game = startPong(`bench-${i}`, 713 + i, Date.now());
        inputPong(game, 0, sequence, game.ball.x); inputPong(game, 1, sequence++, game.ball.x);
        tickPong(game);
      }
    };
    for (let i = 0; i < batch; i++) tick();
    let bytes = 0;
    for (let run = 0; run < 50; run++) {
      const start = performance.now();
      for (let i = 0; i < batch; i++) {
        tick();
        bytes = Buffer.byteLength(JSON.stringify(games.map(pongView)));
      }
      times.push((performance.now() - start) / batch / count);
    }
    times.sort((a, b) => a - b);
    cases.push({ activeTables: count, ticksPerBatch: batch, batches: times.length,
      averageMsPerTableTickAndProjection: times.reduce((sum, n) => sum + n, 0) / times.length,
      p95BatchMeanMsPerTable: times[Math.floor(times.length * .95)], lastPublicJsonBytes: bytes });
  }
  const idle = new GatherTables(['west', 'hearth', 'middle', 'east', 'corner']), loops = 100_000;
  const start = performance.now();
  for (let i = 0; i < loops; i++) idle.tick();
  const report = { at: new Date().toISOString(), node: process.version, cases,
    fiveIdleTablesScanMs: (performance.now() - start) / loops,
    method: 'Real rules plus public projection and JSON encoding. Synthetic rule inputs; no socket, movement, storage or scheduling overhead. p95 is across batch means, not individual ticks. This shared host is not a load benchmark.' };
  await mkdir(`${root}/work/evidence/gather`, { recursive: true });
  await writeFile(`${root}/work/evidence/gather/${prefix}-cost.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await loader.close(); }
