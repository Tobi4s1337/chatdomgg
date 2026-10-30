import type { VoxelBlueprint } from '@chatdom/shared';
import { STYLES } from '../../materials';
import { fenceCorner, fenceEnd, fenceStraight, wallCorner, wallEnd, wallStraight, type StreetStyle } from './edges';
import { flowerPot, flowerTrough, leafyShrub, rockCluster } from './plants';

export { FENCE_PROFILE, WALL_PROFILE, type StreetStyle } from './edges';

/** The ten passive street forms, in collection order. */
export const STREET_PROP_FORMS = [
  'fence-straight', 'fence-corner', 'fence-end', 'wall-straight', 'wall-corner', 'wall-end',
  'flower-pot', 'flower-trough', 'rock-cluster', 'leafy-shrub',
] as const;
export type StreetPropForm = typeof STREET_PROP_FORMS[number];
export const STREET_STYLES = ['hearth', 'tide'] as const satisfies readonly StreetStyle[];

/** Maximum build-cell dimensions per form (spec 06, R1). Authored sizes use exactly these boxes. */
export const STREET_PROP_SIZES: Readonly<Record<StreetPropForm, readonly [number, number, number]>> = {
  'fence-straight': [16, 12, 4], 'fence-corner': [16, 12, 16], 'fence-end': [4, 12, 4],
  'wall-straight': [16, 9, 4], 'wall-corner': [16, 9, 16], 'wall-end': [4, 10, 4],
  'flower-pot': [8, 12, 8], 'flower-trough': [16, 10, 6], 'rock-cluster': [12, 7, 10], 'leafy-shrub': [12, 12, 12],
};

type Builder = (kit: (typeof STYLES)[StreetStyle]) => VoxelBlueprint['boxes'];
const BUILDERS: Record<StreetPropForm, Builder> = {
  'fence-straight': fenceStraight, 'fence-corner': fenceCorner, 'fence-end': fenceEnd,
  'wall-straight': wallStraight, 'wall-corner': wallCorner, 'wall-end': wallEnd,
  'flower-pot': flowerPot, 'flower-trough': flowerTrough, 'rock-cluster': rockCluster, 'leafy-shrub': leafyShrub,
};

/** Builds one passive street prop in a home kit's own trim, stone and natural accents. */
export function createStreetProp(form: StreetPropForm, style: StreetStyle): VoxelBlueprint {
  if (!(STREET_PROP_FORMS as readonly string[]).includes(form)) throw new Error(`Unknown street prop form "${String(form)}". Choose ${STREET_PROP_FORMS.join(', ')}.`);
  if (!(STREET_STYLES as readonly string[]).includes(style)) throw new Error(`Street props are made in the hearth and tide kits, not "${String(style)}".`);
  const kit = STYLES[style];
  return { version: 1, id: `street-${style}-${form}`, styleId: kit.id, kind: 'prop', lattice: 'build', size: [...STREET_PROP_SIZES[form]], boxes: BUILDERS[form](kit), windows: [] };
}

/** All twenty street props, Hearth then Tide, each in listed form order. */
export const BLUEPRINTS: readonly VoxelBlueprint[] = STREET_STYLES.flatMap(style =>
  STREET_PROP_FORMS.map(form => createStreetProp(form, style)));

export { JOIN_FIXTURES } from './joins';
