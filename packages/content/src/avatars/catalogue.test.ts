import { describe, expect, it } from 'vitest';
import { AVATAR_CAPE_LIMITS, AvatarCapeBlueprintSchema, VOXEL_METRES } from '@chatdom/shared';
import { AVATAR_PALETTE, MATERIALS } from '../materials';
import { BODY_FAMILIES, CAPE_FORMS, HAIR_FORMS, REVIEW_LINEUPS, REVIEW_LOOKS, assembleLook, compileAvatarPart, createBodyParts, createCape, createHairParts, createWearableParts, occupiedCells, partMatrix, restPosition, transformPoint, validateLook } from './index';

const registered = new Set(MATERIALS.materials.filter(m => m.id !== 0).map(m => m.id));

/** Root-local occupied cells of a part at rest, as "x,y,z" keys. */
function restCells(part: Parameters<typeof compileAvatarPart>[0]): Set<string> {
  const asset = compileAvatarPart(part, 0), [sx, sy] = asset.size, m = partMatrix(part), out = new Set<string>();
  asset.voxels.forEach((v, i) => {
    if (!v) return;
    const p = transformPoint(m, [(i % sx + .5) * VOXEL_METRES.avatar, (Math.floor(i / sx) % sy + .5) * VOXEL_METRES.avatar, (Math.floor(i / (sx * sy)) + .5) * VOXEL_METRES.avatar]);
    out.add(p.map(n => Math.floor(n / VOXEL_METRES.avatar)).join(','));
  });
  return out;
}

describe('body and hair catalogue', () => {
  it('builds every family in every skin, and every hair treatment in every swatch on every family', { timeout: 60_000 }, () => {
    for (const body of BODY_FAMILIES) {
      for (const skin of AVATAR_PALETTE.skin) validateLook(createBodyParts(body, skin));
      const [head] = createBodyParts(body, AVATAR_PALETTE.skin[0]).filter(part => part.attachment === 'head');
      const skull = restCells(head!);
      for (const form of HAIR_FORMS) for (const hair of AVATAR_PALETTE.hair) {
        const parts = createHairParts(form, { body, hair, headwear: null });
        validateLook([...createBodyParts(body, AVATAR_PALETTE.skin[0]), ...parts]);
        for (const part of parts) {
          expect(part.attachment).toBe('head');
          expect(part.layer).toBe('hair');
          for (const cell of restCells(part)) {
            const [x, y, z] = cell.split(',').map(Number) as [number, number, number];
            // Hair meets the skull face to face, never in the same cell.
            expect(skull.has(cell)).toBe(false);
            // Eyes, cheeks and mouth (rows 17–20 of the face plate and the cells in front of it) stay clear;
            // a fringe may come down to the row just above the eyes.
            expect(z >= 3 && x >= -5 && x < 5 && y >= 17 && y < 21, `${form} covers the face at ${cell}`).toBe(false);
          }
        }
      }
    }
    expect(() => createBodyParts('lanky' as never, AVATAR_PALETTE.skin[0])).toThrow();
    expect(() => createBodyParts('balanced', AVATAR_PALETTE.hair[0] as never)).toThrow();
    expect(() => createHairParts('mohawk' as never, { body: 'balanced', hair: AVATAR_PALETTE.hair[0], headwear: null })).toThrow();
    expect(() => createHairParts('bob', { body: 'balanced', hair: AVATAR_PALETTE.skin[0] as never, headwear: null })).toThrow();
  });

  it('covers each family, every skin and hair swatch and every treatment in the review fixtures', () => {
    const looks = [...REVIEW_LOOKS, ...REVIEW_LINEUPS.flatMap(lineup => lineup.looks)];
    for (const body of BODY_FAMILIES) expect(looks.some(look => look.body === body)).toBe(true);
    for (const skin of AVATAR_PALETTE.skin) expect(REVIEW_LOOKS.some(look => look.skin === skin)).toBe(true);
    for (const hair of AVATAR_PALETTE.hair) expect(REVIEW_LOOKS.some(look => look.hair?.swatch === hair)).toBe(true);
    for (const form of HAIR_FORMS) expect(REVIEW_LOOKS.some(look => look.hair?.form === form)).toBe(true);
    for (const look of looks) expect(look.label).toMatch(/^Simulated citizen /);
  });
});

describe('cape catalogue', () => {
  it('describes every cape as schema-valid cloth fitted to each body, held on only by small rigid fasteners', () => {
    for (const id of CAPE_FORMS) for (const body of BODY_FAMILIES) for (const style of ['hearth', 'tide'] as const) {
      const cape = createCape(id, { body, style });
      expect(AvatarCapeBlueprintSchema.parse(cape)).toEqual(cape);
      for (const swatch of Object.values(cape.colours)) expect(registered.has(swatch)).toBe(true);
      // The pinned edge sits below the head (row 16) and the sheet hangs behind the back socket.
      const top = restPosition('back')[1] * VOXEL_METRES.avatar + cape.mount.height;
      expect(top).toBeLessThanOrEqual(16 * VOXEL_METRES.avatar);
      expect(cape.width).toBeLessThanOrEqual(AVATAR_CAPE_LIMITS.maxWidth);
      expect(cape.mount.back).toBeGreaterThan(0);
      // No voxel drape: the rigid half is accessory-sized fasteners, never a garment volume.
      for (const part of createWearableParts(id, { body, style })) {
        expect(part.layer).toBe('accessory');
        expect(occupiedCells(compileAvatarPart(part, 0))).toBeLessThan(24);
      }
    }
    expect(() => createCape('shortCloak', { body: 'balanced', style: 'tide', subscription: 'active' })).toThrow();
    expect(() => createCape('shortCloak', { body: 'balanced', style: 'grove' as never })).toThrow();
  });

  it('assembles every review look, with a cape exactly when one is worn', () => {
    for (const look of REVIEW_LOOKS) {
      const { cape } = assembleLook(look);
      expect(cape !== null).toBe(look.wear.some(item => (CAPE_FORMS as readonly string[]).includes(item.id)));
    }
  });
});
