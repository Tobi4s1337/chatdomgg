import type { VoxelBlueprint } from '@chatdom/shared';
import { STYLES } from '../materials';
import { ceremonialGateway, footbridge } from './crossing';
import { CIVIC_KITS, type Boxes, type CivicStyle } from './kit';

export { FOOTBRIDGE, GATEWAY, footbridgeDeckTop } from './crossing';
export { CIVIC_SHIELD, type CivicStyle } from './kit';

/** The ten civic forms in collection order; the two largest silhouettes come first (spec 10, R1). */
export const CIVIC_FORMS = [
  'footbridge', 'ceremonial-gateway', 'gift-cart', 'banner-standard', 'crest-plinth',
  'noticeboard', 'direction-sign', 'bench', 'lantern-post', 'market-stores',
] as const;
export type CivicForm = typeof CIVIC_FORMS[number];
export const CIVIC_STYLES = ['hearth', 'tide'] as const satisfies readonly CivicStyle[];

const SIZES: Readonly<Record<CivicForm, readonly [number, number, number]>> = {
  footbridge: [64, 24, 32], 'ceremonial-gateway': [48, 64, 16], 'gift-cart': [32, 32, 24], 'banner-standard': [16, 64, 16],
  'crest-plinth': [24, 40, 16], noticeboard: [32, 32, 12], 'direction-sign': [16, 32, 8], bench: [32, 16, 16],
  'lantern-post': [12, 40, 12], 'market-stores': [24, 16, 16],
};

/** Exact allocated sizes and per-asset cost ceilings (R1, R6), one row per form in collection order. */
export const CIVIC_MANIFEST: readonly {
  form: CivicForm;
  size: readonly [number, number, number];
  maxBoxes: number;
  maxOccupiedCells: number;
  maxTriangles: number;
}[] = CIVIC_FORMS.map(form => ({ form, size: SIZES[form], maxBoxes: 1024, maxOccupiedCells: 120_000, maxTriangles: 120_000 }));

/** Forms whose models are finished. The rest arrive in later tasks; there is no stand-in geometry for them. */
const BUILDERS: Partial<Record<CivicForm, (kit: (typeof CIVIC_KITS)[CivicStyle]) => Boxes>> = {
  footbridge, 'ceremonial-gateway': ceremonialGateway,
};

/** Builds one civic model in the Hearth or Tide treatment. Unknown or unfinished input fails explicitly. */
export function createCivicProp(form: CivicForm, style: CivicStyle): VoxelBlueprint {
  if (!(CIVIC_FORMS as readonly string[]).includes(form)) throw new Error(`Unknown civic form "${String(form)}". Choose ${CIVIC_FORMS.join(', ')}.`);
  if (!(CIVIC_STYLES as readonly string[]).includes(style)) throw new Error(`Civic props are made in the hearth and tide kits, not "${String(style)}".`);
  const build = BUILDERS[form];
  if (!build) throw new Error(`Civic form "${form}" is not built yet.`);
  return {
    version: 1, id: `civic-${style}-${form}`, styleId: STYLES[style].id, kind: 'civic', lattice: 'build',
    size: [...SIZES[form]], boxes: build(CIVIC_KITS[style]).list, windows: [],
  };
}

/** Finished civic models: Hearth then Tide, each in form order. */
export const BLUEPRINTS: readonly VoxelBlueprint[] = CIVIC_STYLES.flatMap(style =>
  CIVIC_FORMS.filter(form => BUILDERS[form]).map(form => createCivicProp(form, style)));
