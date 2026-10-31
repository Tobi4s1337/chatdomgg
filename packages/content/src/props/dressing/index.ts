// The ground-dressing collection (spec 28): the registry and factory, plus BLUEPRINTS, every finished form grown.
import type { VoxelBlueprint } from '@chatdom/shared';
import { createDressing, DRESSING_FORMS, DRESSING_ROLES, DRESSING_STYLES, isFinishedDressing } from './registry';

export * from './registry';

/** Every finished form in R1 order; kit forms Hearth, Tide, Grove. */
export const BLUEPRINTS: readonly VoxelBlueprint[] = DRESSING_FORMS.filter(isFinishedDressing).flatMap(form =>
  DRESSING_ROLES[form].kit ? DRESSING_STYLES.map(style => createDressing(form, style)) : [createDressing(form)]);
