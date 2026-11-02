import type { ForgeHostProfile, ForgeHouseSlot, ForgeHouseSocket, VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '@chatdom/content/materials';
import { FACADE_CARRIER_SIZE, type FacadeSlot } from '@chatdom/content/forge-slots';
import { rasterizeBlueprint } from '@chatdom/voxel';
import { canonicalSceneJson } from '@chatdom/world/founded-codec';
import { findForgeSockets, homeFingerprint } from './assembly';

type Cell = [number, number, number];
/**
 * A place on a home where a forged piece attaches (kit revision 3). A place accepts several slots: the gable takes a
 * crest, a clock, a shield or a wreath; the roof spots take a chimney, a guardian or a banner. Places on one home never
 * overlap, so any accepted piece on each place at once still fits. A new piece on an occupied place replaces the one
 * there (the old piece is kept, never lost). The roof and front-lantern places are the revision-2 sockets themselves,
 * with the same ids and origins, so a revision-3 piece on a spot replaces the revision-2 piece on that spot.
 */
export interface ForgePiecePlace {
  readonly id: string;
  readonly group: 'roof' | 'facade' | 'doorstep';
  readonly accepts: readonly ForgeHouseSlot[];
  /** Home cell of the place's local origin. Front and doorstep places: back-bottom-left of the reserved box. */
  readonly origin: Cell;
  /** Front and doorstep places: the reserved box from `origin`, depth toward the street. */
  readonly size: Cell;
  /** Roof places: the revision-2 socket the roof constructions stand on (supports, clearance, profile). */
  readonly socket?: ForgeHouseSocket;
  readonly hostId: string;
  readonly hostFingerprint: string;
  readonly hostProfile?: ForgeHostProfile;
}

const ROOF_ACCEPTS: Readonly<Record<string, readonly ForgeHouseSlot[]>> = {
  'stack-chimney': ['chimney'],
  'roof-chimney': ['chimney', 'roof-guardian', 'banner'],
  'roof-weathervane': ['weathervane', 'banner', 'finial'],
  'roof-lantern': ['lantern', 'roof-guardian', 'banner'],
  'front-lantern': ['lantern'],
};
const BESIDE_DOOR: readonly ForgeHouseSlot[] = ['wreath', 'wall-sign', 'shield', 'bell', 'letterbox'];
const GABLE: readonly ForgeHouseSlot[] = ['gable-crest', 'clock', 'shield', 'wreath'];
const DOORSTEP: readonly ForgeHouseSlot[] = ['bench', 'planter'];
/** Wall materials a front piece may hang on. Glass, roof tiles and thatch never carry one. */
const WALL = new Set<number>([MAT.plaster, MAT.cream, MAT.timber, MAT.bark, MAT.brick, MAT.stone, MAT.limestone, MAT.darkStone]);

const volume = (slot: ForgeHouseSlot) => { const s = FACADE_CARRIER_SIZE[slot as FacadeSlot]; return s ? s[0] * s[1] * s[2] : 0; };
const largest = (slots: readonly ForgeHouseSlot[]): Cell => slots.reduce<Cell>((size, slot) => {
  const s = FACADE_CARRIER_SIZE[slot as FacadeSlot];
  return s ? [Math.max(size[0], s[0]), Math.max(size[1], s[1]), Math.max(size[2], s[2])] : size;
}, [0, 0, 0]);

interface Front {
  sx: number; sy: number; sz: number;
  cell(x: number, y: number, z: number): number;
  /** Frontmost solid z in each (x, y) column, -1 when the column is empty. */
  face: Int16Array;
}
const fronts = new Map<string, Front>();
function front(home: VoxelBlueprint): Front {
  const identity = canonicalSceneJson(home), cached = fronts.get(identity);
  if (cached) return cached;
  const asset = rasterizeBlueprint(home), [sx, sy, sz] = asset.size;
  const cell = (x: number, y: number, z: number) => x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : asset.voxels[x + sx * (y + sy * z)]!;
  const face = new Int16Array(sx * sy).fill(-1);
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) { let z = sz - 1; while (z >= 0 && !cell(x, y, z)) z--; face[x + sx * y] = z; }
  const result = { sx, sy, sz, cell, face };
  fronts.set(identity, result);
  if (fronts.size > 2) fronts.delete(fronts.keys().next().value!);
  return result;
}

