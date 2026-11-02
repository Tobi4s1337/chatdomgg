import { createCampfireClearing, CAMPFIRE_CLEARING_ID, CAMPFIRE_SITE, type CampfireClearing, type CampfireClearingSeat } from '@chatdom/content/campfire';
import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import type { RealmFoundedScene } from '@chatdom/world';
import { interactionTargetId, STREET_ZONE, type InteractionAnchor, type InteractionPlacement } from '@chatdom/world/interactions';

/*
 * The installed clearing, as the campfire's browser side sees it. Its static pieces (the square of logs, the hearth,
 * the Magistrate's chair) are founded voxel geometry authored in `packages/content/src/campfire`; the kingdom draws
 * them like any other placement. This module only reads that arrangement and places it in the world.
 *
 * The arrangement's frame: metres, +Y up, the hearth at the origin on the clearing floor, headings about +Y with zero
 * facing +Z. The founded placement turns it by a cardinal turn and puts the hearth at a world point.
 */

export type XZ = readonly [number, number];
export type { CampfireClearingSeat };
export type CampfireClearingArrangement = CampfireClearing;

export const CLEARING_ID = CAMPFIRE_CLEARING_ID;
export const CLEARING_SITE = CAMPFIRE_SITE;
/** Where the flame stands above the hearth floor, in the arrangement's frame: on the hearth's bed of embers. */
export const FLAME_BASE: Vec3 = [0, VOXEL_METRES.build, 0];

/** The authored clearing (built once per process). */
export const campfireClearing = (): CampfireClearingArrangement => createCampfireClearing();
export const campfireClearingId = (): string => CAMPFIRE_CLEARING_ID;
export const campfireSite = (): string => CAMPFIRE_SITE;

/** The clearing as it stands in one world: the hearth's world point, the placement's turn and the arrangement. */
export interface ClearingFrame {
  readonly origin: Vec3;
  readonly turn: 0 | 1 | 2 | 3;
  readonly arrangement: CampfireClearingArrangement;
}

/** The same rotation as the founded scene's cardinal transform: turn 1 takes local +Z to world +X. */
export function turnXZ(turn: number, x: number, z: number): [number, number] {
  return turn === 0 ? [x, z] : turn === 1 ? [z, -x] : turn === 2 ? [-x, -z] : [-z, x];
}
export function toWorld(frame: Pick<ClearingFrame, 'origin' | 'turn'>, local: Vec3): Vec3 {
  const [x, z] = turnXZ(frame.turn, local[0], local[2]);
  return [frame.origin[0] + x, frame.origin[1] + local[1], frame.origin[2] + z];
}
/** A local heading (zero faces +Z) in world terms. */
export const worldHeading = (turn: number, heading: number): number => heading + turn * Math.PI / 2;
/** A point `distance` ahead along `heading`, plus `side` metres to the sitter's left. */
export function ahead(from: XZ, heading: number, distance: number, side = 0): XZ {
  return [from[0] + Math.sin(heading) * distance + Math.cos(heading) * side, from[1] + Math.cos(heading) * distance - Math.sin(heading) * side];
}

/** Finds the clearing in an installed founded scene. Null when the kingdom has no clearing or another blueprint stands there. */
export function findClearing(scene: Pick<RealmFoundedScene, 'placements' | 'assets'>, arrangement = campfireClearing()): (ClearingFrame & { readonly blueprint: VoxelBlueprint; readonly placement: RealmFoundedScene['placements'][number] }) | null {
  const id = campfireClearingId();
  const placement = scene.placements.find(p => p.id === id);
  const blueprint = placement && scene.assets.find(a => a.assetHash === placement.assetHash)?.blueprint;
  if (!placement || !blueprint || ![0, 1, 2, 3].includes(placement.rotation)) return null;
  const turn = placement.rotation as 0 | 1 | 2 | 3, m = VOXEL_METRES.build;
  const [px, pz] = turnXZ(turn, arrangement.pivot[0] * m, arrangement.pivot[2] * m);
  const origin: Vec3 = [placement.position[0] + px, placement.position[1] + arrangement.pivot[1] * m, placement.position[2] + pz];
  return { origin, turn, arrangement, blueprint, placement };
}

/** Where a walker stands to sit: the last waypoint of the seat's approach, on the floor of the arrangement's frame. */
export function approachOf(seat: CampfireClearingSeat): Vec3 {
  const spot = seat.approach[seat.approach.length - 1] ?? seat.hip;
  return [spot[0], 0, spot[1]];
}
export const isChair = (seat: CampfireClearingSeat): boolean => seat.seat === 0 || seat.kind === 'magistrate';

/**
 * Every seat of the clearing as `fire:<site>:seat:<n>` anchors, chair included, so a body the room seats on any of them
 * is drawn on it. Look point on the seat, rest on the floor under the hips (the citizen rig seats on its sole datum),
 * approach as authored. The room decides who may sit where; this only says where the seats are.
 */
export function clearingSeatPlacement(frame: ClearingFrame, site = campfireSite()): InteractionPlacement {
  const anchors: InteractionAnchor[] = [];
  for (const seat of frame.arrangement.seats) {
    let id: string;
    try { id = interactionTargetId.campfireSeat(site, String(seat.seat)); } catch { continue; }
    anchors.push({ id, kind: 'campfire-seat', zone: STREET_ZONE, position: [seat.hip[0], frame.arrangement.seatTop, seat.hip[1]],
      approach: approachOf(seat), reach: 2, rest: [seat.hip[0], 0, seat.hip[1]], facing: seat.heading });
  }
  return { source: `campfire:${site}`, origin: frame.origin, turn: frame.turn, cell: 1, anchors };
}

/** `fire:<site>:seat:<n>` → n, for this site only. */
export function seatOfTarget(targetId: string | null | undefined, site = campfireSite()): number | null {
  const match = targetId ? /^fire:([^:]+):seat:(\d{1,2})$/.exec(targetId) : null;
  return match && match[1] === site ? Number(match[2]) : null;
}
