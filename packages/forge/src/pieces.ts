import {
  FORGE_MOTIFS, FORGE_PIECE_KIT_REVISION, ForgePiecePlanSchema, ForgeStyleKitSchema, isForgeHouseSlot,
  type ForgeHostProfile, type ForgeHouseSlot, type ForgeLibraryMotif, type ForgePieceMotif, type ForgePiecePlan,
  type ForgeStyleKit, type VoxelBlueprint,
} from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '@chatdom/content/materials';
import { createForgeMotif } from '@chatdom/content/forge-motifs';
import { createForgeOrnament } from '@chatdom/content/forge-ornaments';
import { createAnvilHeroDragon } from '@chatdom/content/anvil-hero';
import { createLibraryMotif } from '@chatdom/content/forge-library';
import { createSlotCarrier, roofCarrierTones, type FacadeSlot } from '@chatdom/content/forge-slots';
import { rasterizeBlueprint } from '@chatdom/voxel';
import { applyForgeFinish, composeHousePart, homeFingerprint, type HousePartMotif } from './assembly';
import { cellsToBoxes, keepHeld, motifCells, reliefForm, smallForm } from './motif-forms';
import { findForgePlaces, forgeHostCell, type ForgePiecePlace } from './places';

type Cell = [number, number, number];
type Box = VoxelBlueprint['boxes'][number];

/** The registered kit of revision-3 pieces for a kingdom: the same native kit, its library and slot carriers. */
export function forgePieceKit(family: StyleKey): ForgeStyleKit {
  if (!(family in STYLES)) throw new Error('Unregistered Forge style kit.');
  return ForgeStyleKitSchema.parse({ version: 1, id: `${family}-native`, styleId: STYLES[family].id, family, revision: FORGE_PIECE_KIT_REVISION });
}

/** The carving of any revision-3 motif in a kingdom's palette: the kit's own seven and the library's forty. */
export function forgePieceMotif(motif: ForgePieceMotif, family: StyleKey): HousePartMotif {
  if (motif === 'sleeping-dragon') return createAnvilHeroDragon(family);
  if (motif === 'crescent-moon' || motif === 'watchful-owl') return createForgeMotif(motif, family);
  if ((FORGE_MOTIFS as readonly string[]).includes(motif)) return createForgeOrnament(motif as 'sleeping-fox' | 'sunflower' | 'scallop-shell' | 'shooting-star', family, 2);
  return createLibraryMotif(motif as ForgeLibraryMotif, family);
}

export interface AssembledForgePiece {
  blueprint: VoxelBlueprint;
  /** Home cell of the blueprint's local origin. */
  origin: Cell;
  /** Piece-local anchor of the reveal's glint, the chimney's smoke or the lantern's glow. */
  emitter: Cell;
  emitterKind: 'smoke' | 'glow' | null;
  place: ForgePiecePlace;
  plan: ForgePiecePlan;
  kit: ForgeStyleKit;
}

const FRONT_RELIEF_DEPTH = 4;
/** The motif as a front piece shows it: its front view, pressed and halved to the slot's 12 × 8 × 2 relief. */
export function frontRelief(motif: HousePartMotif) {
  // Every relief cell holds on through its flat back.
  return keepHeld(smallForm(reliefForm(motif, 'front', FRONT_RELIEF_DEPTH)), (_x, _y, z) => z === 0);
}

/**
 * Build a revision-3 piece for one place on one home. Deterministic: the same plan, kit, place and home always give
 * the same blueprint. Throws when the plan's slot does not belong on the place or the kit is not revision 3.
 */
export function assembleForgePiece(input: ForgePiecePlan, style: ForgeStyleKit, place: ForgePiecePlace, home: VoxelBlueprint): AssembledForgePiece {
  const plan = ForgePiecePlanSchema.parse(input), kit = ForgeStyleKitSchema.parse(style);
  if (kit.revision !== FORGE_PIECE_KIT_REVISION || kit.id !== `${kit.family}-native` || kit.styleId !== STYLES[kit.family].id) throw new Error('Unregistered style kit.');
  if (!isForgeHouseSlot(plan.slot)) throw new Error('That piece is worn, not built onto a home.');
  if (!place.accepts.includes(plan.slot)) throw new Error('That piece does not fit this place on the home.');
  if (place.hostId !== home.id || place.hostFingerprint !== homeFingerprint(home)) throw new Error('The house changed. Find a new place before forging.');
  const motif = forgePieceMotif(plan.motif, kit.family);
  if (place.group === 'roof') return roofPiece(plan, plan.slot, kit, place, motif, home);
  return frontPiece(plan, plan.slot as FacadeSlot, kit, place, motif, home);
}

