import { describe, expect, it } from 'vitest';
import { CHANNEL_COMPOSITIONS, channelComposition, createComposition } from './index';

describe('reviewed channel compositions', () => {
  it('selects by full broadcaster identity and rejects unreviewed identities', () => {
    for (const p of CHANNEL_COMPOSITIONS) expect(channelComposition(p.broadcasterId)).toBe(channelComposition(p.login));
    expect(() => channelComposition('unknown')).toThrow('No reviewed');
    expect(new Set(CHANNEL_COMPOSITIONS.map(p=>p.character)).size).toBe(4);
  });
  for (const p of CHANNEL_COMPOSITIONS) it(`grounds native home origins in ${p.login} and retains fixed review anchors`, () => {
      const kit = createComposition(p.broadcasterId);
      expect(kit.boxes.every(box => box.min.every(Number.isInteger) && box.size.every(n=>Number.isInteger(n)&&n>0) && /^#[0-9a-f]{6}$/i.test(box.colour))).toBe(true);
      for (const id of ['hero','street','coast','dusk']) expect(kit.anchors[id]?.every(Number.isFinite)).toBe(true);
      const homes = Object.entries(kit.anchors).filter(([id])=>id.startsWith('home-'));
      expect(homes.length).toBeGreaterThan(4);
      for (const [, origin] of homes) {
        expect(origin[1]).toBe(p.town[1]+1);
        const support = kit.boxes.some(b=>b.min[0]<=origin[0] && b.min[0]+b.size[0]>origin[0] && b.min[2]<=origin[2] && b.min[2]+b.size[2]>origin[2] && b.min[1]+b.size[1]===origin[1]);
        expect(support, `${p.login} home foundation`).toBe(true);
      }
  }, 30000);
});
