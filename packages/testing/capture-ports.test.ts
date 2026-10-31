import { expect, it } from 'vitest';

it('keeps live service ports out of capture selection even while they are free', async () => {
  const { CAPTURE_PORTS, assertCapturePort } = await import(new URL('./capture-ports.mjs', import.meta.url).href);
  for (const port of [5187, 5190, 5191, 5192, 5193, 5194, 5195, 5196, 5197]) {
    expect(CAPTURE_PORTS).not.toContain(port);
    expect(() => assertCapturePort(port)).toThrow('reserved service ports');
  }
  expect(assertCapturePort(5170)).toBe(5170);
  expect(assertCapturePort(5198)).toBe(5198);
  expect(assertCapturePort(0, { allowZero: true })).toBe(0);
  for (const port of [0, 5169, 5200, 1.5, NaN]) expect(() => assertCapturePort(port)).toThrow();
});
