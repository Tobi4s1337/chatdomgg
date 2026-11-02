import { MATERIALS, MAT } from '@chatdom/content/materials';
import { assembleForgeKeepsake } from '@chatdom/forge';
import type { ForgeLedgerEntry } from '@chatdom/shared';
import { rasterizeBlueprint } from '@chatdom/voxel';

/*
 * A remembered piece, drawn as a small isometric portrait on a 2D canvas: the same keepsake construction the wall at
 * the forge stands in its niches, lit from the upper left, with soft corner shading so its forms read as carved
 * rather than flat. No WebGL context is opened, so a page of portraits costs the walk nothing.
 */

export type ForgeKeepsakeKey = Pick<ForgeLedgerEntry, 'plan' | 'family' | 'kitRevision'>;
export const forgeKeepsakeKey = (entry: ForgeKeepsakeKey) =>
  `${entry.family}:${entry.kitRevision}:${entry.plan.kind}:${entry.plan.motif}:${entry.plan.finish}:${entry.plan.accent}`;

interface Face { readonly depth: number; readonly points: readonly number[]; readonly fill: string; readonly alpha: number }
interface Portrait { readonly faces: readonly Face[]; readonly bounds: readonly [number, number, number, number] }

const A = 1, B = 0.5, C = 1.12; // 2:1 dimetric; a cube stands a little taller than it is wide.
const project = (x: number, y: number, z: number): [number, number] => [(x - z) * A, (x + z) * B - y * C];
const LIGHT = { top: 1.04, front: 0.84, side: 0.66 } as const;
const METALS = new Set<number>([MAT.brass, MAT.goldLeaf, MAT.forgeCopper]);
const colours = new Map<number, [number, number, number]>(MATERIALS.materials.map(material => {
  const hex = material.colour.replace('#', '');
  return [material.id, [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]];
}));

const cache = new Map<string, Portrait>();

/** Build (once per piece) the faces a viewer at the front right sees, far to near. */
export function forgeKeepsakePortrait(entry: ForgeKeepsakeKey): Portrait {
  const key = forgeKeepsakeKey(entry), known = cache.get(key);
  if (known) return known;
  const asset = rasterizeBlueprint(assembleForgeKeepsake(entry.plan, entry.family, entry.kitRevision));
  const [W, H, D] = asset.size, at = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D ? 0 : asset.voxels[x + W * (y + H * z)]!;
  const glass = (m: number) => m === MAT.glass;
  // A face shows when the cell beside it is empty or glass (glass lets the light, and the eye, through).
  const open = (x: number, y: number, z: number) => { const m = at(x, y, z); return m === 0 || glass(m); };
  const lantern = entry.plan.kind === 'lantern';
  const faces: Face[] = [];
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  const push = (depth: number, corners: readonly (readonly [number, number, number])[], material: number, light: number, occlusion: number) => {
    const base = colours.get(material) ?? [200, 180, 150];
    let rgb = base.map(n => n * light * occlusion);
    let alpha = 1;
    if (glass(material)) {
      // Lantern glass carries its flame; other glass stays a cool pane.
      rgb = lantern ? [255 * Math.min(1.1, light + .1), 196 * light + 18, 104 * light] : [176 * light, 206 * light, 216 * light];
      alpha = lantern ? .92 : .5;
    } else if (METALS.has(material) && light === LIGHT.top) rgb = rgb.map(n => n * 1.12 + 10);
    const points = corners.flatMap(([x, y, z]) => project(x, y, z));
    for (let i = 0; i < points.length; i += 2) {
      minU = Math.min(minU, points[i]!); maxU = Math.max(maxU, points[i]!);
      minV = Math.min(minV, points[i + 1]!); maxV = Math.max(maxV, points[i + 1]!);
    }
    faces.push({ depth, points, alpha, fill: `rgb(${rgb.map(n => Math.round(Math.max(0, Math.min(255, n)))).join(',')})` });
  };
  // Corner shading: each solid neighbour around a face's open side darkens it a little.
  const shade = (cells: readonly (readonly [number, number, number])[]) => {
    let solid = 0;
    for (const [x, y, z] of cells) { const m = at(x, y, z); if (m && !glass(m)) solid++; }
    return Math.max(.66, 1 - solid * .055);
  };
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = at(x, y, z);
    if (!m) continue;
    const depth = x + y + z;
    if (open(x, y + 1, z) && !(glass(m) && glass(at(x, y + 1, z))))
      push(depth, [[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], m, LIGHT.top,
        shade([[x - 1, y + 1, z], [x + 1, y + 1, z], [x, y + 1, z - 1], [x, y + 1, z + 1], [x - 1, y + 1, z - 1], [x + 1, y + 1, z + 1], [x - 1, y + 1, z + 1], [x + 1, y + 1, z - 1]]));
    if (open(x, y, z + 1) && !(glass(m) && glass(at(x, y, z + 1))))
      push(depth, [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], m, LIGHT.front,
        shade([[x - 1, y, z + 1], [x + 1, y, z + 1], [x, y - 1, z + 1], [x, y + 1, z + 1]]));
    if (open(x + 1, y, z) && !(glass(m) && glass(at(x + 1, y, z))))
      push(depth, [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]], m, LIGHT.side,
        shade([[x + 1, y, z - 1], [x + 1, y, z + 1], [x + 1, y - 1, z], [x + 1, y + 1, z]]));
  }
  faces.sort((a, b) => a.depth - b.depth);
  const portrait: Portrait = { faces, bounds: [minU, minV, maxU, maxV] };
  cache.set(key, portrait);
  return portrait;
}

