import type { ContentWindow, ForgeConnector, ForgePieceDefinition, VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../materials';
import { addCells, normalVector, turnNormal, turnPoint, turnSpace, type QuarterTurn, type Space } from './grammar';

/** Bench-only review assembly: integer build-cell translations after positive-Y quarter turns. Not a home protocol. */
export interface ForgeReviewInstance {
  readonly id: string;
  readonly pieceId: string;
  readonly position: readonly [number, number, number];
  readonly quarterTurns: QuarterTurn;
}
export interface ForgeReviewFixture {
  readonly familyId: 'hearthfold' | 'tidewake' | 'grovebough';
  readonly instances: readonly ForgeReviewInstance[];
  readonly entrance: readonly [number, number, number];
}
export type LeafPose = 'closed' | 'open' | 'none';
type Box = VoxelBlueprint['boxes'][number];

/** The reserved lot every review assembly stays inside, with the street at +Z. */
export const REVIEW_LOT = [64, 160, 128] as const;

export function rasterize(blueprint: VoxelBlueprint): Uint16Array {
  const [sx, sy, sz] = blueprint.size;
  const voxels = new Uint16Array(sx * sy * sz);
  for (const { from, to, material } of blueprint.boxes) {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) {
      const row = sx * (y + sy * z);
      voxels.fill(material, row + from[0], row + to[0]);
    }
  }
  return voxels;
}

/** Final occupancy as solid boxes only (x, then z, then y runs), so a piece's carves never reach a neighbour. */
export function solidBoxes(blueprint: VoxelBlueprint): Box[] {
  const [sx, sy, sz] = blueprint.size;
  const voxels = rasterize(blueprint), done = new Uint8Array(voxels.length), boxes: Box[] = [];
  const at = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  const free = (x: number, y: number, z: number, m: number) => voxels[at(x, y, z)] === m && !done[at(x, y, z)];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const m = voxels[at(x, y, z)]!;
    if (!m || done[at(x, y, z)]) continue;
    let x1 = x + 1, z1 = z + 1, y1 = y + 1;
    while (x1 < sx && free(x1, y, z, m)) x1++;
    const row = (zz: number, yy: number) => { for (let xx = x; xx < x1; xx++) if (!free(xx, yy, zz, m)) return false; return true; };
    while (z1 < sz && row(z1, y)) z1++;
    const layer = (yy: number) => { for (let zz = z; zz < z1; zz++) if (!row(zz, yy)) return false; return true; };
    while (y1 < sy && layer(y1)) y1++;
    for (let yy = y; yy < y1; yy++) for (let zz = z; zz < z1; zz++) for (let xx = x; xx < x1; xx++) done[at(xx, yy, zz)] = 1;
    boxes.push({ from: [x, y, z], to: [x1, y1, z1], material: m });
  }
  return boxes;
}

export interface PlacedConnector extends ForgeConnector { readonly instance: string; readonly local: ForgeConnector }

export function placeConnector(connector: ForgeConnector, instance: ForgeReviewInstance): PlacedConnector {
  return { ...connector, instance: instance.id, local: connector, point: [...addCells(turnPoint(connector.point, instance.quarterTurns), instance.position)], normal: turnNormal(connector.normal, instance.quarterTurns) };
}

export function placeSpace(box: Space, instance: ForgeReviewInstance): Space {
  return turnSpace(box, instance.quarterTurns, instance.position);
}

/** A leaf box in its closed or open pose, still in the frame's local cells. */
export function poseLeafBox(box: Space, door: NonNullable<ForgePieceDefinition['door']>, pose: 'closed' | 'open'): Space {
  if (pose === 'closed') return box;
  const h = door.hinge, q: QuarterTurn = door.openQuarterTurns === 1 ? 1 : 3;
  const local = turnSpace({ from: [box.from[0] - h[0], box.from[1] - h[1], box.from[2] - h[2]], to: [box.to[0] - h[0], box.to[1] - h[1], box.to[2] - h[2]] }, q);
  return { from: addCells(local.from, h), to: addCells(local.to, h) };
}

/**
 * Mates two placed connectors, throwing on a mismatched profile, a separated point or normals that do not oppose.
 * Equal IDs carry identical documented sections, so this is the whole compatibility rule.
 */
