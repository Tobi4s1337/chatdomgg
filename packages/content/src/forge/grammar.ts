import { ForgePieceDefinitionSchema, type ContentWindow, type ForgeConnector, type ForgePieceDefinition, type ForgePieceKind, type VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../materials';

/**
 * Shared construction grammar for the Forge piece families. Every coordinate is a build cell (0.125 m), boxes are
 * half-open and run in order, and material zero carves earlier boxes of the same piece only. Pieces are authored
 * with their exterior toward +Z (south) and turned by positive-Y quarter turns about the local origin, then
 * translated, exactly as the content bench and street joins do.
 */
export const FORGE_FAMILIES = ['hearthfold', 'tidewake', 'grovebough'] as const;
export type ForgeFamilyId = typeof FORGE_FAMILIES[number];
export const FORGE_FORMS = [
  'floor', 'wall', 'wall-corner', 'door', 'window', 'shutter-pair', 'roof-slope', 'roof-ridge', 'roof-gable',
  'roof-verge', 'porch-deck', 'porch-post', 'porch-canopy', 'chimney', 'trim',
] as const;
export type ForgeForm = typeof FORGE_FORMS[number];
export const FORM_KINDS: Record<ForgeForm, ForgePieceKind> = {
  floor: 'floor', wall: 'wall', 'wall-corner': 'wall', door: 'door', window: 'window', 'shutter-pair': 'window',
  'roof-slope': 'roof', 'roof-ridge': 'roof', 'roof-gable': 'roof', 'roof-verge': 'roof',
  'porch-deck': 'porch', 'porch-post': 'porch', 'porch-canopy': 'porch', chimney: 'chimney', trim: 'trim',
};

/** Measures every family shares. Families differ in finish, corner arms, roof pitch and overhangs. */
export const COMMON = { bay: 16, wallHeight: 24, wallThickness: 4, floorThickness: 2, minPassage: [10, 20] } as const;

export type Cell = [number, number, number];
export type QuarterTurn = 0 | 1 | 2 | 3;
export type Normal = ForgeConnector['normal'];
type Box = VoxelBlueprint['boxes'][number];
export type Space = { from: Cell; to: Cell };

/**
 * A profile's mating cross-section, as cells either side of the connector plane. For a horizontal normal, u runs
 * along up × normal of the reading connector and v is +Y from the point. For up/down normals, sections are
 * squares centred on the point, so they read the same in every quarter turn. Symmetric sections read the same from
 * both connectors of a mate; a chiral section (a stepped roof) is read from whichever mate turns it into its own piece.
 */
export interface ForgeProfile {
  readonly id: string;
  readonly summary: string;
  readonly chiral: boolean;
  readonly section: readonly { readonly u: readonly [number, number]; readonly v: readonly [number, number] }[];
}

export class Shape {
  readonly boxes: Box[] = [];
  constructor(readonly id: string, readonly size: Cell) {}

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): this {
    const from: Cell = [x0, y0, z0], to: Cell = [x1, y1, z1];
    if (from.some((v, i) => !Number.isInteger(v) || !Number.isInteger(to[i]) || v < 0 || v >= to[i]! || to[i]! > this.size[i]!)) {
      throw new Error(`${this.id}: box ${[...from, ...to].join(',')} is empty or leaves its ${this.size.join('×')} bounds.`);
    }
    this.boxes.push({ from, to, material });
    return this;
  }

  air(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    return this.box(x0, y0, z0, x1, y1, z1, MAT.air);
  }

  blueprint(styleId: string, windows: ContentWindow[] = []): VoxelBlueprint {
    const solids = new Set<string>();
    for (const box of this.boxes) {
      if (box.material === MAT.air) continue;
      const key = JSON.stringify(box);
      if (solids.has(key)) throw new Error(`${this.id}: duplicate solid box ${key}.`);
      solids.add(key);
    }
    return { version: 1, id: this.id, styleId: styleId as VoxelBlueprint['styleId'], kind: 'prop', lattice: 'build', size: [...this.size], boxes: this.boxes.map(b => ({ from: [...b.from], to: [...b.to], material: b.material })), windows };
  }
}

export function connector(id: string, profile: string, point: Cell, normal: Normal): ForgeConnector {
  return { id, profile, point: [...point], normal };
}

export function space(from: Cell, to: Cell): Space {
  return { from: [...from], to: [...to] };
}

/** Builds and schema-checks one sidecar. The blueprint is always the piece's own strict content model. */
export function definePiece(input: Omit<ForgePieceDefinition, 'version'>): ForgePieceDefinition {
  return ForgePieceDefinitionSchema.parse({ version: 1, ...input });
}

const NORMALS: Record<Normal, Cell> = { north: [0, 0, -1], east: [1, 0, 0], south: [0, 0, 1], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
export function normalVector(normal: Normal): Cell { return NORMALS[normal]; }
export function normalFromVector([x, y, z]: Cell): Normal {
  const found = (Object.keys(NORMALS) as Normal[]).find(key => NORMALS[key][0] === x && NORMALS[key][1] === y && NORMALS[key][2] === z);
  if (!found) throw new Error(`Not an axis direction: ${x},${y},${z}.`);
  return found;
}

/** A lattice point or direction under a positive-Y quarter turn about the origin (three.js rotation.y). */
export function turnPoint([x, y, z]: readonly [number, number, number], q: QuarterTurn): Cell {
  const [rx, rz] = q === 0 ? [x, z] : q === 1 ? [z, -x] : q === 2 ? [-x, -z] : [-z, x];
  return [rx + 0, y, rz + 0];
}

export function turnNormal(normal: Normal, q: QuarterTurn): Normal {
  return normalFromVector(turnPoint(NORMALS[normal], q));
}

/** A unit cell (its minimum corner) under the same turn: the cell keeps its extent, so it shifts by one on flipped axes. */
export function turnCell([x, y, z]: Cell, q: QuarterTurn): Cell {
  const [rx, rz] = q === 0 ? [x, z] : q === 1 ? [z, -x - 1] : q === 2 ? [-x - 1, -z - 1] : [-z - 1, x];
  return [rx, y, rz];
}

export function turnSpace(box: Space, q: QuarterTurn, offset: readonly [number, number, number] = [0, 0, 0]): Space {
  const a = turnPoint(box.from, q), b = turnPoint(box.to, q);
  return {
    from: [Math.min(a[0], b[0]) + offset[0], box.from[1] + offset[1], Math.min(a[2], b[2]) + offset[2]],
    to: [Math.max(a[0], b[0]) + offset[0], box.to[1] + offset[1], Math.max(a[2], b[2]) + offset[2]],
  };
}

export function addCells(a: readonly number[], b: readonly number[]): Cell { return [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!]; }