type Reserved = { from: Cell; to: Cell };
const overlaps = (a: Reserved, b: Reserved) => a.from.every((n, i) => n < b.to[i]! && b.from[i]! < a.to[i]!);

/**
 * A front rectangle [x0, x0+w) × [y0, y0+h) where a carrier `d` deep can hang, and the plane its back stands on. The
 * back rests on the wall; trim members up to two cells proud of it (posts, quoins, a sill band) pass into the piece's
 * back layers, and the assembler notches the piece around them. At least half its back touches wall material, no
 * glass is behind it (a window, the door's lights), nothing deep is behind it (a porch, a doorway) and it ends inside
 * the lot.
 */
function hang(f: Front, x0: number, y0: number, [w, h, d]: Cell, avoid: readonly Reserved[]): Cell | null {
  if (x0 < 0 || y0 < 1 || x0 + w > Math.min(64, f.sx) || y0 + h > f.sy) return null;
  // The wall plane: the most common front depth of wall material under the rectangle.
  const depths = new Map<number, number>();
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const z = f.face[x + f.sx * y]!;
    if (z < 0) return null;
    if (WALL.has(f.cell(x, y, z))) depths.set(z, (depths.get(z) ?? 0) + 1);
  }
  let wall = -1, most = 0;
  for (const [z, n] of depths) if (n > most || (n === most && z > wall)) { wall = z; most = n; }
  if (wall < 0) return null;
  // A thin front layer of trim pulls the plane forward by one, so the back sits on it rather than inside it.
  const plane = Math.min(f.sz - d, wall + 1 + ((depths.get(wall + 1) ?? 0) * 3 > w * h ? 1 : 0));
  if (plane <= wall) return null;
  let touching = 0, proud = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const z = f.face[x + f.sx * y]!, material = f.cell(x, y, z);
    if (z >= plane) {
      if (z >= plane + 2 || !WALL.has(material)) return null;
      proud++; touching++;
    } else {
      // Deep recesses (a doorway, a porch) never carry a hung piece.
      if (plane - 1 - z > 3) return null;
      if (z >= plane - 2) { if (!WALL.has(material)) return null; touching++; }
    }
    for (let k = Math.max(0, z - 6); k <= z; k++) if (f.cell(x, y, k) === MAT.glass) { return null; }
  }
  if (touching * 2 < w * h || proud * 3 > w * h) return null;
  const box: Reserved = { from: [x0, y0, plane], to: [x0 + w, y0 + h, plane + d] };
  if (avoid.some(r => overlaps(r, box))) return null;
  return [x0, y0, plane];
}

/** The street door: the widest run of deeply recessed columns at walking height, with its head row. */
function findDoor(f: Front): { x0: number; x1: number; top: number; floor: number } | null {
  const sx = Math.min(64, f.sx), recess = (x: number, y: number) => { const z = f.face[x + f.sx * y]!; return z < 0 ? f.sz : f.sz - 1 - z; };
  const typical = [...Array(sx).keys()].map(x => recess(x, 12)).sort((a, b) => a - b)[Math.floor(sx / 2)]!;
  let best: { x0: number; x1: number } | null = null;
  for (let x = 0; x < sx;) {
    if (recess(x, 8) >= typical + 4 && recess(x, 16) >= typical + 4) {
      let end = x; while (end < sx && recess(end, 8) >= typical + 4 && recess(end, 16) >= typical + 4) end++;
      const width = end - x, centre = (x + end) / 2;
      if (width >= 6 && width <= 18 && (!best || Math.abs(centre - sx / 2) < Math.abs((best.x0 + best.x1) / 2 - sx / 2))) best = { x0: x, x1: end };
      x = end;
    } else x++;
  }
  if (!best) return null;
  const mid = Math.floor((best.x0 + best.x1) / 2);
  let top = 16; while (top < f.sy && recess(mid, top) >= typical + 4) top++;
  let floor = 8; while (floor > 0 && recess(mid, floor - 1) >= typical + 4) floor--;
  return { ...best, top, floor };
}

