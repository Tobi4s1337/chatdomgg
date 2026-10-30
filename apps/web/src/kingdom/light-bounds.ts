/** Include the whole reserved lot and enough air for the outward window flood. */
export function inhabitedLightBounds(homes: readonly { readonly lot: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number } }[], spill = 16): {
  minX: number; maxX: number; minZ: number; maxZ: number;
} {
  if (!homes.length || !Number.isFinite(spill) || spill < 0) throw new Error('Light bounds need homes and a nonnegative spill');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const { lot } of homes) {
    if (![lot.minX, lot.maxX, lot.minZ, lot.maxZ].every(Number.isFinite) || lot.minX >= lot.maxX || lot.minZ >= lot.maxZ) throw new Error('Invalid home reservation');
    minX = Math.min(minX, lot.minX); maxX = Math.max(maxX, lot.maxX);
    minZ = Math.min(minZ, lot.minZ); maxZ = Math.max(maxZ, lot.maxZ);
  }
  return { minX: minX - spill, maxX: maxX + spill, minZ: minZ - spill, maxZ: maxZ + spill };
}
