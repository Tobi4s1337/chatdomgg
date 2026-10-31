import type { Vec3 } from '@chatdom/shared';
import { createCivicProp, CREST_PLINTH } from '../../civic';
import type { StyleKey } from '../../materials';
import type { InteractionAnchor, KeepClear, PlacePlacement } from '../types';
import { COURT_FLOOR_HEIGHT, createCourtFloor } from './floor';
import { COURT_WELL, createCourtWell } from './well';

/**
 * The court input, structurally the frozen `LandPlaces['court']` from `@chatdom/world` (content never imports
 * world). World metres, +X east, +Z south; the keep stands north of the court and the gate on its south edge.
 */
export interface CourtSite {
  readonly boundary: readonly (readonly [number, number])[];
  readonly elevation: number;
  readonly keepDoor: Vec3;
  readonly gate: Vec3;
}

export interface CastleCourtPlace {
  /** Static pieces in mount order (floor first). World metres; `position` is each blueprint's origin. */
  readonly placements: readonly PlacePlacement[];
  /** Places to stand and act, in world metres. The host binds any prompt; none is implied here. */
  readonly interactions: readonly (InteractionAnchor & { readonly pieceId: string })[];
  /** Ground the court keeps open: the processional way, the gate passage and the keep stair's landing. */
  readonly keepClear: readonly KeepClear[];
  /** Walking height of the flags (world metres): one cell above the court elevation. */
  readonly floorTop: number;
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
}

const CELL = .125;
const onLattice = (value: number) => Math.abs(value * 8 - Math.round(value * 8)) < 1e-9;
/** Court pieces offset from the court's corners, in metres, before their own origins are applied. */
export const COURT_LAYOUT = { well: { fromWest: 7.5, fromKeep: 9.5 }, crest: { fromEast: 7, fromKeep: 6 } } as const;

/**
 * Lays the court on the supplied founded court: two halves of flags, the well-head to the west of the way and
 * the existing civic crest plinth to the east, read-only. The keep stair, open door, parapets, espaliers and
 * standards are not placed here until their owners release their envelopes and dimensions.
 */
export function createCastleCourtPlace(court: CourtSite, style: StyleKey): CastleCourtPlace {
  const xs = court.boundary.map(p => p[0]), zs = court.boundary.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const rectangle = court.boundary.length === 4 && court.boundary.every(([x, z]) => (x === minX || x === maxX) && (z === minZ || z === maxZ))
    && new Set(court.boundary.map(p => p.join(','))).size === 4;
  if (!rectangle) throw new Error('The castle court must be an axis-aligned rectangle of four distinct corners.');
  if (![minX, maxX, minZ, maxZ, court.elevation, ...court.keepDoor, ...court.gate].every(v => Number.isFinite(v) && onLattice(v))) {
    throw new Error('Court corners, elevation, keep door and gate must be finite and on the 0.125 m build lattice.');
  }
  const axis = (minX + maxX) / 2;
  if (court.gate[0] !== axis || court.keepDoor[0] !== axis) throw new Error('The court axis must run from the gate to the keep door down its centre.');
  if (court.gate[2] !== maxZ || court.keepDoor[2] >= minZ) throw new Error('The gate must open on the south edge and the keep door stand north of the court.');
  const half = { width: Math.round((axis - minX) * 8), depth: Math.round((maxZ - minZ) * 8) };
  if (half.width > 256 || half.depth > 256) throw new Error(`A ${maxX - minX}×${maxZ - minZ} m court exceeds two 32 × 32 m floor halves.`);

  const floorY = court.elevation - CELL, floorTop = floorY + COURT_FLOOR_HEIGHT * CELL;
  const west = createCourtFloor('west', style, half), east = createCourtFloor('east', style, half);
  const well = createCourtWell(style);
  const crestStyle = style === 'tide' ? 'tide' : 'hearth';
  const crest = createCivicProp('crest-plinth', crestStyle);
  const wellCentre: [number, number] = [minX + COURT_LAYOUT.well.fromWest, minZ + COURT_LAYOUT.well.fromKeep];
  const wellOrigin: Vec3 = [wellCentre[0] - COURT_WELL.centre[0] * CELL, floorTop, wellCentre[1] - COURT_WELL.centre[1] * CELL];
  const crestOrigin: Vec3 = [maxX - COURT_LAYOUT.crest.fromEast - CREST_PLINTH.size[0] * CELL / 2, floorTop,
    minZ + COURT_LAYOUT.crest.fromKeep - CREST_PLINTH.size[2] * CELL / 2];
  const placements: PlacePlacement[] = [
    { id: 'court:floor:west', blueprint: west.blueprint, position: [minX, floorY, minZ], turn: 0, blocker: false },
    { id: 'court:floor:east', blueprint: east.blueprint, position: [axis, floorY, minZ], turn: 0, blocker: false },
    { id: 'court:well', blueprint: well.blueprint, position: wellOrigin, turn: 0, blocker: true },
    { id: 'court:crest', blueprint: crest, position: crestOrigin, turn: 0, blocker: true },
  ];
  const world = (origin: Vec3, local: Vec3): Vec3 => [origin[0] + local[0] * CELL, origin[1] + local[1] * CELL, origin[2] + local[2] * CELL];
  const interactions = [
    ...well.interactions.map(anchor => ({ ...anchor, pieceId: 'court:well', stand: world(wellOrigin, anchor.stand), look: world(wellOrigin, anchor.look) })),
    // The crest is read from the court in front of it: stand a metre south of the plinth's face.
    { id: 'read-crest', kind: 'read-crest' as const, pieceId: 'court:crest',
      stand: world(crestOrigin, [CREST_PLINTH.size[0] / 2, 0, CREST_PLINTH.size[2] + 8]),
      look: world(crestOrigin, [CREST_PLINTH.size[0] / 2, CREST_PLINTH.shield.y + CREST_PLINTH.shield.height / 2, CREST_PLINTH.faces[1][1] + 1]) },
  ];
  const keepClear: KeepClear[] = [
    { id: 'processional-way', reason: 'the walk from the gate to the keep door', minX: axis - 3, maxX: axis + 3, minZ, maxZ },
    { id: 'keep-stair-landing', reason: 'the flared foot of the keep stair (light-released envelope pending)', minX: axis - 5, maxX: axis + 5, minZ, maxZ: minZ + 4 },
    { id: 'gate-passage', reason: 'the gatehouse passage and its turn into the court', minX: axis - 3, maxX: axis + 3, minZ: maxZ - 12, maxZ },
  ];
  // Pieces never stand in the court's own reservations.
  for (const placement of placements.filter(p => p.blocker)) {
    const [sx, , sz] = placement.blueprint.size, [x, , z] = placement.position;
    for (const clear of keepClear) {
      if (x < clear.maxX && x + sx * CELL > clear.minX && z < clear.maxZ && z + sz * CELL > clear.minZ) {
        throw new Error(`${placement.id} would stand in the court's ${clear.id}.`);
      }
    }
  }
  return { placements, interactions, keepClear, floorTop, bounds: { minX, maxX, minZ, maxZ } };
}
