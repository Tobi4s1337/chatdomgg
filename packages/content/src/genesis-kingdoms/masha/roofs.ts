import { MAT, MATERIALS, STYLES, type StyleKey } from '../../materials';
import { oklab } from '../../genesis-heraldry/palette';

/**
 * A channel's colours choose its roofs. The three style kits roof in terracotta (Hearth), slate (Tide) and thatch
 * (Grove); the kit whose roof sits nearest the profile colour targets in OKLab, weighted towards the first
 * (dominant) target, roofs the city, and its walls and trim come with it. Targets are proposals pixel-derived from
 * the public profile image, never approved branding: nothing is tinted and no material is added. Without targets
 * the recipe's own family stands.
 */
const WEIGHTS = [1, .6, .45, .35] as const;

export interface RoofChoice {
  readonly family: StyleKey;
  /** The roof material the colours chose. */
  readonly roof: number;
  /** Weighted OKLab distance of each kit's roof from the targets; lower is nearer. */
  readonly distances: Readonly<Record<StyleKey, number>>;
  readonly basis: 'profile-colour-targets' | 'recipe-family';
}

export function chooseRoofFamily(targets: readonly string[], fallback: StyleKey): RoofChoice {
  const families = Object.keys(STYLES) as StyleKey[];
  const colour = (id: number) => MATERIALS.materials.find(material => material.id === id)!.colour;
  if (!targets.length) {
    const none = Object.fromEntries(families.map(family => [family, 0])) as Record<StyleKey, number>;
    return { family: fallback, roof: STYLES[fallback].roof, distances: none, basis: 'recipe-family' };
  }
  const labs = targets.slice(0, WEIGHTS.length).map(oklab);
  const distances = Object.fromEntries(families.map(family => {
    const roof = oklab(colour(STYLES[family].roof));
    const total = labs.reduce((sum, lab, i) => sum + WEIGHTS[i]! * Math.hypot(lab[0] - roof[0], lab[1] - roof[1], lab[2] - roof[2]), 0);
    return [family, Math.round(total * 1e6) / 1e6];
  })) as Record<StyleKey, number>;
  const family = families.reduce((best, family) => distances[family] < distances[best] ? family : best, families[0]!);
  return { family, roof: STYLES[family].roof, distances, basis: 'profile-colour-targets' };
}

export const ROOF_MATERIALS = [MAT.terracotta, MAT.slate, MAT.thatch] as const;
