import { StyleIdSchema, VoxelBlueprintSchema, type VoxelBlueprint } from '../deps';
import type { EmoteMask } from '../types';

/** Kingdom fabrics and fittings for a standing banner; IDs come from the caller's registry subset. */
export interface EmoteBannerMaterials {
  /** The cloth field the charge is laid on. */
  readonly field: number;
  /** Stitched edge and hem. */
  readonly trim: number;
  /** Pole and crossbar. */
  readonly pole: number;
  /** Finial and crossbar caps. */
  readonly finial: number;
  /** Stone foot the pole is set into. */
  readonly footing: number;
}

export interface EmoteBannerLayout {
  readonly blueprint: VoxelBlueprint;
  /** Lower-left cell of the charge on the cloth's front face (+Z), in banner-local build cells. */
  readonly chargeOrigin: readonly [number, number, number];
  /** Footprint of the stone foot (x, z), centred under the pole. */
  readonly footprintCells: readonly [number, number];
  /** Top of the finial, where a host may attach a pennant or a light. */
  readonly finialAnchor: readonly [number, number, number];
}

const BANNER_STYLE = StyleIdSchema.parse('emote');
/** The cloth's lowest point stays above head height so citizens walk beneath it. */
export const BANNER_CLEARANCE_CELLS = 18;

/**
 * A plaza banner: a stone foot, a pole with a crossbar and finial, and a swallow-tailed cloth that
 * hangs in front of the pole with the emote's front silhouette laid on it as an appliqué charge.
 * The charge is inlaid in the cloth and stands one cell proud, so it reads in raking light and from
 * the side without becoming a second sculpture. Only the mask's own materials are used; the cloth
 * never invents a colour. Front faces +Z.
 */
export function layoutEmoteBanner(charge: EmoteMask, materials: EmoteBannerMaterials, id: string): EmoteBannerLayout {
  const { width: cw, height: ch, materialIds } = charge;
  if (!Number.isInteger(cw) || !Number.isInteger(ch) || cw < 1 || ch < 1 || materialIds.length !== cw * ch) throw new Error('The banner charge mask is malformed.');
  const margin = 4, top = 4, tail = 9;
  const clothW = cw + margin * 2 + (cw % 2), clothH = ch + top + margin + tail;
  const width = clothW + 4, poleX = Math.floor(width / 2) - 1;
  const clothBottom = BANNER_CLEARANCE_CELLS, clothTop = clothBottom + clothH, crossY = clothTop, poleTop = crossY + 4;
  const height = poleTop + 3, depth = 7, footW = 8, footD = 6;
  const clothX = Math.floor((width - clothW) / 2), poleZ = 2, clothZ = 4, reliefZ = 5;
  const boxes: VoxelBlueprint['boxes'] = [
    // Stone foot with a chamfered top course, then the pole set into it.
    { from: [poleX - 3, 0, 0], to: [poleX + 5, 2, footD], material: materials.footing },
    { from: [poleX - 2, 2, 1], to: [poleX + 4, 3, footD - 1], material: materials.footing },
    { from: [poleX, 0, poleZ], to: [poleX + 2, poleTop, poleZ + 2], material: materials.pole },
    // Crossbar the sleeve hangs from, with brass caps at both ends.
    { from: [clothX - 1, crossY, poleZ + 1], to: [clothX + clothW + 1, crossY + 1, clothZ + 1], material: materials.pole },
    { from: [clothX - 2, crossY - 1, poleZ + 1], to: [clothX - 1, crossY + 2, clothZ + 1], material: materials.finial },
    { from: [clothX + clothW + 1, crossY - 1, poleZ + 1], to: [clothX + clothW + 2, crossY + 2, clothZ + 1], material: materials.finial },
    // Finial: collar, ball, spike.
    { from: [poleX - 1, poleTop - 1, poleZ - 1], to: [poleX + 3, poleTop, poleZ + 3], material: materials.finial },
    { from: [poleX, poleTop, poleZ], to: [poleX + 2, poleTop + 2, poleZ + 2], material: materials.finial },
    { from: [poleX, poleTop + 2, poleZ], to: [poleX + 1, poleTop + 3, poleZ + 1], material: materials.finial },
  ];
  // The cloth: a trimmed field with a swallowtail cut up from the bottom centre.
  const notch = (x: number, y: number): boolean => {
    const fromBottom = y - clothBottom, centre = (clothW - 1) / 2, off = Math.abs(x - clothX - centre);
    return fromBottom < tail && off < (tail - fromBottom) * (clothW / 2) / (tail * 1.6);
  };
  for (let y = clothBottom; y < clothTop; y++) {
    let run: { from: number; material: number } | null = null;
    for (let x = clothX; x <= clothX + clothW; x++) {
      let material = 0;
      if (x < clothX + clothW && !notch(x, y)) {
        const edge = x === clothX || x === clothX + clothW - 1 || y === clothTop - 1 || y === clothTop - 3 || notch(x, y - 1) || y === clothBottom || notch(x - 1, y) || notch(x + 1, y);
        material = edge ? materials.trim : materials.field;
      }
      if (run && run.material !== material) { if (run.material) boxes.push({ from: [run.from, y, clothZ], to: [x, y + 1, clothZ + 1], material: run.material }); run = null; }
      if (!run) run = { from: x, material };
    }
  }
  // The sleeve wraps the crossbar: one row behind the cloth's top two rows.
  boxes.push({ from: [clothX, clothTop - 2, clothZ - 1], to: [clothX + clothW, clothTop, clothZ], material: materials.field });
  // The charge: inlaid in the cloth and standing one cell proud. Mask rows are Y up.
  const chargeX = clothX + Math.floor((clothW - cw) / 2), chargeY = clothBottom + tail + margin - 1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw;) {
    const material = materialIds[x + cw * y]!;
    let end = x + 1;
    while (end < cw && materialIds[end + cw * y] === material) end++;
    if (material) boxes.push({ from: [chargeX + x, chargeY + y, clothZ], to: [chargeX + end, chargeY + y + 1, reliefZ + 1], material });
    x = end;
  }
  const blueprint = VoxelBlueprintSchema.parse({ version: 1, id, styleId: BANNER_STYLE, kind: 'prop', lattice: 'build', size: [width, height, depth], boxes, windows: [] });
  return { blueprint, chargeOrigin: [chargeX, chargeY, reliefZ + 1], footprintCells: [footW, footD], finialAnchor: [poleX + .5, height, poleZ + .5] };
}
