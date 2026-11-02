import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ForgeHouseSocket } from '@chatdom/shared';
import { assembleForge, forgeStyleKit } from './index';

// Full result hashes captured from committed revision one (81c36373), before the chamber change.
const previous = {
  hearth: { roof: '7654c0676d34021255a9e9dfcd8769d00d8c27d9ba5906a1602ac34808d56e0b', wall: 'cb1aa03e0bf486d95654b1442d4a72ef5e1058589d5de02d08a06feb69fa2abd' },
  tide: { roof: 'fb99a7befc7caffd1db6d7629198eeeafce181452abc9d18f9868bd04e6401e2', wall: 'c543f9a35c9433adf5ff835f16802597d6fa52faf496f01c891d4dc715390cb3' },
  grove: { roof: '1d3cd8b8ef76e420da2bf8f783481a082750e785348650b68bb6e5b4977df2e1', wall: '22ef3520800ecda7c2bbc6a8017d54202a3cb6fe85eddfb857039dbad98af010' },
};

describe('saved Forge kit revisions', () => {
  for (const family of ['hearth', 'tide', 'grove'] as const) for (const profile of ['roof', 'wall'] as const) {
    it(`${family} ${profile}: reproduces the previously committed lantern exactly`, () => {
      const socket: ForgeHouseSocket = { id: profile, kind: 'lantern', profile, origin: [0, 0, 0],
        supports: profile === 'wall' ? [[15, 4, -1], [16, 5, -1]] : [[15, 3, 15], [16, 3, 15], [15, 3, 16], [16, 3, 16]],
        hostId: 'fixture', hostFingerprint: 'fixture', clearanceHeight: 0 };
      const plan = { version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' } as const;
      const legacy = assembleForge(plan, forgeStyleKit(family, 1), socket);
      expect(createHash('sha256').update(JSON.stringify(legacy)).digest('hex')).toBe(previous[family][profile]);
      expect(forgeStyleKit(family, 1)).toEqual(legacy.kit);
      const next = assembleForge(plan, forgeStyleKit(family, 2), socket);
      expect(next.blueprint).not.toEqual(legacy.blueprint);
      expect(next.emitter).not.toEqual(legacy.emitter);
    });
  }
  it.each([0, 3, 99, NaN])('rejects unknown kit revision %s instead of upgrading it', revision => {
    expect(() => forgeStyleKit('hearth', revision)).toThrow('Unregistered');
  });
});
