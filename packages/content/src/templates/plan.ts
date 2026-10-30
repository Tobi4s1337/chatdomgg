import { HOME_BUILD_LIMITS, HOME_DEPTH_METRES, type ContentWindow, type HomeTier, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../materials';

/** The whole reserved home lot in build cells: 8 × 20 × 16 m, street at +Z. Templates always use all of it. */
export const RESERVE = [64, 160, 128] as const;

export const BUILD_TEMPLATE_FORMS = ['gable', 'corner', 'courtyard'] as const;
export type BuildTemplateForm = typeof BUILD_TEMPLATE_FORMS[number];

type Box = VoxelBlueprint['boxes'][number];
export type Facing = ContentWindow['facing'];

/** Facts a test or the review bench checks against real voxels. Feet points stand on the first air cell. */
export interface TemplateReview {
  /** Feet in the middle of the open front doorway. */
  readonly threshold: Vec3;
  /** One meaningful standing point per authored room, in route order from the door. */
  readonly rooms: readonly Vec3[];
  /** Courtyard plans stand here, under open sky. */
  readonly court?: Vec3;
  readonly windows: readonly string[];
}

export interface BuiltTemplate { readonly blueprint: VoxelBlueprint; readonly review: TemplateReview }

export function templateId(style: StyleKey, form: BuildTemplateForm, tier: HomeTier): string {
  return `template-${style}-${form}-${tier}`;
}

/** First z the citizen may build on at this tier; the rear of the reserve behind it stays air. */
export function activeRear(tier: HomeTier): number {
  return RESERVE[2] - HOME_DEPTH_METRES[tier] * 8;
}

/**
 * An ordered list of half-open boxes held inside one tier's unlocked land. Material zero carves the solids this
 * plan laid earlier. Every solid box is checked against the locked rear and the tier height as it is written, so a
 * template cannot be authored that its own plot would refuse.
 */
export class TemplatePlan {
  readonly boxes: Box[] = [];
  readonly windows: ContentWindow[] = [];
  readonly rear: number;
  readonly height: number;
  readonly kit: typeof STYLES[StyleKey];

  constructor(readonly id: string, style: StyleKey, readonly tier: HomeTier) {
    this.rear = activeRear(tier);
    this.height = HOME_BUILD_LIMITS[tier].height;
    this.kit = STYLES[style];
  }

  put(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): void {
    if (x0 >= x1 || y0 >= y1 || z0 >= z1) return;
    if ([x0, y0, z0, x1, y1, z1].some(n => !Number.isInteger(n))) throw new Error(`${this.id}: boxes use whole build cells.`);
    if (x0 < 0 || y0 < 0 || z0 < 0 || x1 > RESERVE[0] || y1 > RESERVE[1] || z1 > RESERVE[2]) {
      throw new Error(`${this.id}: box ${[x0, y0, z0, x1, y1, z1].join(',')} leaves the reserved lot.`);
    }
    if (material !== MAT.air && z0 < this.rear) throw new Error(`${this.id}: box at z=${z0} enters the locked rear land behind z=${this.rear}.`);
    if (material !== MAT.air && y1 > this.height) throw new Error(`${this.id}: box reaches y=${y1}, above the ${this.tier} height of ${this.height}.`);
    this.boxes.push({ from: [x0, y0, z0], to: [x1, y1, z1], material });
  }

  carve(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.put(x0, y0, z0, x1, y1, z1, MAT.air);
  }

  blueprint(): VoxelBlueprint {
    return { version: 1, id: this.id, styleId: this.kit.id, kind: 'home', lattice: 'build', size: [...RESERVE],
      boxes: this.boxes.map(box => ({ from: [...box.from], to: [...box.to], material: box.material })),
      windows: this.windows.map(window => ({ ...window, centre: [...window.centre] })) };
  }
}

/** The outer plane of a wall. `n` offsets run outward from it: negative values lie inside the wall. */
export interface Face { readonly facing: Facing; readonly plane: number }

export function onFace(p: TemplatePlan, face: Face, u0: number, u1: number, y0: number, y1: number, n0: number, n1: number, material: number): void {
  const out = face.facing === 'south' || face.facing === 'east';
  const a = out ? face.plane + n0 : face.plane - n1, b = out ? face.plane + n1 : face.plane - n0;
  if (face.facing === 'south' || face.facing === 'north') p.put(u0, y0, a, u1, y1, b, material);
  else p.put(a, y0, u0, b, y1, u1, material);
}

/**
 * Registers a presence window whose glass fills `u0..u1 × y0..y1` one cell behind the outer plane, with the
 * anchor centred on that outward glass plane as the content README requires.
 */
export function anchor(p: TemplatePlan, id: string, face: Face, u0: number, u1: number, y0: number, y1: number, depth: number): void {
  if ((u1 - u0) % 2 || (y1 - y0) % 2) throw new Error(`${p.id}/${id}: window size must be even to centre its anchor.`);
  const out = face.facing === 'south' || face.facing === 'east';
  const glassPlane = out ? face.plane - depth : face.plane + depth;
  const u = (u0 + u1) / 2, y = (y0 + y1) / 2;
  const centre: [number, number, number] = face.facing === 'south' || face.facing === 'north' ? [u, y, glassPlane] : [glassPlane, y, u];
  p.windows.push({ id, centre, width: u1 - u0, height: y1 - y0, facing: face.facing });
}
