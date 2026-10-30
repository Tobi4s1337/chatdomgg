import { describe, expect, it } from 'vitest';
import { AVATAR_CAPE_LIMITS, AvatarCapeBlueprintSchema, VOXEL_METRES } from '@chatdom/shared';
import { MATERIALS } from '../materials';
import { BODY_FAMILIES, CAPE_FORMS, REVIEW_LOOKS, assembleLook, compileAvatarPart, createCape, createWearableParts, occupiedCells, restPosition } from './index';

const registered = new Set(MATERIALS.materials.filter(m => m.id !== 0).map(m => m.id));

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
