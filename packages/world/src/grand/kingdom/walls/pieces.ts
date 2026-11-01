import type { XZ } from '../../../settlement/types';
import type { Path } from './path';
import type { Column, Painter, PieceBounds } from './voxels';
import type { WallStyle } from './types';

/**
 * Material registry ids, by name, from `packages/content/src/materials.ts` (`MAT`). Ids are stable registry keys;
 * the world package does not depend on content, so the few the walls use are named here and checked in the tests.
 */
export const WALL_MATERIAL = {
  stone: 3, limestone: 4, timber: 5, slate: 7, terracotta: 8, thatch: 9, brass: 12, darkStone: 15, moss: 17, cream: 18, bark: 19,
} as const;

export interface WallKit {
  /** Heavy footing course, darker so the wall sits on the ground. */
  readonly plinth: number;
  /** The plinth's top course. */
  readonly ledge: number;
  readonly body: number;
  /** Lighter string courses that read at distance. */
  readonly band: number;
  /** Corbels, copings and the wall-walk. */
  readonly cap: number;
  readonly roof: number;
  /** Hoardings and banner poles. */
  readonly hoarding: number;
  readonly timber: number;
  readonly slit: number;
  readonly finial: number;
  readonly roofKind: 'cone' | 'pyramid';
}

const M = WALL_MATERIAL;
/** Warm clay masonry for each house style, roofed like its homes (terracotta, slate, thatch). */
export const WALL_KITS: Readonly<Record<WallStyle, WallKit>> = {
  hearth: { plinth: M.stone, ledge: M.stone, body: M.limestone, band: M.cream, cap: M.stone, roof: M.terracotta, hoarding: M.timber, timber: M.timber, slit: M.darkStone, finial: M.brass, roofKind: 'cone' },
  tide: { plinth: M.darkStone, ledge: M.stone, body: M.stone, band: M.limestone, cap: M.darkStone, roof: M.slate, hoarding: M.darkStone, timber: M.timber, slit: M.darkStone, finial: M.brass, roofKind: 'pyramid' },
  grove: { plinth: M.darkStone, ledge: M.moss, body: M.stone, band: M.limestone, cap: M.darkStone, roof: M.thatch, hoarding: M.bark, timber: M.bark, slit: M.darkStone, finial: M.brass, roofKind: 'cone' },
};

/** Wall section, metres from the centre line (outward positive). */
export const WALL = { plinth: 1.25, body: 1.0, band: 1.125, corbel: 1.25, parapetInner: 0.5, walkInner: -0.625, merlonPitch: 1.75, merlonWidth: 1.0 } as const;
/** Parapet, coping and merlon heights above the wall-walk. */
export const PARAPET = { coping: 0.875, top: 1.0, merlon: 1.875 } as const;

export interface WallStep { readonly base: number; readonly plinthTop: number; readonly walk: number; readonly band: number }

const frac = (value: number) => value - Math.floor(value);

/**
 * A run of curtain wall swept along a centre line: footing, battered plinth, body, a light string course, a
 * corbelled outer parapet with merlons, and a low inner parapet. Each step is level; steps drop half a metre at a time.
 */
export function wallPainter(options: {
  path: Path; from: number; to: number; before: number; after: number; stepLength: number; steps: readonly WallStep[];
  phase: number; kit: WallKit; bounds: PieceBounds;
}): Painter {
  const { path, from, to, before, after, stepLength, steps, phase, kit, bounds } = options;
  return {
    bounds, headroom: null,
    paint(x: number, z: number, column: Column) {
      const { s, v } = path.project(x, z, before, after);
      if (s < from || s >= to || Math.abs(v) > WALL.plinth) return;
      const step = steps[Math.max(0, Math.min(steps.length - 1, Math.floor(s / stepLength)))]!;
      const { base, plinthTop: pt, walk, band } = step, a = Math.abs(v);
      column.fill(base, pt - 0.25, kit.plinth);
      column.fill(pt - 0.25, pt, kit.ledge);
      if (a <= WALL.body) column.fill(pt, walk - 0.5, kit.body);
      if (a <= WALL.band) column.fill(band, band + 0.375, kit.band);
      const rhythm = frac((s + phase) / WALL.merlonPitch);
      if (v >= -WALL.body) {
        column.fill(walk - 0.5, walk, kit.cap);
        // Corbels under the projecting parapet, one under each merlon.
        if (v > WALL.body && rhythm < 0.3) column.fill(walk - 1.0, walk - 0.5, kit.cap);
      }
      if (v >= WALL.parapetInner) {
        column.fill(walk, walk + PARAPET.coping, kit.body);
        column.fill(walk + PARAPET.coping, walk + PARAPET.top, kit.cap);
        if (rhythm < WALL.merlonWidth / WALL.merlonPitch) {
          column.fill(walk + PARAPET.top, walk + PARAPET.merlon - 0.125, kit.body);
          column.fill(walk + PARAPET.merlon - 0.125, walk + PARAPET.merlon, kit.cap);
        }
      }
      if (v >= -WALL.body && v <= WALL.walkInner) column.fill(walk, walk + 0.625, kit.cap);
    },
  };
}