/** The home's own cells, as the Forge reads them to fit a piece (0 is air, outside the blueprint is air). */
export function forgeHostCell(home: VoxelBlueprint): (x: number, y: number, z: number) => number { return front(home).cell; }

const placeCache = new Map<string, ForgePiecePlace[]>();
/** Every place on this home for revision-3 pieces. Deterministic: the same home always gives the same places. */
export function findForgePlaces(home: VoxelBlueprint, hostProfile: ForgeHostProfile = 'street-home'): ForgePiecePlace[] {
  const key = `${hostProfile}:${canonicalSceneJson(home)}`, cached = placeCache.get(key);
  if (cached) return structuredClone(cached);
  const fingerprint = homeFingerprint(home), places: ForgePiecePlace[] = [], reserved: Reserved[] = [];
  const base = { hostId: home.id, hostFingerprint: fingerprint, ...(hostProfile === 'castle-keep' ? { hostProfile } : {}) } as const;
  const sockets = findForgeSockets(home, hostProfile, 2);
  for (const socket of sockets) {
    places.push({ id: socket.id, group: 'roof', accepts: ROOF_ACCEPTS[socket.id] ?? [socket.kind], origin: [...socket.origin], size: [32, 0, 32], socket, ...base });
    // A roof piece's column of air, and the wall lantern's bracket and chamber, belong to their places.
    const [ox, oy, oz] = socket.origin;
    reserved.push(socket.profile === 'wall'
      ? { from: [ox + 10, oy, oz], to: [ox + 22, oy + 32, oz + 16] }
      : { from: [ox + 2, oy, oz + 3], to: [ox + 30, oy + 64, oz + 29] });
  }
  if (hostProfile === 'street-home') {
    const f = front(home), door = findDoor(f);
    const add = (id: string, group: ForgePiecePlace['group'], accepts: readonly ForgeHouseSlot[], at: Cell | null, size: Cell) => {
      if (!at) return false;
      places.push({ id, group, accepts, origin: at, size, ...base });
      reserved.push({ from: at, to: [at[0] + size[0], at[1] + size[1], at[2] + size[2]] });
      return true;
    };
    const search = (size: Cell, xs: readonly number[], ys: readonly number[]) => {
      for (const y of ys) for (const x of xs) { const at = hang(f, x, y, size, reserved); if (at) return at; }
      return null;
    };
    const around = (centre: number, span: number) => [...Array(2 * span + 1).keys()].map(i => Math.round(centre) + (i % 2 ? (i + 1) / 2 : -i / 2));
    /**
     * The widest choice that fits: all the slots a place could take, and when their room does not fit there, the same
     * place without its largest carrier, until one fits. `xs` and `ys` see the room's size so they can centre it.
     */
    const fit = (id: string, accepts: readonly ForgeHouseSlot[], xs: (size: Cell) => readonly number[], ys: (size: Cell) => readonly number[]) => {
      const bySize = [...accepts].sort((a, b) => volume(b) - volume(a));
      for (let k = 0; k < bySize.length; k++) {
        const subset = accepts.filter(slot => bySize.indexOf(slot) >= k), size = largest(subset);
        if (add(id, 'facade', subset, search(size, xs(size), ys(size)), size)) return true;
      }
      return false;
    };
    const width = Math.min(64, f.sx);
    if (door) {
      const mid = (door.x0 + door.x1) / 2;
      // Over the door: the crown sits on the door head.
      fit('door-head', ['door-crown'], size => around(mid - size[0] / 2, 3), () => [door.top, door.top + 1, door.top + 2, door.top + 3]);
      // Beside the door, at hand height: a wreath, a sign, a bell, a letterbox. Nearest the door first, either side.
      const ys = () => [6, 5, 7, 4, 8, 3, 9, 10].map(dy => door.floor + dy);
      fit('door-left', BESIDE_DOOR, size => [...Array(Math.max(0, door.x0 - 1 - size[0])).keys()].map(i => door.x0 - 2 - size[0] - i), ys);
      fit('door-right', BESIDE_DOOR, () => [...Array(Math.max(0, width - door.x1 - 2)).keys()].map(i => door.x1 + 2 + i), ys);
    }
    // Under each front window: a planter box hung below the sill.
    for (const win of home.windows) {
      if (win.facing !== 'south') continue;
      const sill = Math.floor(win.centre[1] - win.height / 2) - 1;
      fit(`sill-${win.id}`, ['window-box'], size => around(win.centre[0] - size[0] / 2, 2), size => [sill - size[1], sill - size[1] - 1, sill - size[1] - 2]);
    }
    // The gable: the highest wide stretch of front wall, centred on the home.
    fit('gable', GABLE, size => around(width / 2 - size[0] / 2, 16), size => [...Array(60).keys()].map(i => Math.min(f.sy, 90) - size[1] - i).filter(y => y >= 22));
    // The frieze: a long carved beam across the front, below the eaves.
    fit('frieze', ['frieze'], size => around(width / 2 - size[0] / 2, 14), () => [...Array(36).keys()].map(i => 46 - i).filter(y => y >= 10));
    // Spare wall: any other free stretch of the front at street height takes a wreath, a shield, a sign or a clock.
    const SPARE: readonly ForgeHouseSlot[] = ['clock', 'wreath', 'shield', 'wall-sign'];
    for (let n = 1; n <= 2; n++) fit(`wall-${n}`, SPARE, size => [...Array(Math.max(0, width - size[0] + 1)).keys()], () => [...Array(40).keys()].map(i => 4 + i));
    // At the doorstep: a bench or a pot standing on the ground in front of the wall, back to it, never before the door.
    // The strip between the front and the lot edge is open ground in the world, so the piece stands at y 0.
    const step = largest(DOORSTEP);
    const keepClear = door ? { x0: door.x0 - 2, x1: door.x1 + 2 } : { x0: width, x1: width };
    const stand = (x0: number, coverGlass: boolean): Cell | null => {
      const [w, h, d] = step;
      if (x0 < 0 || x0 + w > width || (x0 < keepClear.x1 && keepClear.x0 < x0 + w)) return null;
      // Its back stands against the proudest wall member behind it (a post, a plinth); the box must be open air.
      let wall = -1;
      for (let y = 0; y < h; y++) for (let x = x0; x < x0 + w; x++) {
        const z = f.face[x + f.sx * y]!;
        if (z >= 0 && WALL.has(f.cell(x, y, z))) wall = Math.max(wall, z);
      }
      const plane = wall + 1;
      if (wall < 0 || plane + d > f.sz) return null;
      for (let y = 0; y < h; y++) for (let x = x0; x < x0 + w; x++) for (let z = plane; z < plane + d; z++) if (f.cell(x, y, z)) return null;
      let touching = 0, glass = 0;
      for (let y = 0; y < h; y++) for (let x = x0; x < x0 + w; x++) {
        const z = f.face[x + f.sx * y]!;
        if (z >= wall - 1 && WALL.has(f.cell(x, y, z))) touching++;
        for (let k = Math.max(0, wall - 6); k <= wall; k++) if (f.cell(x, y, k) === MAT.glass) { glass++; break; }
      }
      if (touching * 3 < w * h || (!coverGlass && glass)) return null;
      const box: Reserved = { from: [x0, 0, plane], to: [x0 + w, h, plane + d] };
      return reserved.some(r => overlaps(r, box)) ? null : [x0, 0, plane];
    };
    const centre = door ? (door.x0 + door.x1) / 2 : width / 2;
    const xs = [...Array(width).keys()].sort((a, b) => Math.abs(a + step[0] / 2 - centre) - Math.abs(b + step[0] / 2 - centre));
    const pick = (side: (x: number) => boolean) => { for (const cover of [false, true]) for (const x of xs) if (side(x)) { const at = stand(x, cover); if (at) return at; } return null; };
    add('step-left', 'doorstep', DOORSTEP, pick(x => x + step[0] / 2 < centre), step);
    add('step-right', 'doorstep', DOORSTEP, pick(x => x + step[0] / 2 >= centre), step);
  }
  placeCache.set(key, structuredClone(places));
  if (placeCache.size > 8) placeCache.delete(placeCache.keys().next().value!);
  return places;
}
