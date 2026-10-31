import { expect, it } from 'vitest';
import { KingdomIdSchema, KingdomPresenceFrameSchema } from '@chatdom/shared';
import { createGenesisWindowPreview } from './window-preview';

it('paints deterministic anonymous windows with dark homes, without claiming a live audience', () => {
  const id = KingdomIdSchema.parse('63920635');
  const homes = Array.from({ length: 16 }, (_, slot) => ({ slot }));
  const frame = createGenesisWindowPreview(id, homes, 2000);
  expect(KingdomPresenceFrameSchema.parse(frame)).toEqual(frame);
  expect(createGenesisWindowPreview(id, homes, 2000)).toEqual(frame);
  expect(frame).toMatchObject({ origin: 'simulated', streamLive: false, connection: 'offline' });
  expect(frame.windows.filter(window => window.present).length).toBeGreaterThan(10);
  expect(frame.windows.some(window => !window.present)).toBe(true);
  expect(frame.windows.every(window => window.publicName === null)).toBe(true);
  expect(homes.every(home => Object.keys(home).length === 1)).toBe(true);
});
