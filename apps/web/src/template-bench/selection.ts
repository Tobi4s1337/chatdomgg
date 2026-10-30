import { HOME_BUILD_LIMITS, HOME_DEPTH_METRES, HomeTierSchema, type BuildDraftPolicy, type HomeTier, type Vec3 } from '@chatdom/shared';
import { STYLES, type StyleKey } from '@chatdom/content';
import type { BuildDraft, SettlementHome } from '@chatdom/world';
import {
  BUILD_TEMPLATE_CHOICES, BUILD_TEMPLATE_FORMS, BUILD_TEMPLATE_STYLES, TEMPLATE_REVIEW, isBuildTemplateFinished, templateId,
  type BuildTemplateForm,
} from '../../../../packages/content/src/templates';
import { createPlotBuildPolicy } from '../build/policy';

export const BENCH_ANGLES = ['front', 'side', 'back', 'cutaway'] as const;
export type BenchAngle = typeof BENCH_ANGLES[number];

export interface TemplateChoice { readonly style: StyleKey; readonly form: BuildTemplateForm; readonly tier: HomeTier }
export interface BenchSelection extends TemplateChoice { readonly id: string; readonly angle: BenchAngle; readonly hour: number; readonly seed: string }

/** A selector the bench refuses, with the sentence a reviewer reads instead of a silently chosen default. */
export class SelectionError extends Error {
  constructor(message: string) { super(message); this.name = 'SelectionError'; }
}

const oneOf = <T extends string>(value: string | null, options: readonly T[], name: string, fallback: T): T => {
  if (value === null) return fallback;
  if (!(options as readonly string[]).includes(value)) throw new SelectionError(`There is no ${name} called “${value}”. Choose ${options.join(', ')}.`);
  return value as T;
};

/**
 * Reads the finite review selectors. Omitted kit/form/tier choose the first finished template; an unknown or
 * unfinished choice is an error, never a quiet substitute.
 */
export function readSelection(search: string): BenchSelection {
  const params = new URLSearchParams(search);
  const first = BUILD_TEMPLATE_CHOICES[0];
  if (!first) throw new SelectionError('No starting shape is finished in this build.');
  const style = oneOf(params.get('style'), BUILD_TEMPLATE_STYLES, 'kit', first.style);
  const form = oneOf(params.get('form'), BUILD_TEMPLATE_FORMS, 'shape', first.form);
  const tier = oneOf(params.get('tier'), HomeTierSchema.options, 'tier', first.tier);
  const angle = oneOf(params.get('angle'), BENCH_ANGLES, 'view', 'front');
  const rawHour = params.get('hour') ?? '19';
  if (!/^(?:[01]?\d|2[0-3])$/.test(rawHour)) throw new SelectionError(`Light is set by a whole hour from 0 to 23, not “${rawHour}”.`);
  const seed = params.get('seed') ?? 'chatdom-templates';
  if (!/^[a-z0-9-]{1,40}$/.test(seed)) throw new SelectionError('A review seed uses lowercase letters, digits and dashes.');
  if (!isBuildTemplateFinished(style, form, tier)) throw new SelectionError(`${templateId(style, form, tier)} is not finished in this build yet.`);
  return { style, form, tier, id: templateId(style, form, tier), angle, hour: Number(rawHour), seed };
}

/**
 * The bench's local plot: a full reserved lot of the chosen kit and tier, with all of that tier's depth unlocked.
 * It exists only in this tab. Nothing about it is signed in, owned, saved or published.
 */
export function reviewPlot(style: StyleKey, tier: HomeTier): SettlementHome {
  return {
    id: `review-plot-${style}-${tier}`, quarterYear: 1, ordinal: 0, street: 'Review bench', streetId: 'review-street',
    courtId: 'review-court', approachId: 'review-approach', position: [0, 0, 0], rotation: 0,
    lot: { minX: -4, maxX: 4, minZ: -8, maxZ: 8, height: 20, depth: 16, frontage: 8 },
    slot: 0, tier, allowedDepth: HOME_DEPTH_METRES[tier], style, variant: 0,
  };
}

export function reviewPolicy(style: StyleKey, tier: HomeTier): BuildDraftPolicy {
  return createPlotBuildPolicy(reviewPlot(style, tier), 'review-bench');
}

/** Occupied allowance for a tier, read from main's limits rather than a lane constant. */
export function allowance(tier: HomeTier): number { return HOME_BUILD_LIMITS[tier].maxVoxels; }

/**
 * The wall block the review edit carves: a plain wall cell beside the front doorway at hand height. It is found in
 * the draft's real cells, so the edit always lands on the citizen's own voxels.
 */
export function reviewEditCell(draft: BuildDraft, choice: TemplateChoice): Vec3 {
  const review = TEMPLATE_REVIEW[templateId(choice.style, choice.form, choice.tier)];
  if (!review) throw new Error('This starting shape has no review facts.');
  const wall = STYLES[choice.style].wall;
  const [tx, feet] = review.threshold, y = feet + 12;
  const { size } = draft.policy;
  // Nearest first, either side of the door, past its jambs and the corner posts of a turning plan.
  for (const dx of Array.from({ length: 15 }, (_, i) => [10 + i, -10 - i]).flat()) {
    const x = tx + dx;
    if (x < 0 || x >= size[0]) continue;
    for (let z = size[2] - 1; z >= draft.policy.editableFrom[2]; z--) {
      const material = draft.get([x, y, z]);
      if (!material) continue;
      if (material === wall) return [x, y, z];
      break;
    }
  }
  throw new Error('No plain wall block faces the street beside the doorway.');
}

/** Every finished entry in the same kit/form/tier order the selector lists them. */
export const FINISHED_CHOICES: readonly TemplateChoice[] = BUILD_TEMPLATE_CHOICES;
