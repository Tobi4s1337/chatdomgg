import { FW10_WISHES } from '../../../../apps/codex/src/fixtures/fw10-wishes';
import type { ForgeDraft } from '../../../../packages/shared/src';

/** Fixed before the first repeatability read. These are authored constructions, not model approvals. */
export const REPEATABILITY_FIXTURES: readonly {
  id: string; wishId: typeof FW10_WISHES[number]['id']; family: 'hearth' | 'tide' | 'grove'; kitRevision: 2; draft: ForgeDraft;
}[] = [
  { id: 'dragon', wishId: 'fw10-01', family: 'hearth', kitRevision: 2, draft: {
    plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' },
    title: 'The Hearth Dreamer', plaque: 'A small dragon dreams around the warm chimney.' } },
  { id: 'moon', wishId: 'fw10-03', family: 'tide', kitRevision: 2, draft: {
    plan: { version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' },
    title: 'A Little Borrowed Moon', plaque: 'A crescent moon keeps a gentle light for the way home.' } },
  { id: 'owl', wishId: 'fw10-05', family: 'hearth', kitRevision: 2, draft: {
    plan: { version: 2, kind: 'weathervane', motif: 'watchful-owl', finish: 'copper', accent: 'none' },
    title: 'The Copper Watcher', plaque: 'A wise little owl watches the wind turn over the roof.' } },
  { id: 'fox', wishId: 'fw10-07', family: 'grove', kitRevision: 2, draft: {
    plan: { version: 2, kind: 'chimney', motif: 'sleeping-fox', finish: 'native', accent: 'none' },
    title: 'The Chimney Nap', plaque: 'A sleepy fox curls up beside the chimney warmth.' } },
  { id: 'sunflower', wishId: 'fw10-08', family: 'hearth', kitRevision: 2, draft: {
    plan: { version: 2, kind: 'lantern', motif: 'sunflower', finish: 'native', accent: 'none' },
    title: 'The Sunny Welcome', plaque: 'A cheerful sunflower lantern welcomes the evening home.' } },
];

export function fixedWish(id: string): string {
  const wish = FW10_WISHES.find(wish => wish.id === id);
  if (!wish) throw new Error('Unknown fixed repeatability wish.');
  return wish.words;
}
