import { VOXEL_METRES, VoxelBlueprintSchema, type Vec3 } from '@chatdom/shared';
import type { BoundsXZ } from '../settlement/types';
import { transformCardinalPoint } from '../settlement/geometry';
import { finiteVec3 } from '../interactions/geometry';
import { AUTHORED_PIER_BUDGET as B, type AuthoredPierDetail, type AuthoredPierFailure, type AuthoredPierProposal, type AuthoredPierWork } from './pier-authored-types';

export class AuthoredPierError extends Error {
  constructor(readonly reason: AuthoredPierFailure, readonly detail: AuthoredPierDetail) { super(reason); }
}
export function deny(reason: AuthoredPierFailure, detail: AuthoredPierDetail): never { throw new AuthoredPierError(reason, detail); }
export const EPS = 1e-6;
export const validPoint = (v: unknown): v is Vec3 => finiteVec3(v) && v.every(n => Math.abs(n) < 1_000_000);
export const samePoint = (a: Vec3, b: Vec3): boolean => a.every((n, i) => Math.abs(n - b[i]!) <= EPS);
export const localPoint = (p: AuthoredPierProposal, v: Vec3): Vec3 => transformCardinalPoint([0, 0, 0], ((4 - p.anchor.turn) % 4) as 0 | 1 | 2 | 3,
  [v[0] - p.anchor.root[0], v[1] - p.deckY, v[2] - p.anchor.root[2]]);
export function worldBounds(p: AuthoredPierProposal, b: BoundsXZ): BoundsXZ {
  const a = transformCardinalPoint(p.anchor.root, p.anchor.turn, [b.minX, 0, b.minZ]);
  const c = transformCardinalPoint(p.anchor.root, p.anchor.turn, [b.maxX, 0, b.maxZ]);
  return { minX: Math.min(a[0], c[0]), maxX: Math.max(a[0], c[0]), minZ: Math.min(a[2], c[2]), maxZ: Math.max(a[2], c[2]) };
}
export const validBounds = (b: BoundsXZ): boolean => b && [b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite) && b.minX < b.maxX && b.minZ < b.maxZ;
export const within = (v: Vec3, b: BoundsXZ, pad = 0): boolean => v[0] >= b.minX - pad && v[0] <= b.maxX + pad && v[2] >= b.minZ - pad && v[2] <= b.maxZ + pad;
export interface AuthoredPieceBounds { readonly id: string; readonly world: BoundsXZ; readonly local: BoundsXZ }
export interface AuthoredHeader { readonly identity: string; readonly proposal: AuthoredPierProposal; readonly pieces: readonly AuthoredPieceBounds[]; readonly head: AuthoredPieceBounds }

