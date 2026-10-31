import { TokenSchema, type Vec3 } from '@chatdom/shared';
import type { CollisionWorld, RealmInteractionTarget } from '@chatdom/shared/realm';
import { transformCardinalPoint } from '../settlement/geometry';
import type { CardinalTurn } from '../settlement/types';
import { finiteVec3, standingClear } from './geometry';
import { PLOT_KINDS, SEAT_KINDS, kindOfTargetId, plotOfTargetId, type InteractionKind } from './ids';

/** Zones are the room's own names for where a body is: `street`, `tavern:<id>`, `home:<plot>`. */
export const STREET_ZONE = 'street';
export const homeZone = (plotId: string) => `home:${plotId}`;
/** Arm's reach never exceeds this: a distant magic sit is not an interaction. */
export const MAX_REACH = 3;
/** Kingdom metres per authored cell: places author in metres, home interiors in 0.125 m cells. */
export const CELL_METRES = { kingdom: 1, interior: .125 } as const;

/**
 * One authored anchor, in its producer's local cells, before placement. `rest` is where the room puts the body
 * on acceptance: the seated pose for a seat, the inside threshold for a door, the street threshold for an exit.
 * The anvil has no rest: the Forge opens where you stand. `facing` is the local heading of a seated body.
 */
export interface InteractionAnchor {
  readonly id: string; readonly kind: InteractionKind;
  /** Where the body must stand when acting. */
  readonly zone: string;
  readonly position: Vec3; readonly approach: Vec3; readonly reach: number;
  readonly rest?: Vec3; readonly facing?: number;
  readonly plotId?: string;
}
/** The producer's actual installed placement: origin in world metres, cardinal turn and cell size. */
export interface InteractionPlacement {
  /** Which installed producer output these anchors came from, e.g. `campfire:court` or `home:12@rev-4`. */
  readonly source: string;
  readonly origin: Vec3; readonly turn: CardinalTurn; readonly cell: number;
  readonly anchors: readonly InteractionAnchor[];
}
/** Server-side record. Only `target` may cross the wire; the rest stays with the room. */
export interface InteractionRecord {
  readonly target: RealmInteractionTarget;
  readonly zone: string;
  /** World metres. Seats: seated feet. Door: inside threshold. Exit: street threshold. Anvil: null. */
  readonly rest: Vec3 | null;
  /** World heading (radians about +Y, zero faces +Z) for the seated body, or null. */
  readonly facing: number | null;
  /** Zone after acceptance for door/exit, else the same zone. */
  readonly leadsTo: string;
  readonly source: string;
}
export type DisabledReason = 'invalid-id' | 'kind-mismatch' | 'duplicate' | 'invalid-geometry' | 'missing-plot' | 'approach-blocked' | 'rest-blocked' | 'out-of-reach';
export interface InteractionRegistry {
  readonly layoutRevision: string; readonly collisionRevision: number;
  /** Enabled records sorted by ID. Stable: independent of placement order. */
  readonly records: readonly InteractionRecord[];
  /** Every authored target that was refused, with why. Disabled targets have no action anywhere. */
  readonly disabled: readonly { readonly id: string; readonly reason: DisabledReason; readonly source: string }[];
  get(id: string): InteractionRecord | undefined;
  /** Public metadata only: what the browser selector may know. */
  targets(): readonly RealmInteractionTarget[];
}

/** Local cell → world metres: scale by the cell size, apply the cardinal turn, add the placement origin. */
export function placeAnchorPoint(placement: Pick<InteractionPlacement, 'origin' | 'turn' | 'cell'>, local: Vec3): Vec3 {
  const scaled: Vec3 = [local[0] * placement.cell, local[1] * placement.cell, local[2] * placement.cell];
  return transformCardinalPoint(placement.origin, placement.turn, scaled);
}
/** Local heading → world heading. A quarter turn adds π/2 (same convention as `transformCardinalPoint`). */
export function placeHeading(turn: CardinalTurn, local: number): number {
  const heading = local + turn * Math.PI / 2;
  return Math.atan2(Math.sin(heading), Math.cos(heading));
}