function roofPiece(plan: ForgePiecePlan, slot: ForgeHouseSlot, kit: ForgeStyleKit, place: ForgePiecePlace, motif: HousePartMotif, home: VoxelBlueprint): AssembledForgePiece {
  const socket = place.socket;
  if (!socket) throw new Error('This roof place has no socket.');
  if (slot === 'chimney' || slot === 'weathervane' || slot === 'lantern') {
    const compose = (carving: HousePartMotif) => composeHousePart({ version: 3, kind: slot, motif: plan.motif, finish: plan.finish, accent: plan.accent }, kit, socket, carving);
    let built = compose(structuredClone(motif));
    // A vane swings over the ridge end: when the full carving would leave the lot or touch the roof there, the vane
    // carries it at half size, as a finial does.
    if (slot === 'weathervane' && !clearOf(built.blueprint, socket.origin, home)) built = compose(halfCarving(motif));
    if (slot === 'chimney' && socket.profile === 'stack') {
      // A stone perch bar across the flue, so a carving whose foot falls over the open stack still stands on stone.
      const xs = socket.supports.map(p => p[0] - socket.origin[0]), ridge = Math.max(...socket.supports.map(p => p[1] - socket.origin[1]));
      built.blueprint.boxes.unshift({ from: [Math.min(...xs), ridge + 1, 15], to: [Math.max(...xs) + 1, ridge + 2, 17], material: STYLES[kit.family].stone });
    }
    built.blueprint.id = `forged-${kit.family}-${slot}`;
    return { blueprint: built.blueprint, origin: [...socket.origin], emitter: built.emitter, emitterKind: built.emitterKind, place, plan, kit };
  }
  if (socket.profile !== 'roof') throw new Error('That piece needs a roof place.');
  applyForgeFinish({ motif: plan.motif, finish: plan.finish, accent: plan.accent }, kit.family, motif);
  const t = roofCarrierTones(kit.family), native = STYLES[kit.family];
  const boxes: Box[] = [];
  const add = (from: Cell, to: Cell, material: number) => boxes.push({ from, to, material });
  const ridge = Math.max(...socket.supports.map(p => p[1] - socket.origin[1]));
  // Every roof piece stands on columns whose feet meet the roof itself; the house is never cut.
  for (const p of socket.supports) {
    const x = p[0] - socket.origin[0], y = p[1] - socket.origin[1], z = p[2] - socket.origin[2];
    add([x, y, z], [x + 1, ridge + 2, z + 1], native.stone);
  }
  const top = Math.max(socket.clearanceHeight, ridge + (slot === 'finial' ? 3 : 5));
  let shape: HousePartMotif, at: Cell;
  if (slot === 'roof-guardian') {
    // A guardian on a plinth: a stone pier from the roof, a trim band and a broad cap, the full carving on top.
    if (top - 2 > ridge + 2) add([13, ridge + 2, 13], [19, top - 2, 19], t.stone);
    add([11, top - 2, 11], [21, top - 1, 21], t.trim);
    add([10, top - 1, 10], [22, top, 22], t.stone);
    shape = motif; at = [16, top, 16];
  } else if (slot === 'banner') {
    // A banner pole with a ball finial and a swallow-tailed flag in the kingdom's colours, the motif its emblem. The
    // flag flies toward the middle of the home, so it never leaves the lot.
    const poleTop = top + 22, flag = kit.family === 'hearth' ? MAT.cloth : kit.family === 'tide' ? MAT.slate : MAT.moss;
    const west = socket.origin[0] + 16 > 32, span = (a: number, b: number): [number, number] => west ? [32 - b, 32 - a] : [a, b];
    add([15, ridge + 2, 15], [17, poleTop, 17], t.metal);
    add([14, poleTop, 14], [18, poleTop + 2, 18], t.metal);
    for (let y = poleTop - 13; y < poleTop - 1; y++) {
      const [x0, x1] = span(17, Math.abs(y - (poleTop - 7.5)) < 2.5 ? 29 : 31);
      add([x0, y, 15], [x1, y + 1, 16], flag);
    }
    const [h0, h1] = span(17, 31);
    add([h0, poleTop - 2, 15], [h1, poleTop - 1, 16], t.trim);
    const emblem = frontRelief(motif), tone = plan.finish === 'copper' ? MAT.forgeCopper : kit.family === 'grove' ? MAT.goldLeaf : MAT.cream;
    for (const b of emblem.boxes) if (b.material) b.material = tone;
    const at: Cell = [span(17, 29)[0], poleTop - 12, 16];
    for (const b of emblem.boxes) add(b.from.map((n, i) => n + at[i]!) as Cell, b.to.map((n, i) => n + at[i]!) as Cell, b.material);
    return finishRoof(kit, slot, socket.origin, boxes, [at[0] + 6, poleTop - 7, 17], place, plan);
  } else {
    // A finial: a metal spike from the ridge, a stone knob, and the carving at half size on its point.
    add([15, ridge + 2, 15], [17, top, 17], t.metal);
    add([14, top - 1, 14], [18, top + 1, 18], t.stone);
    shape = halfCarving(motif); at = [16, top + 1, 16];
  }
  const offset: Cell = [at[0] - shape.mount[0], at[1] - shape.mount[1], at[2] - shape.mount[2]];
  for (const b of shape.boxes) add(b.from.map((n, i) => n + offset[i]!) as Cell, b.to.map((n, i) => n + offset[i]!) as Cell, b.material);
  return finishRoof(kit, slot, socket.origin, boxes, shape.emitter.map((n, i) => n + offset[i]!) as Cell, place, plan);
}