/** Bounded canonical JSON before schema cloning or voxel allocation. No toJSON/getter behavior is invoked. */
function canonical(value: unknown, work: AuthoredPierWork): string {
  const chunks: string[] = [];
  let units = 0, nodes = 0;
  const put = (s: string) => {
    let bytes = 0;
    for (const char of s) { const code = char.codePointAt(0)!; bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
    if (units + bytes > B.proposalBytes) deny('budget-exceeded', { stage: 'header', message: 'Proposal text exceeds its UTF-8 budget.' });
    units += bytes; work.proposalBytes = units; chunks.push(s);
  };
  const visit = (v: unknown, depth: number): void => {
    if (depth > 16 || ++nodes > 524_288) deny('budget-exceeded', { stage: 'header' });
    if (v === null) { put('null'); return; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) deny('invalid-proposal', { stage: 'header' }); put(JSON.stringify(v)); return; }
    if (typeof v === 'boolean') { put(v ? 'true' : 'false'); return; }
    if (typeof v === 'string') { if (v.length > 256) deny('budget-exceeded', { stage: 'header' }); put(JSON.stringify(v)); return; }
    if (typeof v !== 'object') deny('invalid-proposal', { stage: 'header' });
    if (Array.isArray(v)) {
      if (v.length > B.blueprintWrites) deny('budget-exceeded', { stage: 'header' });
      put('['); for (let i = 0; i < v.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(v, String(i));
        if (!descriptor || !('value' in descriptor)) deny('invalid-proposal', { stage: 'header' });
        if (i) put(','); visit(descriptor.value, depth + 1);
      } put(']'); return;
    }
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) deny('invalid-proposal', { stage: 'header' });
    const keys: string[] = [];
    for (const k in v) if (Object.hasOwn(v, k)) {
      if (keys.length >= 32 || k.length > 128) deny('budget-exceeded', { stage: 'header' });
      keys.push(k);
    }
    keys.sort(); put('{');
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!, descriptor = Object.getOwnPropertyDescriptor(v, k);
      if (!descriptor || !('value' in descriptor)) deny('invalid-proposal', { stage: 'header' });
      if (i) put(','); put(JSON.stringify(k)); put(':'); visit(descriptor.value, depth + 1);
    }
    put('}');
  };
  visit(value, 0);
  return chunks.join('');
}
function keysOnly(object: object, allowed: readonly string[]): void {
  for (const key in object) if (!allowed.includes(key)) deny('invalid-proposal', { stage: 'header' });
}
export function authoredHeader(p: AuthoredPierProposal, work: AuthoredPierWork): AuthoredHeader {
  // The serializer caps traversal and text before any full schema validation or detached copy.
  const identity = canonical(p, work);
  p = JSON.parse(identity) as AuthoredPierProposal;
  if (!p || p.version !== 1 || !p.anchor || !p.head || !Array.isArray(p.pieces) || !Array.isArray(p.route) || !Array.isArray(p.fishing)) deny('invalid-proposal', { stage: 'header' });
  keysOnly(p, ['version', 'anchor', 'deckY', 'walkLength', 'head', 'pieces', 'entry', 'route', 'fishing']);
  keysOnly(p.anchor, ['id', 'root', 'turn', 'waterY', 'water', 'biome']); keysOnly(p.head, ['pieceId', 'width', 'depth']);
  const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 128 && v.trim() === v;
  if (!id(p.anchor.id) || !p.anchor.id.startsWith('pier:') || !validPoint(p.anchor.root) || ![0, 1, 2, 3].includes(p.anchor.turn)
    || !Number.isFinite(p.deckY) || !Number.isFinite(p.anchor.waterY) || !id(p.anchor.biome) || !['lake', 'river', 'sea'].includes(p.anchor.water)
    || p.deckY - p.anchor.waterY < .6 - EPS || p.deckY - p.anchor.waterY > .8 + EPS
    || !Number.isInteger(p.walkLength * 4) || p.walkLength < 12 || p.walkLength > 28
    || !Number.isFinite(p.head.width) || p.head.width < 1 || p.head.width > 16 || !Number.isInteger(p.head.depth) || p.head.depth < 1 || p.head.depth > 8
    || !validPoint(p.entry) || p.pieces.length < 2 || !p.fishing.length) deny('invalid-proposal', { stage: 'header' });
  if (p.pieces.length > B.pieces || p.fishing.length > B.routes || p.route.length > B.routePoints) deny('budget-exceeded', { stage: 'header' });
  let writes = 0;
  const ids = new Set<string>(), pieces: AuthoredPieceBounds[] = [];
  for (const piece of p.pieces) {
    keysOnly(piece, ['id', 'blueprint', 'position', 'rotation']);
    if (!id(piece.id) || !piece.id.startsWith(`${p.anchor.id}:`) || ids.has(piece.id) || !validPoint(piece.position) || ![0, 1, 2, 3].includes(piece.rotation)) deny('invalid-proposal', { stage: 'header', pieceId: piece.id });
    ids.add(piece.id);
    const bp = piece.blueprint;
    if (!bp || bp.lattice !== 'build' || !validPoint(bp.size) || !Array.isArray(bp.boxes)) deny('invalid-blueprint', { stage: 'header', pieceId: piece.id });
    writes += bp.boxes.length; work.blueprintCells += bp.size[0] * bp.size[1] * bp.size[2];
    if (writes > B.blueprintWrites || work.blueprintCells > B.blueprintCells) deny('budget-exceeded', { stage: 'header', pieceId: piece.id });
    const checked = VoxelBlueprintSchema.safeParse(bp);
    if (!checked.success) deny('invalid-blueprint', { stage: 'header', pieceId: piece.id });
    for (const b of bp.boxes) {
      work.writeCells += (b.to[0] - b.from[0]) * (b.to[1] - b.from[1]) * (b.to[2] - b.from[2]);
      if (work.writeCells > B.writeCells) deny('budget-exceeded', { stage: 'header', pieceId: piece.id });
    }
    const a = piece.position, c = transformCardinalPoint(a, piece.rotation, [bp.size[0] * VOXEL_METRES.build, 0, bp.size[2] * VOXEL_METRES.build]);
    const al = localPoint(p, a), cl = localPoint(p, c);
    const rect = (a: Vec3, b: Vec3): BoundsXZ => ({ minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[2], b[2]), maxZ: Math.max(a[2], b[2]) });
    const local = rect(al, cl);
    if (Math.max(Math.abs(local.minX), Math.abs(local.maxX)) > 16 || local.minZ < -4 || local.maxZ > p.walkLength + p.head.depth + EPS) deny('invalid-proposal', { stage: 'header', pieceId: piece.id });
    pieces.push({ id: piece.id, world: rect(a, c), local });
  }
  const head = pieces.find(v => v.id === p.head.pieceId);
  if (!head || Math.abs(head.local.minX + p.head.width / 2) > EPS || Math.abs(head.local.maxX - p.head.width / 2) > EPS
    || Math.abs(head.local.minZ - p.walkLength) > EPS || Math.abs(head.local.maxZ - p.walkLength - p.head.depth) > EPS) deny('head-mismatch', { stage: 'header', pieceId: p.head.pieceId });
  let points = 0, length = 0;
  const checkRoute = (route: readonly Vec3[], routeId: string) => {
    if (!Array.isArray(route) || route.length < 2 || route.length > B.routePoints) deny('route-invalid', { stage: 'header', routeId });
    points += route.length; if (points > B.routePoints) deny('budget-exceeded', { stage: 'header', routeId });
    for (let i = 0; i < route.length; i++) {
      const at = route[i]!;
      if (!validPoint(at) || Math.hypot(at[0] - p.anchor.root[0], at[2] - p.anchor.root[2]) > 48) deny('route-invalid', { stage: 'header', routeId });
      if (i) length += Math.hypot(at[0] - route[i - 1]![0], at[2] - route[i - 1]![2]);
      if (length * 2 > B.routeMetres) deny('budget-exceeded', { stage: 'header', routeId });
    }
  };
  checkRoute(p.route, 'main');
  if (!samePoint(p.route[0]!, p.entry) || !p.route.some(v => Math.hypot(v[0] - p.anchor.root[0], v[2] - p.anchor.root[2]) <= .25)
    || !within(localPoint(p, p.route.at(-1)!), head.local) || localPoint(p, p.entry)[2] >= -.25) deny('route-invalid', { stage: 'header', routeId: 'main' });
  const fishingIds = new Set<string>();
  for (const f of p.fishing) {
    keysOnly(f, ['id', 'position', 'route', 'castArea']);
    if (!id(f.id) || fishingIds.has(f.id) || !validPoint(f.position) || !within(localPoint(p, f.position), head.local)) deny('route-invalid', { stage: 'header', routeId: f.id });
    fishingIds.add(f.id); checkRoute(f.route, f.id);
    if (!samePoint(f.route[0]!, p.route.at(-1)!) || !samePoint(f.route.at(-1)!, f.position)) deny('route-invalid', { stage: 'header', routeId: f.id });
    if (!validBounds(f.castArea)) deny('invalid-proposal', { stage: 'header', routeId: f.id });
    const b = f.castArea;
    if ((b.maxX - b.minX) * (b.maxZ - b.minZ) > B.castArea || [b.minX, b.maxX].some(x => [b.minZ, b.maxZ].some(z => Math.hypot(x - f.position[0], z - f.position[2]) > B.castReach))) deny('cast-too-far', { stage: 'header', routeId: f.id });
  }
  return { identity, proposal: p, pieces, head };
}
export function freezeDetached<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freezeDetached(item); Object.freeze(value); }
  return value;
}