function zoneValid(zone: string): boolean {
  return zone === STREET_ZONE || /^tavern:[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(zone)
    || zone.startsWith('home:') && TokenSchema.safeParse(zone.slice(5)).success;
}

/**
 * Build the immutable registry for one founded layout + collision revision from installed producer anchors.
 * Every anchor is placed once. Anything invalid, duplicated or unsafe at this revision is disabled explicitly
 * rather than guessed. Approaches and the door/exit rest must be supported and full-body clear; the seated
 * rest overlaps its own log/chair by design and is checked by the seat owner's pose, not here.
 */
export function createInteractionRegistry(input: {
  readonly layoutRevision: string; readonly world: CollisionWorld; readonly placements: readonly InteractionPlacement[];
}): InteractionRegistry {
  const { world } = input;
  const disabled: { id: string; reason: DisabledReason; source: string }[] = [];
  const candidates = new Map<string, InteractionRecord>();
  const duplicates = new Set<string>();
  for (const placement of input.placements) {
    const placeable = finiteVec3(placement.origin) && [0, 1, 2, 3].includes(placement.turn) && (placement.cell === CELL_METRES.kingdom || placement.cell === CELL_METRES.interior);
    for (const anchor of placement.anchors) {
      const refuse = (reason: DisabledReason) => { disabled.push({ id: anchor.id, reason, source: placement.source }); };
      const kind = kindOfTargetId(anchor.id);
      if (!kind) { refuse('invalid-id'); continue; }
      if (kind !== anchor.kind) { refuse('kind-mismatch'); continue; }
      if (candidates.has(anchor.id) || duplicates.has(anchor.id)) { duplicates.add(anchor.id); refuse('duplicate'); continue; }
      const plotId = plotOfTargetId(anchor.id);
      if (PLOT_KINDS.has(kind) ? !plotId || anchor.plotId !== plotId : anchor.plotId !== undefined) { refuse('missing-plot'); continue; }
      const needsRest = kind !== 'anvil';
      if (!placeable || !finiteVec3(anchor.position) || !finiteVec3(anchor.approach) || !zoneValid(anchor.zone)
        || (needsRest ? !finiteVec3(anchor.rest) : anchor.rest !== undefined)
        || (anchor.facing !== undefined && !Number.isFinite(anchor.facing))) { refuse('invalid-geometry'); continue; }
      if (!(anchor.reach > 0 && anchor.reach <= MAX_REACH)) { refuse('out-of-reach'); continue; }
      const position = placeAnchorPoint(placement, anchor.position), approach = placeAnchorPoint(placement, anchor.approach);
      const rest = anchor.rest ? placeAnchorPoint(placement, anchor.rest) : null;
      if (!standingClear(world, approach)) { refuse('approach-blocked'); continue; }
      if ((kind === 'home-door' || kind === 'home-exit') && (!rest || !standingClear(world, rest))) { refuse('rest-blocked'); continue; }
      const leadsTo = kind === 'home-door' ? homeZone(plotId!) : kind === 'home-exit' ? STREET_ZONE : anchor.zone;
      if (kind === 'home-door' && anchor.zone === leadsTo) { refuse('invalid-geometry'); continue; }
      if (kind === 'home-exit' && anchor.zone !== homeZone(plotId!)) { refuse('invalid-geometry'); continue; }
      const target: RealmInteractionTarget = plotId
        ? { id: anchor.id, kind, position, approach, reach: anchor.reach, plotId }
        : { id: anchor.id, kind, position, approach, reach: anchor.reach };
      candidates.set(anchor.id, { target, zone: anchor.zone, rest, facing: anchor.facing === undefined || !SEAT_KINDS.has(kind) ? null : placeHeading(placement.turn, anchor.facing), leadsTo, source: placement.source });
    }
  }
  for (const id of duplicates) {
    const first = candidates.get(id);
    if (first) { candidates.delete(id); disabled.push({ id, reason: 'duplicate', source: first.source }); }
  }
  const records = [...candidates.values()].sort((a, b) => a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0);
  const byId = new Map(records.map(record => [record.target.id, record]));
  const targets = Object.freeze(records.map(record => record.target));
  disabled.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.reason < b.reason ? -1 : 1);
  return Object.freeze({
    layoutRevision: input.layoutRevision, collisionRevision: world.revision, records: Object.freeze(records), disabled: Object.freeze(disabled),
    get: (id: string) => byId.get(id), targets: () => targets,
  });
}
