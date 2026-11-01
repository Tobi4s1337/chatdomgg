import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createWindmillParts } from './index';

it('keeps the ordered mill geometry and anchors unchanged across the field-only pass', () => {
  const hashes: Record<string, string> = {
    tobi4s_: '19637d7328f95595fa61aad5596b497faed02829bf2e139944ce804b20e575f9',
    '129634568': 'cf8c28aeae75b0319df5e07dced39199ada224128f6d3d6dda4b87a0945204cb',
    '63920635': '19637d7328f95595fa61aad5596b497faed02829bf2e139944ce804b20e575f9',
    '4363967': '19637d7328f95595fa61aad5596b497faed02829bf2e139944ce804b20e575f9',
    '154972160': 'cf8c28aeae75b0319df5e07dced39199ada224128f6d3d6dda4b87a0945204cb',
  };
  const hash = (kit: ReturnType<typeof createWindmillParts>['body']) => createHash('sha256')
    .update(JSON.stringify({ boxes: kit.boxes, anchors: kit.anchors })).digest('hex');
  for (const [seed, body] of Object.entries(hashes)) {
    const parts = createWindmillParts(seed);
    expect(hash(parts.body)).toBe(body);
    expect(hash(parts.sails)).toBe('e43333e40ed28d3b2c4a0d35d8bf20d27d9eeaee53957961d7cfc33b6ceaba6f');
  }
});
