import { describe, expect, it } from 'vitest';
import { FIXTURE_KINGDOMS } from './fixtures';
import { PARCHMENT, contrast, crestInks, inkFor, parseHex } from './ink';

describe('deterministic ink', () => {
  it('presses the same record the same way every time, and different records differently', () => {
    expect(inkFor('arrival:m12')).toEqual(inkFor('arrival:m12'));
    const ids = Array.from({ length: 200 }, (_, i) => `arrival:m${i}`);
    const inks = ids.map(inkFor);
    expect(new Set(inks.map(ink => `${ink.rotate}|${ink.dx}|${ink.dy}`)).size).toBeGreaterThan(190);
    expect(new Set(inks.map(ink => ink.sealCorner))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('keeps every hand-pressed variation inside a short, legible range', () => {
    for (let i = 0; i < 500; i++) {
      const ink = inkFor(`stamp:${i}:${'x'.repeat(i % 9)}`);
      expect(Math.abs(ink.rotate)).toBeLessThanOrEqual(7.5);
      expect(Math.abs(ink.dx)).toBeLessThanOrEqual(0.06);
      expect(Math.abs(ink.dy)).toBeLessThanOrEqual(0.05);
      expect(ink.pressure).toBeGreaterThanOrEqual(0.78);
      expect(ink.pressure).toBeLessThanOrEqual(0.98);
      expect(Number.isInteger(ink.grain) && ink.grain >= 1).toBe(true);
    }
  });

  it('does not depend on a clock or random source', () => {
    const before = inkFor('arrival:f1');
    const random = Math.random;
    Math.random = () => 0.5;
    try { expect(inkFor('arrival:f1')).toEqual(before); } finally { Math.random = random; }
  });
});

describe('kingdom inks', () => {
  it('turns every kingdom’s own tinctures into an ink that reads on the darkest parchment', () => {
    for (const kingdom of Object.values(FIXTURE_KINGDOMS)) {
      const inks = crestInks(kingdom.crest);
      expect(contrast(parseHex(inks.ink), PARCHMENT)).toBeGreaterThanOrEqual(3.5);
      expect(contrast(parseHex(inks.accent), PARCHMENT)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps a kingdom’s character: a strong dark tincture is used as it is, and kingdoms differ', () => {
    expect(crestInks({ colours: ['#2c3e66', '#f0e6cc'] }).ink).toBe('#2c3e66');
    const waxes = new Set(Object.values(FIXTURE_KINGDOMS).map(kingdom => crestInks(kingdom.crest).wax));
    expect(waxes.size).toBe(Object.values(FIXTURE_KINGDOMS).length);
    const inks = new Set(Object.values(FIXTURE_KINGDOMS).map(kingdom => crestInks(kingdom.crest).ink));
    expect(inks.size).toBeGreaterThanOrEqual(8);
  });

  it('deepens pale arms only as far as needed rather than replacing them with a house ink', () => {
    const pale = crestInks({ colours: ['#ece6d6', '#b4c4d2'] });
    expect(contrast(parseHex(pale.ink), PARCHMENT)).toBeGreaterThanOrEqual(3.5);
    // Still blue-grey, from the arms' own tincture, not iron-gall brown.
    const [r, , b] = parseHex(pale.ink);
    expect(b).toBeGreaterThan(r);
  });

  it('refuses a tincture that is not #rrggbb', () => {
    expect(() => crestInks({ colours: ['red', '#ffffff'] })).toThrow();
  });
});
