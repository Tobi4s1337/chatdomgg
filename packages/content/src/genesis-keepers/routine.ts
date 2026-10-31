import { VOXEL_METRES, type AvatarAttachmentId, type AvatarBoneId, type Vec3 } from '@chatdom/shared';
import { poseAttachments, restPosition, transformPoint, type AvatarPose } from '../avatars/index';
import { draw } from '../../../world/src/genesis/landscape';
import type { KeeperAct, KeeperFixtureKind, KeeperLook, KeeperRoleDefinition, KeeperTemperament } from './types';

type XZ = readonly [number, number];

/**
 * What a placed place offers its keeper, supplied by the host from the content it actually placed (the tavern's door,
 * the court's lamp posts, the landing's mooring posts). World metres; `facing` is the fixture's front as a rotation about
 * +Y where zero faces +Z (the citizen heading convention). This module never invents a fixture or claims ground.
 */
export interface KeeperFixture {
  readonly id: string;
  readonly kind: KeeperFixtureKind;
  /** On the ground at the fixture's foot (y is the ground there). */
  readonly position: Vec3;
  readonly facing: number;
}

export interface KeeperPlaceSite {
  readonly placeId: string;
  /** The place's anchor and the radius its keeper keeps to; nothing in a round lies outside it. */
  readonly centre: XZ;
  readonly radius: number;
  readonly fixtures: readonly KeeperFixture[];
  /** `host` for placed content; `simulated` for a bench fixture, which every view of the round labels SIMULATED. */
  readonly provenance: 'host' | 'simulated';
}

/** One stop on a keeper's round: an act at a fixture, where to stand and how long to stay. */
export interface KeeperVisit {
  readonly act: KeeperAct;
  readonly fixtureId: string;
  /** Feet on the ground, world metres. */
  readonly position: Vec3;
  /** Rotation about +Y; zero faces +Z. */
  readonly heading: number;
  readonly seconds: number;
}

export interface KeeperRound {
  readonly placeId: string;
  readonly hour: number;
  readonly visits: readonly KeeperVisit[];
  /** Fixture kinds the role works at that this site lacks: its acts there are simply not planned. */
  readonly missing: readonly KeeperFixtureKind[];
  /** Fixtures outside the keeper's radius, never visited. */
  readonly outOfBounds: readonly string[];
  readonly label: 'SIMULATED' | null;
}

const easeInOut = (u: number): number => u * u * (3 - 2 * u);