export function mateConnectors(a: PlacedConnector, b: PlacedConnector): void {
  if (a.profile !== b.profile) throw new Error(`${a.instance}/${a.id} (${a.profile}) cannot mate ${b.instance}/${b.id} (${b.profile}).`);
  if (a.point.some((v, i) => v !== b.point[i])) throw new Error(`${a.instance}/${a.id} and ${b.instance}/${b.id} do not meet at one point.`);
  const na = normalVector(a.normal), nb = normalVector(b.normal);
  if (na.some((v, i) => v !== -nb[i]!)) throw new Error(`${a.instance}/${a.id} and ${b.instance}/${b.id} do not face each other.`);
}

export function findMates(connectors: readonly PlacedConnector[]): [PlacedConnector, PlacedConnector][] {
  const byPoint = new Map<string, PlacedConnector[]>();
  for (const c of connectors) { const key = c.point.join(','); byPoint.set(key, [...(byPoint.get(key) ?? []), c]); }
  const mates: [PlacedConnector, PlacedConnector][] = [];
  for (const group of byPoint.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = group[i]!, b = group[j]!;
    if (a.instance === b.instance || a.profile !== b.profile) continue;
    try { mateConnectors(a, b); mates.push([a, b]); } catch { /* same point, same profile, same facing: twins, not a mate */ }
  }
  return mates;
}

export interface ComposedForgeHome {
  readonly blueprint: VoxelBlueprint;
  readonly connectors: readonly PlacedConnector[];
}

/**
 * Composes a review fixture from the real definitions into one unoccupied home-sized model. Each piece contributes
 * its final solid cells only; windows keep `<instanceId>-<windowId>` IDs, never deduplicated.
 */
export function composeForgeFixture(fixture: ForgeReviewFixture, pieces: readonly ForgePieceDefinition[], leaf: LeafPose): ComposedForgeHome {
  const boxes: Box[] = [], windows: ContentWindow[] = [], connectors: PlacedConnector[] = [];
  const ids = new Set<string>();
  let styleId: VoxelBlueprint['styleId'] | undefined;
  for (const instance of fixture.instances) {
    if (ids.has(instance.id)) throw new Error(`${fixture.familyId}: duplicate review instance ${instance.id}.`);
    ids.add(instance.id);
    const piece = pieces.find(p => p.id === instance.pieceId);
    if (!piece) throw new Error(`${fixture.familyId}: review instance ${instance.id} names unknown piece ${instance.pieceId}.`);
    if (piece.familyId !== fixture.familyId) throw new Error(`${instance.id}: ${piece.id} belongs to ${piece.familyId}, not ${fixture.familyId}.`);
    if (instance.position.some(v => !Number.isInteger(v)) || ![0, 1, 2, 3].includes(instance.quarterTurns)) throw new Error(`${instance.id}: positions are integer cells and turns are 0..3.`);
    styleId ??= piece.blueprint.styleId;
    for (const box of solidBoxes(piece.blueprint)) boxes.push({ ...placeSpace(box, instance), material: box.material });
    if (piece.door && leaf !== 'none') {
      for (const box of solidBoxes(piece.door.leaf)) boxes.push({ ...placeSpace(poseLeafBox(box, piece.door, leaf), instance), material: box.material });
    }
    for (const w of piece.blueprint.windows) {
      windows.push({ ...w, id: `${instance.id}-${w.id}`, centre: [...addCells(turnPoint(w.centre, instance.quarterTurns), instance.position)], facing: turnNormal(w.facing, instance.quarterTurns) as ContentWindow['facing'] });
    }
    connectors.push(...piece.connectors.map(c => placeConnector(c, instance)));
  }
  for (const box of boxes) if (box.from.some((v, i) => v < 0 || box.to[i]! > REVIEW_LOT[i]!)) throw new Error(`${fixture.familyId}: a piece leaves the reserved lot at ${box.from.join(',')}.`);
  if (!styleId) throw new Error(`${fixture.familyId}: an empty review fixture.`);
  const id = `forge-review-${fixture.familyId}-${leaf === 'none' ? 'shell' : `door-${leaf}`}`;
  return { connectors, blueprint: { version: 1, id, styleId, kind: 'home', lattice: 'build', size: [...REVIEW_LOT], boxes, windows } };
}

export const isSolid = (material: number | undefined) => material !== undefined && material !== MAT.air;

/** FNV-1a over the model's canonical JSON: lets captures prove the built bench shows the current source. */
export function fingerprint(blueprint: VoxelBlueprint): string {
  const text = JSON.stringify(blueprint);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
