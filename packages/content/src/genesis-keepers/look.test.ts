import { describe, expect, it } from 'vitest';
import { AVATAR_LOOK_LIMITS } from '@chatdom/shared';
import { AVATAR_MATERIALS, HAIR_FORMS } from '../avatars/index';
import { MAT } from '../materials';
import { createKeeperLook, FACE_KEYS } from './look';
import { KEEPER_PALETTES } from './palette';
import { keeperRole } from './roles/index';
import { KEEPER_ROLES, KEEPER_TEMPERAMENTS, type KeeperKitId, type KeeperLook, type KeeperRole } from './types';

const KITS = Object.keys(KEEPER_PALETTES) as KeeperKitId[];
const look = (role: KeeperRole, temperament: (typeof KEEPER_TEMPERAMENTS)[number], kit: KeeperKitId = 'tide', form?: (typeof HAIR_FORMS)[number]): KeeperLook => {
  const def = keeperRole(role);
  return createKeeperLook({ role, temperament, kit, body: def.bodies[temperament], skin: MAT.skin6, hair: { form: form ?? def.hairForms[0]!, swatch: MAT.hairCopper } });
};
const occupied = (parts: KeeperLook['parts']): number => parts.reduce((n, part) => n + part.boxes.reduce((m, b) => m + (b.material ? (b.to[0] - b.from[0]) * (b.to[1] - b.from[1]) * (b.to[2] - b.from[2]) : 0), 0), 0);

describe('keeper looks', () => {
  it('build for every role, temperament, kit and allowed hair, deterministically and within the look budget', { timeout: 120_000 }, () => {
    for (const role of KEEPER_ROLES) for (const temperament of KEEPER_TEMPERAMENTS) for (const kit of KITS) for (const form of keeperRole(role).hairForms) {
      const made = look(role, temperament, kit, form);
      expect(JSON.stringify(look(role, temperament, kit, form))).toBe(JSON.stringify(made));
      expect(made.report.parts).toBeLessThanOrEqual(AVATAR_LOOK_LIMITS.maxParts);
      expect(made.report.occupiedCells).toBeLessThanOrEqual(AVATAR_LOOK_LIMITS.maxOccupiedCells);
      for (const part of [...made.parts, ...made.tools.flatMap(tool => tool.parts)]) {
        for (const box of part.boxes) if (box.material) expect(AVATAR_MATERIALS.has(box.material)).toBe(true);
      }
    }
  });

  it('refuses hair the role does not wear', () => {
    const missing = HAIR_FORMS.find(form => !keeperRole('lamplighter').hairForms.includes(form))!;
    expect(() => look('lamplighter', 'hearty', 'tide', missing)).toThrow(/does not wear/);
  });

  it('keeps the face: eyes are on every look, whatever the hat', () => {
    for (const role of KEEPER_ROLES) for (const temperament of KEEPER_TEMPERAMENTS) {
      const head = look(role, temperament).parts.filter(part => part.attachment === 'head' && part.layer === 'body');
      const keys = new Set(head.flatMap(part => part.boxes.map(box => box.material)));
      for (const key of FACE_KEYS) expect(keys.has(key)).toBe(true);
    }
  });

  it('reads as its role from across the street: each role carries its own place\'s tools and garments', () => {
    const tools = (role: KeeperRole) => new Set(look(role, 'hearty').tools.map(tool => tool.id));
    expect(tools('innkeeper')).toEqual(new Set(['tankard-cloth', 'broom']));
    expect(tools('lamplighter')).toEqual(new Set(['pole', 'pole-rag']));
    expect(tools('ferryman')).toEqual(new Set(['boathook', 'line']));
    for (const temperament of KEEPER_TEMPERAMENTS) {
      // The lamplighter's long coat swings as tails; nobody else wears a cape.
      expect(look('lamplighter', temperament).cape).not.toBeNull();
      expect(look('innkeeper', temperament).cape).toBeNull();
      expect(look('ferryman', temperament).cape).toBeNull();
      // Lamplighter and ferryman always wear headwear: nothing of the head's hair rises above it.
      for (const role of ['lamplighter', 'ferryman'] as const) {
        expect(look(role, temperament).parts.some(part => part.attachment === 'head' && /\.hat$/.test(part.id))).toBe(true);
      }
      // Sea boots on the ferryman's shins, an apron on the innkeeper.
      expect(look('ferryman', temperament).parts.some(part => /\.boot\.left$/.test(part.id))).toBe(true);
      expect(look('innkeeper', temperament).parts.some(part => /\.apron$/.test(part.id))).toBe(true);
    }
  });

  it('gives each temperament of a role its own cut, so three keepers of a kind never look cloned', () => {
    for (const role of KEEPER_ROLES) {
      const cuts = KEEPER_TEMPERAMENTS.map(t => look(role, t));
      expect(new Set(cuts.map(c => c.spec.body)).size).toBe(3);
      expect(new Set(cuts.map(c => occupied(c.parts))).size).toBe(3);
    }
  });

  it('dresses keepers in their kingdom\'s kit livery', () => {
    for (const role of KEEPER_ROLES) {
      const hearth = new Set(look(role, 'hearty', 'hearth').parts.flatMap(p => p.boxes.map(b => b.material)));
      const tide = new Set(look(role, 'hearty', 'tide').parts.flatMap(p => p.boxes.map(b => b.material)));
      expect(tide.has(KEEPER_PALETTES.tide.livery) || tide.has(KEEPER_PALETTES.tide.accent)).toBe(true);
      expect(hearth.has(KEEPER_PALETTES.hearth.livery) || hearth.has(KEEPER_PALETTES.hearth.accent)).toBe(true);
      expect(hearth).not.toEqual(tide);
    }
  });

  it('carries nothing that could pass for a presence light', () => {
    for (const role of KEEPER_ROLES) for (const temperament of KEEPER_TEMPERAMENTS) {
      const made = look(role, temperament);
      for (const part of [...made.parts, ...made.tools.flatMap(tool => tool.parts)]) for (const box of part.boxes) expect(box.material).not.toBe(MAT.glass);
    }
  });
});
