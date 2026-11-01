import type { GrowthCivicPlace, VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';
import { Boxes, CIVIC_KITS, type CivicKit, type CivicStyle } from '../civic/kit';
import { marketStores } from '../civic/market';
import { createForgeExtension, FORGE_EXTENSION_FLAME } from './forge-extension';
import { humpbackDeckTop } from '../places/water/bridge/bridge';

export type { CivicStyle } from '../civic/kit';
export const GROWTH_CIVIC_PLACES = ['market', 'tavern', 'forge', 'castle-court', 'bridge'] as const satisfies readonly GrowthCivicPlace[];

/**
 * A local, ground-based civic addition, in build cells. +Y is up and +Z is its public face.
 * Most variants use a 64 × 64 × 32 envelope; bridge additions span the authored 144-cell humpback bridge.
 * Level 4 is the deliberately stable mature silhouette for levels beyond the authored range;
 * the actual supplied level remains in the blueprint ID. The host owns placement and lighting.
 */
export interface CivicBridgeSite { readonly water: number; readonly bank: number }
export function createGrowthCivicForm(place: GrowthCivicPlace, style: CivicStyle, level: number, bridgeSite?: CivicBridgeSite): VoxelBlueprint {
  if (!(GROWTH_CIVIC_PLACES as readonly string[]).includes(place)) throw new Error(`Unknown civic place: ${String(place)}`);
  if (style !== 'hearth' && style !== 'tide') throw new Error(`Unknown civic style: ${String(style)}`);
  if (!Number.isSafeInteger(level) || level < 1) throw new Error('Civic level must be a positive safe integer');
  const kit = CIVIC_KITS[style], stage = Math.min(level, 4), b = new Boxes();
  if (place === 'bridge') {
    if (!bridgeSite) throw new Error('Bridge growth requires the actual water and bank heights');
    bridge(b, kit, stage, bridgeSite);
  }
  else ({ market, tavern, forge, 'castle-court': court } as const)[place](b, kit, stage);
  return { version: 1, id: `growth-${style}-${place}-${level}`, styleId: STYLES[style].id,
    kind: 'civic', lattice: 'build', size: place === 'bridge' ? [144, 80, 32] : [64, 64, 32], boxes: b.list, windows: [] };
}

function stall(b: Boxes, k: CivicKit, x: number, awning: boolean): void {
  for (const dx of [0, 18]) for (const z of [4, 18]) b.add(x + dx, 0, z, x + dx + 2, 22, z + 2, k.trim);
  b.add(x, 9, 4, x + 20, 11, 20, k.trim);
  // A woven basket of loaves and two lidded crocks, instead of anonymous blocks.
  b.add(x + 2, 11, 7, x + 10, 12, 15, MAT.bark);
  b.add(x + 2, 12, 7, x + 10, 14, 15, MAT.thatch);
  b.add(x + 3, 14, 8, x + 9, 15, 14, MAT.cream);
  for (const dx of [3, 6]) {
    b.add(x + dx, 15, 9, x + dx + 2, 16, 13, MAT.cream);
    b.add(x + dx, 16, 10, x + dx + 2, 17, 12, MAT.cream);
  }
  for (const dx of [12, 16]) {
    b.add(x + dx, 11, 8, x + dx + 3, 15, 11, k.style === 'hearth' ? MAT.terracotta : MAT.stone);
    b.add(x + dx + 1, 15, 9, x + dx + 2, 16, 10, MAT.bark);
  }
  if (awning) {
    for (let dx = 0; dx < 20; dx += 4) b.add(x + dx, 22, 2, x + dx + 4, 24, 23, dx % 8 ? k.charge : k.field);
    b.add(x, 20, 21, x + 20, 22, 23, k.field);
  } else b.add(x, 21, 4, x + 20, 22, 20, k.trim);
}
function market(b: Boxes, k: CivicKit, stage: number): void {
  stall(b, k, 3, stage >= 3);
  if (stage >= 2) stall(b, k, 27, stage >= 3);
  if (stage >= 4) {
    // Reuse the established casks, basket and stores as a third market cluster.
    for (const box of marketStores(k).list) b.add(box.from[0] + 40, box.from[1], box.from[2] + 16,
      box.to[0] + 40, box.to[1], box.to[2] + 16, box.material);
  }
}
function window(b: Boxes, k: CivicKit, x: number, y: number): void {
  b.add(x, y, 21, x + 8, y + 10, 23, k.trim);
  b.add(x + 1, y + 1, 22, x + 7, y + 9, 24, MAT.glass);
  b.add(x + 3, y + 1, 23, x + 4, y + 9, 24, k.trim);
  b.add(x + 1, y + 5, 23, x + 7, y + 6, 24, k.trim);
}
function tavern(b: Boxes, k: CivicKit, stage: number): void {
  // The public face is +Z. The forecourt remains clear for outward fittings and steps.
  b.add(8, 0, 1, 56, 3, 24, k.stone);
  b.add(10, 3, 2, 54, 22, 23, k.wall);
  b.add(12, 3, 4, 52, 22, 22, MAT.air);
  b.add(28, 3, 22, 36, 17, 24, MAT.air);
  for (const x of [10, 52]) b.add(x, 3, 22, x + 2, 22, 24, k.trim);
  b.add(27, 3, 22, 28, 18, 24, k.trim);
  b.add(36, 3, 22, 37, 18, 24, k.trim);
  b.add(27, 17, 22, 37, 18, 24, k.trim);
  window(b, k, 15, 8); window(b, k, 41, 8);
  if (stage >= 2) {
    b.add(10, 22, 2, 54, 40, 23, k.wall);
    b.add(12, 23, 4, 52, 40, 22, MAT.air);
    b.add(8, 21, 1, 56, 23, 24, k.trim);
    for (const x of [10, 30, 52]) b.add(x, 23, 22, x + 2, 40, 24, k.trim);
    window(b, k, 17, 26); window(b, k, 39, 26);
  }
  const roofY = stage >= 2 ? 40 : 22;
  for (let i = 0; i < 10; i++) b.add(7 + i, roofY + i, 1, 57 - i, roofY + i + 1, 24, k.roof);
  if (stage >= 3) {
    // A projecting central dormer makes the new upper room legible above the eaves.
    b.add(24, 39, 18, 40, 49, 24, k.wall);
    for (let i = 0; i < 6; i++) b.add(22 + i, 49 + i, 17, 42 - i, 50 + i, 25, k.roof);
    b.add(27, 41, 23, 37, 48, 25, k.trim);
    b.add(28, 42, 24, 36, 47, 25, MAT.glass);
    b.add(31, 42, 24, 32, 47, 25, k.trim);
    lantern(b, k, 21, 17, 24); lantern(b, k, 39, 17, 24);
    b.add(44, 20, 23, 53, 22, 30, k.trim);
    b.add(45, 15, 28, 52, 20, 30, k.field);
  }
  if (stage >= 4) {
    b.add(12, 3, 25, 25, 5, 31, k.trim); b.add(39, 3, 25, 52, 5, 31, k.trim);
    for (const x of [13, 22, 40, 49]) b.add(x, 0, 26, x + 2, 3, 30, k.trim);
    b.add(27, 0, 24, 37, 2, 30, k.stone);
    // A high open porch leaves the doorway and its approach unobstructed.
    for (const x of [8, 53]) {
      b.add(x, 0, 27, x + 3, 21, 30, k.trim);
      b.add(x - 1, 19, 26, x + 4, 21, 31, k.base);
    }
    for (let x = 8; x < 56; x += 6)
      b.add(x, 21, 24, Math.min(x + 6, 56), 23, 31, (x / 6 | 0) % 2 ? k.field : k.charge);
    b.add(9, 19, 30, 55, 21, 31, k.field);
  }
}
function forge(b: Boxes, k: CivicKit, stage: number): void {
  b.list.push(...createForgeExtension(k, stage));
}
function banner(b: Boxes, k: CivicKit, x: number): void {
  b.add(x, 0, 6, x + 2, 35, 8, k.trim); b.add(x - 1, 35, 5, x + 3, 37, 9, MAT.brass);
  b.add(x + 2, 23, 6, x + 12, 34, 8, k.field);
  b.add(x + 5, 26, 7, x + 9, 31, 8, k.charge);
}
function court(b: Boxes, k: CivicKit, stage: number): void {
  b.add(13, 0, 3, 51, 2, 29, k.stone);
  b.add(18, 2, 8, 46, 4, 24, k.base);
  if (stage >= 2) { banner(b, k, 4); banner(b, k, 49); }
  if (stage >= 3) {
    // Faceted basin with a shallow water surface and a stone central spout.
    b.add(20, 4, 9, 44, 8, 23, k.stone);
    b.add(22, 7, 11, 42, 8, 21, MAT.waterbed);
    b.add(29, 8, 13, 35, 17, 19, k.stone);
    b.add(27, 17, 11, 37, 19, 21, k.base);
    b.add(30, 19, 14, 34, 23, 18, MAT.waterbed);
  }
  if (stage >= 4) {
    for (const x of [14, 46]) { b.add(x, 2, 9, x + 4, 10, 13, k.base); lantern(b, k, x, 10, 9); }
    // A ceremonial open-backed arcade frames the fountain without filling the court.
    for (const x of [13, 47]) {
      b.add(x, 2, 3, x + 4, 28, 7, k.stone);
      b.add(x - 1, 26, 2, x + 5, 29, 8, k.base);
    }
    b.add(13, 28, 3, 51, 31, 7, k.stone);
    b.add(16, 31, 3, 48, 33, 7, k.base);
    for (const x of [17, 27, 37, 47]) b.add(x, 33, 3, x + 4, 36, 7, k.stone);
    b.add(26, 19, 7, 38, 28, 8, k.field);
    b.add(30, 22, 8, 34, 26, 9, k.charge);
  }
}
function lantern(b: Boxes, k: CivicKit, x: number, y: number, z: number): void {
  b.add(x, y, z, x + 4, y + 1, z + 4, k.trim);
  b.add(x + 1, y + 1, z + 1, x + 3, y + 5, z + 3, MAT.glass);
  b.add(x, y + 5, z, x + 4, y + 6, z + 4, k.trim);
  b.add(x + 1, y + 6, z + 1, x + 3, y + 7, z + 3, MAT.brass);
}
// Review-site positions match the 144-cell humpback bridge's parapet, above its deck.
// Actual site heights come from the host's water and bank frame.
const BRIDGE_POSTS = [[20, 0], [120, 28], [20, 28], [120, 0], [40, 0], [100, 28], [40, 28], [100, 0]] as const;
function bridge(b: Boxes, k: CivicKit, stage: number, site: CivicBridgeSite): void {
  for (const [x, z] of BRIDGE_POSTS.slice(0, stage * 2)) {
    const heights = [0, 1, 2, 3].map(dx => humpbackDeckTop(x + dx, site.water, site.bank) + 4);
    const y = Math.max(...heights);
    heights.forEach((height, dx) => b.add(x + dx, height, z, x + dx + 1, y + 2, z + 4, k.stone));
    b.add(x + 1, y + 2, z + 1, x + 3, y + 11, z + 3, k.trim);
    lantern(b, k, x, y + 11, z);
  }
  if (stage >= 4) {
    // Paired standards rise on the parapets either side of the crown's existing arms.
    // Their cloth stays outside the full width of the walk and the span remains untouched.
    for (const z of [0, 28]) for (const x of [54, 86]) {
      const heights = [0, 1, 2, 3].map(dx => humpbackDeckTop(x + dx, site.water, site.bank) + 4);
      const y = Math.max(...heights);
      heights.forEach((height, dx) => b.add(x + dx, height, z, x + dx + 1, y + 2, z + 4, k.stone));
      b.add(x, y + 2, z, x + 4, y + 4, z + 4, k.base);
      b.add(x + 1, y + 4, z + 1, x + 3, y + 25, z + 3, k.trim);
      b.add(x, y + 24, z, x + 4, y + 26, z + 4, k.band);
      // Hearth finishes in a gabled finial; Tide carries a forked masthead.
      if (k.style === 'hearth') {
        b.add(x + 1, y + 26, z + 1, x + 3, y + 29, z + 3, k.roof);
        b.add(x + 1, y + 29, z + 1, x + 3, y + 30, z + 3, MAT.brass);
      } else {
        b.add(x, y + 26, z + 1, x + 1, y + 30, z + 3, k.trim);
        b.add(x + 3, y + 26, z + 1, x + 4, y + 30, z + 3, k.trim);
        b.add(x + 1, y + 27, z + 1, x + 3, y + 28, z + 3, MAT.brass);
      }
      const left = x === 54, a = left ? x - 9 : x + 3, c = left ? x + 1 : x + 13;
      b.add(a, y + 22, z + 1, c, y + 24, z + 3, k.trim);
      b.add(a, y + 13, z + 1, c, y + 22, z + 3, k.field);
      // A split tail and a simple light-shaped charge make the cloth readable at a distance.
      b.add(left ? a : a + 2, y + 11, z + 1, left ? c - 2 : c, y + 13, z + 3, k.field);
      b.add(a + 4, y + 16, z, a + 6, y + 20, z + 4, k.charge);
    }
  }
}

/** Local build-cell centres for public civic light. These are not citizen presence windows.
 * The host supplies the actual glow and light field, and owns their lifetime with the form. */
export interface CivicGrowthLight {
  readonly kind: 'window' | 'lantern' | 'hearth';
  readonly centre: readonly [number, number, number];
}
export function growthCivicLights(place: GrowthCivicPlace, level: number, bridgeSite?: CivicBridgeSite): readonly CivicGrowthLight[] {
  if (!(GROWTH_CIVIC_PLACES as readonly string[]).includes(place) || !Number.isSafeInteger(level) || level < 1)
    throw new Error('A civic light needs a known place and positive safe level');
  const stage = Math.min(level, 4);
  if (place === 'tavern') {
    const lights: CivicGrowthLight[] = [15, 41].map(x => ({ kind: 'window', centre: [x + 4, 13, 24] }));
    if (stage >= 2) lights.push(...[17, 39].map(x => ({ kind: 'window' as const, centre: [x + 4, 31, 24] as const })));
    if (stage >= 3) lights.push({ kind: 'window', centre: [32, 44, 25] });
    if (stage >= 3) lights.push(...[21, 39].map(x => ({ kind: 'lantern' as const, centre: [x + 2, 20, 26] as const })));
    return lights;
  }
  if (place === 'bridge') {
    if (!bridgeSite) throw new Error('Bridge lights require the actual water and bank heights');
    return BRIDGE_POSTS.slice(0, stage * 2).map(([x, z]) => ({ kind: 'lantern',
      centre: [x + 2, Math.max(...[0, 1, 2, 3].map(dx => humpbackDeckTop(x + dx, bridgeSite.water, bridgeSite.bank))) + 18, z + 2] }));
  }
  if (place === 'castle-court' && stage >= 4) return [14, 46].map(x => ({ kind: 'lantern', centre: [x + 2, 13, 11] }));
  if (place === 'forge') return [{ kind: 'hearth', centre: FORGE_EXTENSION_FLAME }];
  return [];
}

/** The court's basin surface, in build cells; the host owns water rendering and disposal. */
export function growthCivicWater(place: GrowthCivicPlace, level: number): { readonly from: readonly [number, number, number]; readonly to: readonly [number, number, number] } | null {
  if (!(GROWTH_CIVIC_PLACES as readonly string[]).includes(place) || !Number.isSafeInteger(level) || level < 1)
    throw new Error('Civic water needs a known place and positive safe level');
  if (place === 'castle-court' && level >= 3) return { from: [22, 8, 11], to: [42, 8, 21] };
  if (place === 'forge' && level >= 4) return { from: [51, 7, 26], to: [60, 7, 30] };
  return null;
}