/** The carving at half size, standing on its halved mount; cells the halving cut loose are dropped. */
function halfCarving(motif: HousePartMotif): HousePartMotif {
  const small = smallForm(motif), mount: Cell = [Math.floor(motif.mount[0] / 2), Math.floor(motif.mount[1] / 2), Math.floor(motif.mount[2] / 2)];
  const kept = keepHeld(small, (x, y, z) => y === mount[1] && Math.abs(x - mount[0]) <= 1 && Math.abs(z - mount[2]) <= 1);
  return { size: kept.size, boxes: kept.boxes, mount, emitter: motif.emitter.map(n => Math.floor(n / 2)) as Cell };
}

/** True when the blueprint at `origin` covers no cell of the home and stays inside a street lot. */
function clearOf(blueprint: VoxelBlueprint, origin: Cell, home: VoxelBlueprint): boolean {
  const asset = rasterizeBlueprint(blueprint), host = forgeHostCell(home), [sx, sy, sz] = asset.size;
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    if (!asset.voxels[x + sx * (y + sy * z)]) continue;
    const X = x + origin[0], Y = y + origin[1], Z = z + origin[2];
    if (X < 0 || X >= Math.min(64, home.size[0]) || Y < 0 || Y >= 160 || Z < 0 || Z >= home.size[2] || host(X, Y, Z)) return false;
  }
  return true;
}

function finishRoof(kit: ForgeStyleKit, slot: ForgeHouseSlot, origin: Cell, boxes: Box[], emitter: Cell, place: ForgePiecePlace, plan: ForgePiecePlan): AssembledForgePiece {
  const size: Cell = [Math.max(32, ...boxes.map(b => b.to[0])), Math.max(32, ...boxes.map(b => b.to[1])), Math.max(32, ...boxes.map(b => b.to[2]))];
  const blueprint: VoxelBlueprint = { version: 1, id: `forged-${kit.family}-${slot}`, kind: 'prop', styleId: kit.styleId, lattice: 'build', size, boxes, windows: [] };
  return { blueprint, origin: [...origin], emitter, emitterKind: null, place, plan, kit };
}

function frontPiece(plan: ForgePiecePlan, slot: FacadeSlot, kit: ForgeStyleKit, place: ForgePiecePlace, motif: HousePartMotif, home: VoxelBlueprint): AssembledForgePiece {
  const carrier = createSlotCarrier(slot, kit.family);
  const [sx, sy, sz] = carrier.size;
  if (carrier.size.some((n, i) => n > place.size[i]!)) throw new Error('That piece does not fit this place on the home.');
  const finish = plan.finish === 'copper' ? MAT.forgeCopper : plan.finish === 'ceramic' ? MAT.cream : null;
  if (slot === 'planter') {
    // The pot's rim takes the finish; the motif grows from it as clipped green.
    for (const b of carrier.boxes) if (finish !== null && b.material === STYLES[kit.family].trim) b.material = finish;
  } else applyForgeFinish({ motif: plan.motif, finish: plan.finish, accent: plan.accent }, kit.family, motif);
  const relief = frontRelief(motif), leaf = kit.family === 'grove' ? MAT.moss : MAT.leaf;
  const grid = motifCells({ size: carrier.size, boxes: carrier.boxes, mount: [0, 0, 0], emitter: carrier.emitter }).cells;
  const reliefCells = motifCells(relief), [rx, ry, rz] = relief.size;
  for (const [ax, ay, az] of carrier.reliefAt) {
    for (let z = 0; z < rz; z++) for (let y = 0; y < ry; y++) for (let x = 0; x < rx; x++) {
      const m = reliefCells.cells[x + rx * (y + ry * z)]!;
      if (!m) continue;
      const X = ax + x, Y = ay + y, Z = az + z;
      if (X < sx && Y < sy && Z < sz) grid[X + sx * (Y + sy * Z)] = slot === 'planter' ? (m === MAT.goldLeaf || m === MAT.brass ? MAT.petal : leaf) : m;
    }
  }
  // Notch the piece around trim that stands proud of the wall where it hangs.
  const host = forgeHostCell(home), [ox, oy, oz] = place.origin;
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) if (host(ox + x, oy + y, oz + z)) grid[x + sx * (y + sy * z)] = 0;
  // Whatever the notch or a window recess left without a hold is dropped: every cell holds on to the home or the ground.
  const holds = (x: number, y: number, z: number) => oy + y === 0 || [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => host(ox + x + dx!, oy + y + dy!, oz + z + dz!) !== 0);
  const kept = keepHeld({ size: carrier.size, boxes: cellsToBoxes(carrier.size, grid), mount: [0, 0, 0], emitter: carrier.emitter }, holds);
  const blueprint: VoxelBlueprint = { version: 1, id: `forged-${kit.family}-${slot}`, kind: 'prop', styleId: kit.styleId, lattice: 'build', size: [sx, sy, sz], boxes: kept.boxes, windows: [] };
  return { blueprint, origin: [ox, oy, oz], emitter: [...carrier.emitter], emitterKind: null, place, plan, kit };
}

