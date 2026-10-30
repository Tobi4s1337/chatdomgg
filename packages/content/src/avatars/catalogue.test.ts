import { describe, expect, it } from 'vitest';
import { AVATAR_CAPE_LIMITS, AvatarCapeBlueprintSchema, VOXEL_METRES } from '@chatdom/shared';
import { AVATAR_PALETTE, MAT, MATERIALS } from '../materials';
import { BODY_FAMILIES, CAPE_FORMS, HAIR_FORMS, REVIEW_LINEUPS, REVIEW_LOOKS, assembleLook, compileAvatarPart, createBodyParts, createCape, createHairParts, createWearableParts, findReviewLook, occupiedCells, restPosition, validateLook } from './index';

const registered = new Set(MATERIALS.materials.filter(m => m.id !== 0).map(m => m.id));

describe('body and hair catalogue', () => {
  it('builds every body in every skin, and every hair form in every swatch on every body, within budget', () => {
    for (const body of BODY_FAMILIES) {
      const shape = createBodyParts(body, AVATAR_PALETTE.skin[0]);
      for (const skin of AVATAR_PALETTE.skin) {
        const parts = createBodyParts(body, skin);
        // Skin is a palette choice: the same boxes, recoloured where the skin shows.
        expect(parts.map(p => [p.attachment, p.pivot, p.size, p.boxes.length])).toEqual(shape.map(p => [p.attachment, p.pivot, p.size, p.boxes.length]));
        expect(parts.some(p => p.boxes.some(b => b.material === skin))).toBe(true);
      }
      // Every form on every body; the swatch only recolours, so the full swatch range is built on one body.
      for (const form of HAIR_FORMS) for (const hair of body === 'balanced' ? AVATAR_PALETTE.hair : AVATAR_PALETTE.hair.slice(0, 1)) {
        const parts = createHairParts(form, { body, hair, headwear: null });
        expect(parts.length).toBe(form === 'bareScalp' ? 0 : 1);
        for (const part of parts) {
          expect(part.attachment).toBe('head');
          expect(part.layer).toBe('hair');
        }
        validateLook([...shape, ...parts]);
      }
    }
    expect(() => createBodyParts('balanced', MAT.stone as never)).toThrow();
    expect(() => createHairParts('sidePart', { body: 'balanced', hair: MAT.stone as never, headwear: null })).toThrow();
  }, 60_000);

  it('shows the whole range on the bench: every body, skin, hair form and hair swatch', () => {
    expect(new Set(REVIEW_LOOKS.map(l => l.body))).toEqual(new Set(BODY_FAMILIES));
    expect(new Set(REVIEW_LOOKS.map(l => l.skin))).toEqual(new Set(AVATAR_PALETTE.skin));
    expect(new Set(REVIEW_LOOKS.flatMap(l => l.hair ? [l.hair.form] : []))).toEqual(new Set(HAIR_FORMS));
    expect(new Set(REVIEW_LOOKS.flatMap(l => l.hair ? [l.hair.swatch] : []))).toEqual(new Set(AVATAR_PALETTE.hair));
    for (const look of REVIEW_LOOKS) expect(look.label).toMatch(/^Simulated /);
    for (const lineup of REVIEW_LINEUPS) for (const id of lineup.looks) expect(findReviewLook(id).id).toBe(id);
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
