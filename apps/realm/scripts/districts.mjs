// SIMULATED district handoff check (spec 34 R10) on the production kingdom room with real SDK decoders.
//   node apps/realm/scripts/districts.mjs [--out report.json]
// Six SIMULATED walkers on an open practice field; one crosses a district edge while the others stay. Prints one
// JSON report: decoder additions/removals, shared-view identity, encoded bodies and per-socket frames kept apart.
// Binds one ephemeral 127.0.0.1 port for its own room and closes it before exiting. Needs no database.
// Exits 1 when any decoder, view or cost expectation fails.
import { createServer } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { runnerImport } from 'vite';

const at = process.argv.indexOf('--out');
const out = at > 0 ? process.argv[at + 1] : undefined;
const root = fileURLToPath(new URL('..', import.meta.url));
const { module } = await runnerImport(fileURLToPath(new URL('../src/diagnostics/district-harness.ts', import.meta.url)), { root, configFile: false, logLevel: 'warn' });

const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const { port } = probe.address();
await new Promise(resolve => probe.close(resolve));

try {
  const report = await module.runDistrictCrossing({ port });
  const text = JSON.stringify(report, null, 2);
  if (out) await writeFile(out, `${text}\n`);
  console.info(text);
  const { crossing, steady } = report.costs;
  console.info(`SIMULATED districts: ${report.crossing.from} → ${report.crossing.to} in ${report.crossing.ms} ms; `
    + `steady ${steady.patches} patches: ${steady.bodies} bodies (${steady.bodyBytes} B, max ${steady.bodiesPerPatchMax}/patch for ${report.views.after} views) `
    + `vs ${steady.frames} socket frames (${steady.frameBytes} B, ${steady.timedPrefixBytes} B timing prefix, ${steady.heartbeats} heartbeats); `
    + `handoff ${JSON.stringify(crossing.fullStates)}; ${report.violations.length ? `FAILED: ${report.violations.join('; ')}` : 'all expectations held'}`);
  process.exitCode = report.violations.length ? 1 : 0;
} catch (error) {
  console.error(`SIMULATED districts: ${error instanceof Error ? error.message : 'the harness failed'}`);
  process.exitCode = 1;
}
process.exit();