/**
 * Deterministic craft and fit checks for a revision-3 piece: the place still exists on this home unchanged, the
 * shape is exactly its plan's, nothing covers the home or a window, it stays inside the lot, every part of it holds
 * on to the piece or the home, and its palette stays quiet. Not a moderation verdict.
 */
export function checkForgePiece(result: AssembledForgePiece, home: VoxelBlueprint, hostProfile: ForgeHostProfile = 'street-home'): { solidCells: number; palette: number[] } {
  if ((result.place.hostProfile ?? 'street-home') !== hostProfile) throw new Error('The piece belongs to a different host profile.');
  if (result.place.hostId !== home.id || result.place.hostFingerprint !== homeFingerprint(home)) throw new Error('The house changed. Find a new place before forging.');
  const place = findForgePlaces(home, hostProfile).find(p => p.id === result.place.id);
  if (!place || JSON.stringify(place) !== JSON.stringify(result.place)) throw new Error('The house no longer has this place.');
  const canonical = assembleForgePiece(result.plan, result.kit, place, home);
  if (JSON.stringify(canonical.blueprint) !== JSON.stringify(result.blueprint) || String(canonical.origin) !== String(result.origin)) throw new Error('The shape differs from its registered plan.');
  const asset = rasterizeBlueprint(result.blueprint), host = forgeHostCell(home), [sx, sy, sz] = asset.size, [ox, oy, oz] = result.origin;
  const maxX = hostProfile === 'castle-keep' ? home.size[0] : 64, maxY = hostProfile === 'castle-keep' ? Math.min(352, home.size[1] + 96) : 160;
  const palette = new Set<number>();
  let solidCells = 0;
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const material = asset.voxels[x + sx * (y + sy * z)]!;
    if (!material) continue;
    solidCells++; palette.add(material);
    const X = x + ox, Y = y + oy, Z = z + oz;
    if (host(X, Y, Z)) throw new Error(`The ${result.plan.slot} would cover ${home.id} at ${X},${Y},${Z}.`);
    if (X < 0 || X >= maxX || Y < 0 || Y >= maxY || Z < 0 || Z >= home.size[2]) throw new Error('The piece reaches beyond this home.');
    for (let k = 1; k <= 3; k++) if (host(X, Y, Z - k) === MAT.glass) throw new Error('Keep the window clear.');
  }
  if (solidCells < 60 || solidCells > 15000 || palette.size > 9 || result.blueprint.boxes.length > 600) throw new Error('The shape needs a quieter, better balanced finish.');
  // Every connected part of the piece holds on to the home; nothing floats.
  const seen = new Uint8Array(asset.voxels.length);
  const neighbours = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  for (let start = 0; start < asset.voxels.length; start++) {
    if (!asset.voxels[start] || seen[start]) continue;
    const queue = [start]; seen[start] = 1;
    let held = false;
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i]!, x = n % sx, y = Math.floor(n / sx) % sy, z = Math.floor(n / (sx * sy));
      for (const [dx, dy, dz] of neighbours) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || X >= sx || Y < 0 || Y >= sy || Z < 0 || Z >= sz) {
          // Off the blueprint: the home or, for a piece standing at y 0, the ground.
          if (host(X + ox, Y + oy, Z + oz) || Y + oy < 0) held = true;
          continue;
        }
        const j = X + sx * (Y + sy * Z);
        if (asset.voxels[j]) { if (!seen[j]) { seen[j] = 1; queue.push(j); } }
        else if (host(X + ox, Y + oy, Z + oz)) held = true;
      }
    }
    if (!held) throw new Error('A detail is floating away from the piece.');
  }
  return { solidCells, palette: [...palette] };
}
