import type { VoxelBlueprint } from '@chatdom/shared';

export interface PieceFace { points: string; fill: string }
export interface PiecePicture { viewBox: string; faces: PieceFace[] }

const C = Math.cos(Math.PI / 6), S = .5;
/** Corner and street side face the viewer: +X runs down to the right, +Z down to the left, +Y up. */
const project = (x: number, y: number, z: number): [number, number] => [(x - z) * C, (x + z) * S - y];

/** Light falls from above and over the left shoulder: tops brightest, the street (+Z) side next, the +X side in shade. */
function shade(colour: string, factor: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim())?.[1];
  if (!hex) return colour;
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
  const channel = (i: number) => Math.round(Math.min(255, Math.max(0, parseInt(full.slice(i, i + 2), 16) * factor))).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/**
 * A small render of the actual voxel piece for its card (Artstyle §11: items are shown as renders of the real item):
 * every solid box drawn as an isometric block in its own material colour, far boxes first. Null when nothing is solid.
 */
export function piecePicture(blueprint: VoxelBlueprint, colourOf: (material: number) => string | undefined, limit = 600): PiecePicture | null {
  const boxes = blueprint.boxes.filter(box => box.material).slice(0, limit)
    .map(box => ({ box, depth: box.from[0] + box.from[2] + (box.to[0] - box.from[0] + box.to[2] - box.from[2]) / 2, low: box.from[1] }))
    .sort((a, b) => a.depth - b.depth || a.low - b.low);
  if (!boxes.length) return null;
  const faces: PieceFace[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polygon = (corners: [number, number, number][], fill: string) => {
    const points = corners.map(([x, y, z]) => {
      const [px, py] = project(x, y, z);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      return `${px.toFixed(2)},${py.toFixed(2)}`;
    }).join(' ');
    faces.push({ points, fill });
  };
  for (const { box } of boxes) {
    const [x0, y0, z0] = box.from, [x1, y1, z1] = box.to, colour = colourOf(box.material) ?? '#b08a52';
    polygon([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], shade(colour, .82));
    polygon([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], shade(colour, .62));
    polygon([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], shade(colour, 1.08));
  }
  const pad = Math.max(maxX - minX, maxY - minY) * .06 + .5;
  return { viewBox: `${(minX - pad).toFixed(2)} ${(minY - pad).toFixed(2)} ${(maxX - minX + pad * 2).toFixed(2)} ${(maxY - minY + pad * 2).toFixed(2)}`, faces };
}