/** Whether realm hour `h` falls inside a half-open [from, to) range that may wrap past midnight. */
export function inHours(h: number, [from, to]: readonly [number, number]): boolean {
  const hour = ((h % 24) + 24) % 24;
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Fixture-local metres to world, for a fixture facing `facing` (local +Z → (sin f, cos f)). */
export function fixtureToWorld(fixture: Pick<KeeperFixture, 'position' | 'facing'>, local: Vec3): Vec3 {
  const c = Math.cos(fixture.facing), s = Math.sin(fixture.facing);
  return [fixture.position[0] + local[0] * c + local[2] * s, fixture.position[1] + local[1], fixture.position[2] - local[0] * s + local[2] * c];
}

export function visitHeading(act: KeeperAct, fixture: Pick<KeeperFixture, 'facing'>): number {
  const base = act.face === 'toward' ? fixture.facing + Math.PI : act.face === 'away' ? fixture.facing : fixture.facing + act.face;
  return Math.atan2(Math.sin(base), Math.cos(base));
}

/**
 * Plan one round of a keeper's work at realm hour `hour`: every act whose hours include it, at every fixture of its kind
 * within the place's radius, ordered as a short walk from the first fixture (a deterministic nearest-neighbour tour; the
 * tie-break and the starting fixture come from the seed). The walk between visits is main's navigation; nothing here
 * moves a keeper.
 */
export function planKeeperRound(role: KeeperRoleDefinition, site: KeeperPlaceSite, hour: number, seedKey: string): KeeperRound {
  if (!Number.isFinite(hour)) throw new Error('A round needs a finite realm hour.');
  if (!(site.radius > 0)) throw new Error(`Place ${site.placeId} needs a positive keeper radius.`);
  const inside = (f: KeeperFixture) => Math.hypot(f.position[0] - site.centre[0], f.position[2] - site.centre[1]) <= site.radius;
  const outOfBounds = site.fixtures.filter(f => !inside(f)).map(f => f.id);
  const fixtures = site.fixtures.filter(inside);
  const missing = role.needs.filter(kind => !fixtures.some(f => f.kind === kind));
  const stops: { act: KeeperAct; fixture: KeeperFixture }[] = [];
  for (const act of role.acts) {
    if (!inHours(hour, act.hours)) continue;
    for (const fixture of fixtures) if (fixture.kind === act.at) stops.push({ act, fixture });
  }
  const visits: KeeperVisit[] = [];
  if (stops.length) {
    const start = Math.floor(draw(seedKey, `keeper-round/${site.placeId}/${Math.floor(hour)}`) * stops.length);
    const left = [...stops];
    let at = left.splice(start, 1)[0]!;
    for (;;) {
      const position = fixtureToWorld(at.fixture, [at.act.stand[0], 0, at.act.stand[1]]);
      if (Math.hypot(position[0] - site.centre[0], position[2] - site.centre[1]) <= site.radius) {
        visits.push({ act: at.act, fixtureId: at.fixture.id, position, heading: visitHeading(at.act, at.fixture), seconds: at.act.cycle * at.act.repeats });
      }
      if (!left.length) break;
      let best = 0, bestDistance = Infinity;
      for (const [i, next] of left.entries()) {
        const d = Math.hypot(next.fixture.position[0] - at.fixture.position[0], next.fixture.position[2] - at.fixture.position[2]);
        if (d < bestDistance - 1e-9) { best = i; bestDistance = d; }
      }
      at = left.splice(best, 1)[0]!;
    }
  }
  return { placeId: site.placeId, hour, visits, missing, outOfBounds, label: site.provenance === 'simulated' ? 'SIMULATED' : null };
}

function addPose(a: AvatarPose, b: AvatarPose, id: string): AvatarPose {
  const rotations: Partial<Record<AvatarBoneId, Vec3>> = { ...a.rotations };
  for (const [bone, r] of Object.entries(b.rotations) as [AvatarBoneId, Vec3][]) {
    const base = rotations[bone] ?? [0, 0, 0];
    rotations[bone] = [base[0] + r[0], base[1] + r[1], base[2] + r[2]];
  }
  const root = a.root || b.root ? [0, 1, 2].map(i => (a.root?.[i] ?? 0) + (b.root?.[i] ?? 0)) as unknown as Vec3 : undefined;
  return root ? { id, label: b.label, rotations, root } : { id, label: b.label, rotations };
}

function lerpPose(a: AvatarPose, b: AvatarPose, u: number, id: string): AvatarPose {
  const bones = new Set([...Object.keys(a.rotations), ...Object.keys(b.rotations)]) as Set<AvatarBoneId>;
  const rotations: Partial<Record<AvatarBoneId, Vec3>> = {};
  for (const bone of bones) {
    const p = a.rotations[bone] ?? [0, 0, 0], q = b.rotations[bone] ?? [0, 0, 0];
    rotations[bone] = [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u];
  }
  const root = a.root || b.root ? [0, 1, 2].map(i => (a.root?.[i] ?? 0) + ((b.root?.[i] ?? 0) - (a.root?.[i] ?? 0)) * u) as unknown as Vec3 : undefined;
  return root ? { id, label: u < .5 ? a.label : b.label, rotations, root } : { id, label: u < .5 ? a.label : b.label, rotations };
}

/**
 * The act's pose at `phase` (0..1 of its cycle), eased between keys and looping from the last key back to the first,
 * laid over the temperament's stance. Pure: the same act, temperament and phase always give the same pose.
 */
export function actPose(role: KeeperRoleDefinition, act: KeeperAct, temperament: KeeperTemperament, phase: number): AvatarPose {
  const keys = act.keys;
  if (!keys.length) throw new Error(`Act ${act.id} has no keys.`);
  const t = ((phase % 1) + 1) % 1;
  let i = keys.length - 1;
  for (let k = 0; k < keys.length; k++) if (keys[k]!.t <= t) i = k;
  const a = keys[i]!, b = keys[(i + 1) % keys.length]!;
  const span = b.t > a.t ? b.t - a.t : 1 - a.t + b.t;
  const into = t >= a.t ? t - a.t : 1 - a.t + t;
  const pose = keys.length === 1 ? a.pose : lerpPose(a.pose, b.pose, easeInOut(Math.min(1, into / span)), `${act.id}@${t.toFixed(3)}`);
  return addPose(role.stance[temperament], pose, `${act.id}.${temperament}@${t.toFixed(3)}`);
}

/** A point (root-local rest cells, riding `attachment`) posed and returned in root-local metres. */
export function posedPoint(pose: AvatarPose, attachment: AvatarAttachmentId, at: Vec3): Vec3 {
  const rest = restPosition(attachment);
  const local: Vec3 = [(at[0] - rest[0]) * VOXEL_METRES.avatar, (at[1] - rest[1]) * VOXEL_METRES.avatar, (at[2] - rest[2]) * VOXEL_METRES.avatar];
  return transformPoint(poseAttachments(pose).get(attachment)!, local);
}

/** A root-local point (metres) for a keeper standing at a visit: turned by the heading, then placed at the feet. */
export function visitToWorld(position: Vec3, heading: number, local: Vec3): Vec3 {
  const c = Math.cos(heading), s = Math.sin(heading);
  return [position[0] + local[0] * c + local[2] * s, position[1] + local[1], position[2] - local[0] * s + local[2] * c];
}

/** Where a tool point lands, in fixture-local metres, for an act at its stand point and heading. */
export function actToolPoint(look: KeeperLook, act: KeeperAct, pose: AvatarPose, point: string): Vec3 {
  if (!act.tool) throw new Error(`${act.id} has nothing in hand.`);
  const found = look.tools.find(tool => tool.id === act.tool)?.points[point];
  if (!found) throw new Error(`${act.tool} has no point ${point}.`);
  // Work in the fixture's own frame: the fixture at the origin facing +Z.
  const fixture = { position: [0, 0, 0] as Vec3, facing: 0 };
  const stand = fixtureToWorld(fixture, [act.stand[0], 0, act.stand[1]]);
  return visitToWorld(stand, visitHeading(act, fixture), posedPoint(pose, found.attachment, found.at));
}

/** The lowest posed cell bottom (metres, root-local) of the look's feet and shins: zero is planted on the ground. */
export function lowestFoot(look: KeeperLook, pose: AvatarPose): number {
  let low = Infinity;
  const attachments = poseAttachments(pose);
  for (const part of look.parts) {
    if (!['footLeft', 'footRight', 'shinLeft', 'shinRight'].includes(part.attachment)) continue;
    const m = attachments.get(part.attachment)!;
    for (const box of part.boxes) for (const x of [box.from[0], box.to[0]]) for (const y of [box.from[1], box.to[1]]) for (const z of [box.from[2], box.to[2]]) {
      const p = transformPoint(m, [(x - part.pivot[0]) * VOXEL_METRES.avatar, (y - part.pivot[1]) * VOXEL_METRES.avatar, (z - part.pivot[2]) * VOXEL_METRES.avatar]);
      low = Math.min(low, p[1]);
    }
  }
  return low;
}
