import { createServer } from 'node:net';
import { expect, it } from 'vitest';
import { runDistrictCrossing } from './district-harness';

async function freePort() {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return address.port;
}

it('R10 a walker crossing a district leaves its old interest on its own decoder only, and districts share views', async () => {
  const report = await runDistrictCrossing({ port: await freePort() });
  if (process.env.DISTRICT_REPORT) console.info(JSON.stringify(report, null, 1));
  expect(report.violations).toEqual([]);
  expect(report.crossing).toMatchObject({ from: '0:0', to: '1:0' });
  // The crossing decoder alone loses the old district's walker and gains the new one's.
  expect(report.decoders.crosser).toMatchObject({ removed: ['behind'], added: ['ahead'] });
  expect(report.decoders.stayer).toMatchObject({ removed: [], added: [], holds: ['arrival', 'behind', 'crosser', 'neighbour', 'stayer'] });
  // Shared views: two sockets per district view, one body per view and one timed frame per socket.
  expect(report.identity).toEqual({ stayerRetained: true, stayerShared: true, behindRetained: true, arrivalShared: true, crosserLeftOld: true });
  expect(report.costs.steady.bodiesPerPatchMax).toBeLessThanOrEqual(report.views.after);
  expect(report.costs.steady.framesPerPatchMax).toBe(report.sockets);
  expect(report.costs.crossing.fullStates).toEqual({ crosser: expect.objectContaining({ frames: 1 }) });
}, 30_000);
