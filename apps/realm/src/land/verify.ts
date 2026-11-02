import { decodeBakedMetadata, decodeBakedRegion, decodeBakedSurface } from '../../../../packages/world/src/grand/baked/codec';
import type { LandArtifactStore, StoredLandBinding } from './store';

/** Reopen every immutable byte before publication. This entry has no generator, kit or mesher dependency. */
export async function verifyLandArtifact(store: LandArtifactStore, binding: StoredLandBinding, check = () => {}) {
  const metadataBytes = await store.read(binding.manifest);
  const metadata = decodeBakedMetadata(metadataBytes);
  if (metadata.kingdomId !== binding.kingdomId || metadata.recipeHash !== binding.recipeHash
    || metadata.sourcePlanHash !== binding.sourcePlanHash || metadata.sourcePlanRevision !== binding.layoutRevision)
    throw new Error('Baked land does not match the founded receipt binding');
  const surfaceBytes = await store.read(metadata.surface);
  const surface = decodeBakedSurface(surfaceBytes, metadata.version);
  if (surface.size !== metadata.size || surface.height !== metadata.height || surface.seaLevel !== metadata.seaLevel)
    throw new Error('Baked surface does not match the land metadata');
  const materials = new Set(metadata.palette.map(material => material.id));
  for (const region of metadata.regions) for (const ref of region.meshes) {
    check();
    const bytes = await store.read(ref);
    const mesh = decodeBakedRegion(bytes, metadata.version);
    if (mesh.rx !== ref.rx || mesh.rz !== ref.rz || mesh.level !== ref.level || mesh.minY !== ref.minY
      || mesh.maxY !== ref.maxY || mesh.quads.length / 2 !== ref.quadCount) throw new Error('Baked mesh does not match its region reference');
    for (let i = 0; i < mesh.quads.length; i += 2) {
      const a = mesh.quads[i]!, b = mesh.quads[i + 1]!, face = (a >>> 25) & 7, axis = face >> 1;
      if (!materials.has(b & 255)) throw new Error('Baked mesh uses a material outside its palette');
      const y = ((b >>> 20) & 15) * 32 + ((a >>> 5) & 31);
      const span = axis === 1 ? (face % 2 === 0 ? 1 : 0)
        : (axis + 1) % 3 === 1 ? ((a >>> 15) & 31) + 1 : ((a >>> 20) & 31) + 1;
      if ((y + span) * (1 << mesh.level) > metadata.height) throw new Error('Baked mesh exceeds the declared world height');
    }
  }
  return { metadata, surface };
}