export interface TowerShape {
  readonly centre: XZ;
  /** Along the wall and outward, unit vectors. */
  readonly tangent: XZ;
  readonly normal: XZ;
  readonly radius: number;
  readonly base: number;
  readonly plinthTop: number;
  /** Ground at the drum's inner face, where its door opens. */
  readonly doorSill: number;
  /** Height of the adjoining wall-walk, for the upper arrow slits and the matching string course. */
  readonly walk: number;
  readonly crown: number;
  readonly roofHeight: number;
  readonly kit: WallKit;
  readonly door: boolean;
}

export const TOWER = { plinth: 0.375, eave: 0.75, hoarding: 0.875, pole: 2.25 } as const;
export const towerRoofBase = (shape: Pick<TowerShape, 'crown'>) => shape.crown + TOWER.hoarding - 0.25;
export const towerApex = (shape: Pick<TowerShape, 'crown' | 'roofHeight'>) => towerRoofBase(shape) + shape.roofHeight;
export const towerPoleTop = (shape: Pick<TowerShape, 'crown' | 'roofHeight'>) => towerApex(shape) + 0.5 + TOWER.pole;
export const towerReach = (radius: number) => radius + TOWER.eave;

/**
 * A drum tower: footing, plinth, a tall body with two string courses, corbelled crown, a timber hoarding with dark
 * loopholes, and a steep cap (cone, or eight-sided pyramid for slate) with a finial and a pole for the banner.
 */
export function paintTower(shape: TowerShape, x: number, z: number, column: Column): void {
  const dx = x - shape.centre[0], dz = z - shape.centre[1], d = Math.hypot(dx, dz), R = shape.radius, kit = shape.kit;
  if (d > towerReach(R) + 0.01) return;
  const u = dx * shape.tangent[0] + dz * shape.tangent[1], v = dx * shape.normal[0] + dz * shape.normal[1];
  const { base, plinthTop: pt, crown, walk } = shape;
  if (d <= R + TOWER.plinth) { column.fill(base, pt - 0.25, kit.plinth); column.fill(pt - 0.25, pt, kit.ledge); }
  if (d <= R) column.fill(pt, crown - 1.0, kit.body);
  if (d <= R + 0.125) { column.fill(walk - 3.0, walk - 2.625, kit.band); column.fill(crown - 3.0, crown - 2.625, kit.band); }
  const theta = Math.atan2(u, v), arc = (theta + Math.PI) * R;
  if (d <= R + 0.25) {
    column.fill(crown - 1.0, crown - 0.5, kit.cap);
    if (frac(arc / 0.875) < 0.43) column.fill(crown - 1.5, crown - 1.0, kit.cap);
  }
  if (d <= R + 0.5) {
    column.fill(crown - 0.5, crown, kit.cap);
    column.fill(crown, crown + TOWER.hoarding, kit.hoarding);
    if (d > R + 0.25 && frac(arc / 1.5) < 0.25) column.paint(crown + 0.25, crown + 0.625, kit.slit);
  }
  // The cap: stepped in quarter-metre tiers, overhanging the hoarding as an eave.
  const roofRadius = towerReach(R), roofBase = towerRoofBase(shape);
  const rho = kit.roofKind === 'cone' ? d : Math.max(Math.abs(u), Math.abs(v), (Math.abs(u) + Math.abs(v)) / Math.SQRT2);
  if (rho <= roofRadius) {
    const top = Math.max(roofBase + 0.25, Math.floor((roofBase + shape.roofHeight * (1 - rho / roofRadius)) / 0.25) * 0.25);
    column.fill(rho > R + 0.5 ? top - 0.375 : crown + TOWER.hoarding, top, kit.roof);
  }
  const apex = towerApex(shape);
  if (d <= 0.375) column.fill(apex - 0.25, apex + 0.5, kit.finial);
  if (d <= 0.2) column.fill(apex + 0.5, towerPoleTop(shape), kit.timber);
  // Arrow slits on the field side, two levels.
  if (d >= R - 0.375 && d <= R + 0.01) {
    for (const aim of [-0.8, 0, 0.8]) {
      const off = theta - aim;
      if (Math.cos(off) <= 0 || Math.abs(d * Math.sin(off)) > 0.15) continue;
      for (const level of [pt + 1.75, walk + 1.5]) if (level + 1.25 <= crown - 3.125) column.paint(level, level + 1.25, kit.slit);
    }
    // A door from the town side.
    if (shape.door && Math.cos(theta - Math.PI) > 0) {
      const lateral = Math.abs(d * Math.sin(theta - Math.PI));
      if (lateral <= 0.625) column.paint(shape.doorSill, shape.doorSill + 2.25, kit.timber);
      if (lateral <= 0.875) column.paint(shape.doorSill + 2.25, shape.doorSill + 2.5, kit.band);
    }
  }
  // Step the plinth back in front of the door, so the threshold meets the ground.
  if (shape.door && d > R && d <= R + TOWER.plinth && Math.cos(theta - Math.PI) > 0 && Math.abs(d * Math.sin(theta - Math.PI)) <= 0.625)
    column.carve(shape.doorSill, pt);
}

