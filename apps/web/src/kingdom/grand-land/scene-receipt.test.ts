import { describe, expect, it, vi } from 'vitest';
import { RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '../../../../../packages/world/src/founded-world/types';

const { encode } = vi.hoisted(() => ({ encode: vi.fn() }));
vi.mock('../../../../../packages/world/src/founded-world/validate', () => ({ encodeFoundedScene: encode }));
import { foundedLandReceipt } from './scene-receipt';

// Entry has already validated the full scene. This unit exercises the receipt boundary only.
const scene = { version: 1, kingdomId: '123', origin: 'live', layoutRevision: 'layout-1', collisionRevision: 7 } as RealmFoundedScene;
const supplied = RealmFoundedManifestSchema.parse({ version: 1, kingdomId: '123', origin: 'live', layoutRevision: 'layout-1', collisionRevision: 7,
  sceneHash: 'a'.repeat(64) });

describe('founded land receipt', () => {
  it('retains the supplied producer byte hash without re-encoding the scene', async () => {
    encode.mockClear();
    expect(await foundedLandReceipt(scene, supplied)).toEqual(supplied);
    expect(encode).not.toHaveBeenCalled();
  });

  it.each([
    { kingdomId: RealmFoundedManifestSchema.parse({ ...supplied, kingdomId: '124' }).kingdomId }, { origin: 'simulated' as const }, { layoutRevision: 'layout-2' }, { collisionRevision: 8 },
  ])('rejects receipt identity mismatch %o', async difference => {
    await expect(foundedLandReceipt(scene, { ...supplied, ...difference })).rejects.toThrow('does not match the installed scene');
  });

  it('uses the canonical producer receipt for a validated scene when none was supplied', async () => {
    const manifest = { ...supplied, sceneHash: 'b'.repeat(64) };
    encode.mockResolvedValueOnce({ manifest, bytes: new Uint8Array([1]) });
    expect(await foundedLandReceipt(scene)).toEqual(manifest);
    expect(encode).toHaveBeenCalledWith(scene);
  });
});
