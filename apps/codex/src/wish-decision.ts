import type { ForgeDraft } from '@chatdom/shared';

/** Private selection metadata. Never added to an attachment, ritual or public event. */
export interface ForgeRunSelection {
  readonly verdict: number;
  readonly attempt: number;
  readonly delivery: 'delivered' | 'retried' | 'softened';
  readonly shared: 'subject' | 'family' | 'slot' | 'mood' | 'colour';
  readonly reason?: 'vocabulary' | 'quality' | 'fit';
}

const motifs: Record<ForgeDraft['plan']['motif'], string> = {
  'sleeping-dragon': 'a sleeping dragon', 'crescent-moon': 'a crescent moon', 'watchful-owl': 'a watchful owl',
  'sleeping-fox': 'a sleeping fox', sunflower: 'a sunflower', 'scallop-shell': 'a scallop shell', 'shooting-star': 'a shooting star',
};

/** Only finite descriptions, never model prose or an echo of the wish. Called after actual commit. */
export function forgeDeliveryMessage(draft: ForgeDraft, selection?: ForgeRunSelection): string {
  const piece = `a ${draft.plan.kind} with ${motifs[draft.plan.motif]}`;
  if (selection?.delivery !== 'softened') return `Your home now carries ${piece}. One coal warmed it.`;
  const why = selection.reason === 'fit' ? 'I adapted the setting to fit your home.'
    : selection.reason === 'quality' ? 'I could not bring every small detail into focus.'
      : 'That exact shape is beyond my kit.';
  const connection = selection.shared === 'family' ? 'It keeps the same family of shapes.'
    : selection.shared === 'slot' ? 'It keeps the place you wished to fill.'
      : selection.shared === 'mood' ? 'It keeps the feeling of your wish.'
        : selection.shared === 'colour' ? 'It keeps the colours of your wish.' : 'It keeps your chosen subject.';
  return `The closest I can make is ${piece}. ${why} ${connection}`;
}

export const FORGE_WAIT_MESSAGES = {
  noSlot: 'Your home has no clear place for a new part. Make room at a house slot; your coal stays yours.',
  fit: 'The smith could not find a safe fit for your home just now. Your coal stays yours; try another house part.',
  service: 'The forge’s helpers cannot answer just now. Your coal stays yours; please bring your wish back when the fire returns.',
  budget: 'This wish needs more time than the fire can give just now. Your coal stays yours; try a simpler house part.',
} as const;