/**
 * Draw a remembered piece into `canvas`, fitted and centred with a soft contact shadow. The canvas keeps its CSS
 * size; its backing store follows the device pixel ratio.
 */
export function drawForgeKeepsake(canvas: HTMLCanvasElement, entry: ForgeKeepsakeKey, options: { readonly padding?: number; readonly ratio?: number } = {}): void {
  const ratio = options.ratio ?? Math.min(2, globalThis.devicePixelRatio || 1);
  const width = canvas.clientWidth || canvas.width, height = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  if (!context) return;
  const { faces, bounds: [minU, minV, maxU, maxV] } = forgeKeepsakePortrait(entry);
  const padding = (options.padding ?? .12) * Math.min(width, height);
  const scale = Math.min((width - padding * 2) / (maxU - minU), (height - padding * 2.3) / (maxV - minV)) * ratio;
  const offsetU = canvas.width / 2 - (minU + maxU) / 2 * scale, offsetV = canvas.height / 2 - (minV + maxV) / 2 * scale - padding * .15 * ratio;
  context.clearRect(0, 0, canvas.width, canvas.height);
  // Contact shadow under the footing (or the bracket).
  const footV = maxV * scale + offsetV;
  const shadow = context.createRadialGradient(canvas.width / 2, footV, 0, canvas.width / 2, footV, (maxU - minU) * scale * .55);
  shadow.addColorStop(0, '#2a170b55'); shadow.addColorStop(1, '#2a170b00');
  context.fillStyle = shadow;
  context.save(); context.translate(canvas.width / 2, footV); context.scale(1, .32);
  context.beginPath(); context.arc(0, 0, (maxU - minU) * scale * .55, 0, Math.PI * 2); context.fill(); context.restore();
  context.lineJoin = 'round';
  for (const face of faces) {
    const p = face.points;
    context.beginPath();
    context.moveTo(p[0]! * scale + offsetU, p[1]! * scale + offsetV);
    for (let i = 2; i < p.length; i += 2) context.lineTo(p[i]! * scale + offsetU, p[i + 1]! * scale + offsetV);
    context.closePath();
    context.globalAlpha = face.alpha;
    context.fillStyle = face.fill;
    // A hairline in the face's own colour closes the seams between neighbouring faces.
    context.strokeStyle = face.fill; context.lineWidth = Math.max(.6, ratio * .5);
    context.fill(); context.stroke();
  }
  context.globalAlpha = 1;
}
