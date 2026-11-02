import { ROD_MAX_NOTCHES, ROD_NOTCH_EVERY, type FishingRodHistory } from '@chatdom/shared';
import { titleOf } from '../bag/kinds';
import { formatMoment } from '../bag/words';

export interface RodFact { readonly label: string; readonly value: string }

const metres = (value: number) => `${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })} m`;

/** What a rod's card says about its history: fish landed, notches, earned reach and the legend's ribbon. */
export function rodFacts(history: FishingRodHistory | null): readonly RodFact[] {
  if (!history) return [];
  const facts: RodFact[] = [{ label: 'Fish landed', value: history.catches.toLocaleString('en-GB') }];
  if (history.notches > 0) facts.push({ label: 'Notches', value: history.notches >= ROD_MAX_NOTCHES ? `${history.notches}, the grip is full`
    : `${history.notches}, one for every ${ROD_NOTCH_EVERY} fish` });
  else facts.push({ label: 'Notches', value: `The first at ${ROD_NOTCH_EVERY} fish` });
  if (history.reachM > 0) facts.push({ label: 'Reach', value: `${metres(history.reachM)} further on a full cast` });
  if (history.legend) {
    const when = formatMoment(history.legend.at);
    facts.push({ label: 'Ribbon', value: `For the ${titleOf(history.legend.speciesId)}${when ? `, ${when}` : ''}` });
  }
  return facts;
}

/** A few words for the rod's key on the belt. */
export function rodNote(history: FishingRodHistory | null): string | null {
  if (!history) return null;
  return history.catches === 1 ? 'one fish landed' : `${history.catches.toLocaleString('en-GB')} fish landed`;
}
