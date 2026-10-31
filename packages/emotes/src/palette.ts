import { MaterialRegistrySchema, type MaterialRegistry } from './deps';
import { EMOTE_COMPILED_BUDGET } from './profiles';

export interface PaletteEntry {
  readonly id: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Redmean colour distance, squared and scaled by 512 so it stays in exact integers. Pure integer
 * arithmetic makes every snap identical on every engine, which keeps geometry hashes stable between
 * the server worker that compiles and any client that re-verifies.
 */
export function colourDistance2(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2, sum = r1 + r2;
  return (1024 + sum) * dr * dr + 2048 * dg * dg + (1534 - sum) * db * db;
}

/** The ordinary redmean distance (0–~765), for thresholds written in familiar units. */
export function distanceThreshold2(distance: number): number {
  return 512 * distance * distance;
}

export type PaletteResult = { ok: true; entries: readonly PaletteEntry[] } | { ok: false; message: string };

/**
 * The kingdom supplies the explicit subset; nothing outside the real registry can enter the world.
 * Entries are sorted by material ID so equal distances always resolve to the lower ID.
 */
export function buildEmotePalette(registry: MaterialRegistry, allowedMaterialIds: readonly number[]): PaletteResult {
  const parsed = MaterialRegistrySchema.safeParse(registry);
  if (!parsed.success) return { ok: false, message: 'The material registry is not valid.' };
  if (!Array.isArray(allowedMaterialIds) || allowedMaterialIds.length === 0) return { ok: false, message: 'The kingdom palette needs at least one material.' };
  if (allowedMaterialIds.length > EMOTE_COMPILED_BUDGET.maxAllowedMaterials) return { ok: false, message: `The kingdom palette may hold at most ${EMOTE_COMPILED_BUDGET.maxAllowedMaterials} materials.` };
  if (new Set(allowedMaterialIds).size !== allowedMaterialIds.length) return { ok: false, message: 'The kingdom palette repeats a material.' };
  const byId = new Map(parsed.data.materials.map(material => [material.id, material]));
  const entries: PaletteEntry[] = [];
  for (const id of allowedMaterialIds) {
    const material = Number.isInteger(id) ? byId.get(id) : undefined;
    if (!material) return { ok: false, message: `Material ${String(id)} is not in the registry.` };
    if (id === 0 || !material.solid) return { ok: false, message: `Material ${material.name} is not solid and cannot carve an emote.` };
    const hex = Number.parseInt(material.colour.slice(1), 16);
    entries.push({ id, r: hex >> 16 & 255, g: hex >> 8 & 255, b: hex & 255 });
  }
  entries.sort((a, b) => a.id - b.id);
  return { ok: true, entries };
}

/** Index into `entries` of the nearest colour; the first (lowest ID) wins a tie. */
export function nearestPaletteIndex(entries: readonly PaletteEntry[], r: number, g: number, b: number): number {
  let best = 0, bestDistance = Infinity;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const distance = colourDistance2(r, g, b, entry.r, entry.g, entry.b);
    if (distance < bestDistance) { best = i; bestDistance = distance; }
  }
  return best;
}