export function towerPainter(shape: TowerShape, bounds: PieceBounds): Painter {
  return { bounds, headroom: null, paint: (x, z, column) => paintTower(shape, x, z, column) };
}

export interface GateShape {
  readonly centre: XZ;
  readonly tangent: XZ;
  readonly normal: XZ;
  /** Clear opening along the wall. */
  readonly width: number;
  /** Half-length of the gate block along the wall, to the flanking towers' centres. */
  readonly reach: number;
  /** Half the passage depth across the wall. */
  readonly depth: number;
  readonly base: number;
  readonly plinthTop: number;
  /** Arch springing (street surface + headroom) and rise to its crown. */
  readonly spring: number;
  readonly rise: number;
  readonly top: number;
  readonly kit: WallKit;
  readonly towers: readonly TowerShape[];
  /** Street headroom the carve keeps clear (≤ spring − street). */
  readonly headroom: number;
}

export const archUnderside = (gate: Pick<GateShape, 'spring' | 'rise' | 'width'>, u: number) => {
  const half = gate.width / 2, t = Math.min(1, Math.abs(u) / half);
  return Math.floor((gate.spring + gate.rise * Math.sqrt(Math.max(0, 1 - t * t))) / 0.125) * 0.125;
};

/**
 * A gatehouse: a deep block between two drum towers, an arched passage clear over the whole street corridor, a
 * stone arch ring and quoins on both faces, a timber hoarding and a gabled roof along the wall.
 */
export function gatePainter(gate: GateShape, bounds: PieceBounds): Painter {
  const kit = gate.kit, h = gate.depth, half = gate.width / 2;
  return {
    bounds, headroom: gate.headroom,
    paint(x: number, z: number, column: Column) {
      const dx = x - gate.centre[0], dz = z - gate.centre[1];
      const u = dx * gate.tangent[0] + dz * gate.tangent[1], v = dx * gate.normal[0] + dz * gate.normal[1], a = Math.abs(v), au = Math.abs(u);
      const archCrown = gate.spring + gate.rise;
      if (au <= gate.reach && a <= h + 0.25) {
        column.fill(gate.base, gate.plinthTop - 0.25, kit.plinth);
        column.fill(gate.plinthTop - 0.25, gate.plinthTop, kit.ledge);
        if (a <= h) column.fill(gate.plinthTop, gate.top - 0.5, kit.body);
        if (a <= h + 0.125) column.fill(archCrown + 1.0, archCrown + 1.375, kit.band);
        column.fill(gate.top - 0.5, gate.top, kit.cap);
        if (au <= gate.reach - 0.5) {
          column.fill(gate.top, gate.top + 1.0, kit.hoarding);
          if (a > h && frac((u + 0.4) / 1.5) < 0.25) column.paint(gate.top + 0.25, gate.top + 0.75, kit.slit);
        }
      }
      if (au <= gate.reach - 0.25 && a <= h + 0.75) {
        const ridge = Math.floor((gate.top + 0.75 + (h + 0.75 - a)) / 0.25) * 0.25;
        column.fill(a > h + 0.25 ? ridge - 0.375 : gate.top + 1.0, ridge, kit.roof);
        if (a <= 0.25) column.fill(ridge, ridge + 0.25, kit.cap);
      }
      for (const tower of gate.towers) paintTower(tower, x, z, column);
      if (au <= half) column.carve(gate.base - 1, archUnderside(gate, u));
      if (a >= h - 0.5 && a <= h + 0.25 && au <= half + 0.5) {
        const under = archUnderside(gate, Math.min(au, half));
        if (au <= half) column.paint(under, under + 0.75, kit.band);
        else column.paint(gate.plinthTop, under + 0.75, kit.band);
      }
    },
  };
}
