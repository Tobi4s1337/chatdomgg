import { expect, it } from 'vitest';
import { boundCaptionPoint } from './caption-bounds';

it('keeps the full caption inside the phone picture at either edge and follows an unobstructed anchor', () => {
  const box = { width: 220, height: 96 }, viewport = { width: 390, height: 844 };
  expect(boundCaptionPoint({ x: 59, y: 198 }, box, viewport)).toEqual({ x: 122, y: 198 });
  expect(boundCaptionPoint({ x: 389, y: 12 }, box, viewport)).toEqual({ x: 268, y: 108 });
  expect(boundCaptionPoint({ x: 195, y: 400 }, box, viewport)).toEqual({ x: 195, y: 400 });
  expect(boundCaptionPoint({ x: 195, y: 900 }, box, viewport)).toEqual({ x: 195, y: 832 });
});
