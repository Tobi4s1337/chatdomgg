import type { HomeTier } from '@chatdom/shared';
import { STYLES, type StyleKey } from '../materials';
import type { BuildTemplateForm } from './plan';

/** What a citizen reads when choosing where to begin. Titles name the shape; hints teach the next move. */
export const BUILD_TEMPLATE_LABELS: Readonly<Record<BuildTemplateForm, { readonly title: string; readonly hint: string }>> = Object.freeze({
  gable: Object.freeze({ title: 'A gabled room', hint: 'Keep the doorway clear, then give the roof a window or a wider eave.' }),
  corner: Object.freeze({ title: 'A house around a corner', hint: 'Grow a room from the turn and keep the inner corner walkable.' }),
  courtyard: Object.freeze({ title: 'Rooms around a little court', hint: 'Grow rooms off the court, never over it, and keep the way in from the street clear.' }),
});

export const BUILD_TEMPLATE_KIT_LABELS: Readonly<Record<StyleKey, string>> = Object.freeze({
  hearth: STYLES.hearth.name, tide: STYLES.tide.name, grove: STYLES.grove.name,
});

export const BUILD_TEMPLATE_TIER_LABELS: Readonly<Record<HomeTier, string>> = Object.freeze({
  hut: 'Hut', cottage: 'Cottage', house: 'House', manor: 'Manor', hall: 'Hall',
});
