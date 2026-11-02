/** How many people a screen shows by name and by bubble. The host's play setting chooses one per kind. */
export type LabelDensity = 'all' | 'nearby' | 'few';

export interface LabelLimit { readonly count: number; readonly range: number }
export interface LabelLimits { readonly names: LabelLimit; readonly bubbles: LabelLimit }

const NAMES: Readonly<Record<LabelDensity, LabelLimit>> = {
  all: { count: 12, range: 40 },
  nearby: { count: 12, range: 18 },
  few: { count: 3, range: 40 },
};
const BUBBLES: Readonly<Record<LabelDensity, LabelLimit>> = {
  all: { count: 4, range: 28 },
  nearby: { count: 4, range: 18 },
  few: { count: 1, range: 28 },
};

export function labelLimits(labels: LabelDensity = 'all', bubbles: LabelDensity = 'all'): LabelLimits {
  return { names: NAMES[labels] ?? NAMES.all, bubbles: BUBBLES[bubbles] ?? BUBBLES.all };
}
