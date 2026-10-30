import { HomeTierSchema, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import { STYLES, type StyleKey } from '../materials';
import { hearthGable } from './hearth';
import { BUILD_TEMPLATE_FORMS, templateId, type BuildTemplateForm, type BuiltTemplate, type TemplateReview } from './plan';

export { BUILD_TEMPLATE_FORMS, templateId, activeRear, RESERVE, type BuildTemplateForm, type TemplateReview } from './plan';
export { BUILD_TEMPLATE_LABELS, BUILD_TEMPLATE_KIT_LABELS, BUILD_TEMPLATE_TIER_LABELS } from './labels';

/** Kit, form, tier: the nesting order of every catalogue listing and selector. */
export const BUILD_TEMPLATE_STYLES = ['hearth', 'tide', 'grove'] as const satisfies readonly StyleKey[];
export const BUILD_TEMPLATE_TIERS: readonly HomeTier[] = HomeTierSchema.options;

type Builder = (tier: HomeTier) => BuiltTemplate;
/** Finished shapes only. A missing entry throws instead of standing in with another plan. */
const BUILDERS: Partial<Record<StyleKey, Partial<Record<BuildTemplateForm, { build: Builder; tiers: readonly HomeTier[] }>>>> = {
  hearth: { gable: { build: hearthGable, tiers: ['hut'] } },
};

function known(style: unknown, form: unknown, tier: unknown): { style: StyleKey; form: BuildTemplateForm; tier: HomeTier } {
  if (typeof style !== 'string' || !Object.hasOwn(STYLES, style)) throw new Error(`Unknown template kit ${String(style)}. Choose ${BUILD_TEMPLATE_STYLES.join(', ')}.`);
  if (typeof form !== 'string' || !(BUILD_TEMPLATE_FORMS as readonly string[]).includes(form)) throw new Error(`Unknown template form ${String(form)}. Choose ${BUILD_TEMPLATE_FORMS.join(', ')}.`);
  const parsed = HomeTierSchema.safeParse(tier);
  if (!parsed.success) throw new Error(`Unknown template tier ${String(tier)}. Choose ${HomeTierSchema.options.join(', ')}.`);
  return { style: style as StyleKey, form: form as BuildTemplateForm, tier: parsed.data };
}

export function isBuildTemplateFinished(style: StyleKey, form: BuildTemplateForm, tier: HomeTier): boolean {
  return BUILDERS[style]?.[form]?.tiers.includes(tier) ?? false;
}

function build(style: StyleKey, form: BuildTemplateForm, tier: HomeTier): BuiltTemplate {
  const entry = BUILDERS[style]?.[form];
  if (!entry || !entry.tiers.includes(tier)) throw new Error(`${templateId(style, form, tier)} is not finished in this build.`);
  return entry.build(tier);
}

/** A fresh, independently owned editable starting shape. Inputs are the finite kit/form/tier choices only. */
export function createBuildTemplate(style: StyleKey, form: BuildTemplateForm, tier: HomeTier): VoxelBlueprint {
  const choice = known(style, form, tier);
  return build(choice.style, choice.form, choice.tier).blueprint;
}

const FINISHED = BUILD_TEMPLATE_STYLES.flatMap(style => BUILD_TEMPLATE_FORMS.flatMap(form => BUILD_TEMPLATE_TIERS
  .filter(tier => isBuildTemplateFinished(style, form, tier)).map(tier => ({ style, form, tier }))));

/** The finished catalogue in kit → form → tier order. The final collection holds all forty-five. */
export const BLUEPRINTS: readonly VoxelBlueprint[] = FINISHED.map(({ style, form, tier }) => createBuildTemplate(style, form, tier));

/** Review facts keyed by blueprint ID, checked against executed voxels; never navigation or placement authority. */
export const TEMPLATE_REVIEW: Readonly<Record<string, TemplateReview>> = Object.freeze(Object.fromEntries(FINISHED.map(({ style, form, tier }) => {
  const { review } = build(style, form, tier);
  return [templateId(style, form, tier), Object.freeze(review)];
})));

/** Selector entries that exist in this build, with the kit/form/tier they were chosen by. */
export const BUILD_TEMPLATE_CHOICES: readonly { readonly id: string; readonly style: StyleKey; readonly form: BuildTemplateForm; readonly tier: HomeTier }[] =
  Object.freeze(FINISHED.map(choice => Object.freeze({ id: templateId(choice.style, choice.form, choice.tier), ...choice })));
