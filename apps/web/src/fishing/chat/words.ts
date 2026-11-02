import type { PierFeedEvent, PierFeedWho } from '@chatdom/shared';
import { FISH_SPECIES } from '../../../../../packages/content/src/fish';
import { formatLength, formatWeight } from '../../bag/words';
import { firstInLine, measureLine } from '../ui/logic';

/*
 * Every word the pier's chat cards say, and how long each card stays. Pure, so the wording is tested in node.
 * A hidden name (moderation, or a name taken off public pages) is never guessed at: the card says "a fisher".
 */

const SPECIES = new Map(FISH_SPECIES.map(fish => [fish.id, fish]));

export type ChatCardKind = 'catch' | 'legend' | 'full';
export interface ChatCardWords {
  readonly kind: ChatCardKind;
  /** The person's name as shown, or null when it is hidden. */
  readonly who: string | null;
  /** Their window light, for the little lamp on the card. */
  readonly colour: string | null;
  /** The whole sentence, for screen readers and tests. */
  readonly sentence: string;
  /** The sentence in three parts, so the fish's name can be set larger: lead + subject + tail. */
  readonly lead: string;
  readonly subject: string;
  readonly tail: string;
  /** "1.24 kg · 38 cm", or empty. */
  readonly measure: string;
  /** "First in Willowmere" for a kingdom first, else null. */
  readonly first: string | null;
  /** "Mount No. 3" when the catch left a numbered mount, else null. */
  readonly mount: string | null;
  /** The legend's line. */
  readonly moral: string | null;
  readonly speciesId: string | null;
  /** Seconds on screen once it has arrived. */
  readonly hold: number;
}

export const CARD_HOLD_S = 6, CARD_HOLD_BIG_S = 9, CARD_HOLD_LEGEND_S = 10, CARD_HOLD_FULL_S = 5;
export const LEGEND_MORAL = 'Only a walker could have held it.';

export function shownName(who: PierFeedWho): string | null {
  const name = who.name?.trim();
  return name ? name : null;
}

/** "a Copper Perch", "an Inkfin Wrasse". */
export function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

/** "Juniper’s", "Moss’s": a name that ends in s still takes the full possessive, as the storybook does. */
export function possessive(name: string): string {
  return `${name}’s`;
}

export function speciesName(speciesId: string): string | null {
  return SPECIES.get(speciesId)?.name ?? null;
}

export function firstWords(kingdomName: string | null): string {
  const name = kingdomName?.trim();
  return name ? firstInLine(name) : 'First in this kingdom';
}

export function mountWords(number: number | null): string | null {
  return number !== null && Number.isSafeInteger(number) && number > 0 ? `Mount No. ${number}` : null;
}

export function catchWords(event: Extract<PierFeedEvent, { kind: 'caught' }>, kingdomName: string | null): ChatCardWords {
  const name = shownName(event.who), fish = speciesName(event.fish.speciesId);
  const lead = `${name ?? 'A fisher'} caught ${fish ? (/^[aeiou]/i.test(fish) ? 'an' : 'a') : 'a'} `;
  const subject = fish ?? 'fish';
  const first = event.kingdomFirst ? firstWords(kingdomName) : null, mount = mountWords(event.keepsake);
  return { kind: 'catch', who: name, colour: event.who.colour, sentence: `${lead}${subject}`, lead, subject, tail: '',
    measure: measureLine(formatWeight(event.fish.weightG), formatLength(event.fish.lengthMm)), first, mount, moral: null,
    speciesId: fish ? event.fish.speciesId : null, hold: first || mount ? CARD_HOLD_BIG_S : CARD_HOLD_S };
}

export function brokenWords(event: Extract<PierFeedEvent, { kind: 'broken' }>): ChatCardWords {
  const name = shownName(event.who), legend = speciesName(event.speciesId);
  const lead = legend ? 'The ' : '', subject = legend ?? 'A legend';
  const tail = ` broke ${name ? possessive(name) : 'a fisher’s'} line`;
  return { kind: 'legend', who: name, colour: event.who.colour, sentence: `${lead}${subject}${tail}`, lead, subject, tail,
    measure: '', first: null, mount: null, moral: LEGEND_MORAL, speciesId: legend ? event.speciesId : null, hold: CARD_HOLD_LEGEND_S };
}

export function fullWords(event: Extract<PierFeedEvent, { kind: 'full' }>): ChatCardWords {
  const sentence = `The pier is full: ${event.cap} ${event.cap === 1 ? 'line is' : 'lines are'} out. Try again in a moment.`;
  return { kind: 'full', who: shownName(event.who), colour: event.who.colour, sentence, lead: sentence, subject: '', tail: '',
    measure: '', first: null, mount: null, moral: null, speciesId: null, hold: CARD_HOLD_FULL_S };
}

/** What a screen reader hears: the sentence, then what makes it special. */
export function cardSummary(words: ChatCardWords): string {
  return [words.sentence + (words.measure ? `, ${words.measure.replace(' · ', ', ')}` : '') + '.', words.first ? `${words.first}.` : '',
    words.mount ? `${words.mount}.` : '', words.moral ?? ''].filter(Boolean).join(' ').replace(/\.\./g, '.');
}

/* ---------- The stack: at most three cards, each holding its time, the oldest giving way early ---------- */

export const CARD_ENTER_S = .55, CARD_LEAVE_S = .45, CARD_MAX = 3;

export interface StackedCard<T> {
  readonly key: number;
  readonly value: T;
  /** Local seconds it begins to arrive. */
  readonly from: number;
  /** When it begins to leave on its own. */
  until: number;
  /** When it began to leave, once it has. */
  leaving: number | null;
}

/**
 * The card stack's rules without a DOM: cards wait for their moment (`from`), at most `max` are on screen and not
 * leaving, a newcomer sends the oldest away, and a card that has finished leaving is dropped.
 */
export function createCardStack<T>(max = CARD_MAX) {
  const cards: StackedCard<T>[] = [];
  let next = 1;
  return {
    add(value: T, from: number, hold: number): StackedCard<T> {
      const card: StackedCard<T> = { key: next++, value, from, until: from + CARD_ENTER_S + hold, leaving: null };
      cards.push(card);
      cards.sort((a, b) => a.from - b.from || a.key - b.key);
      return card;
    },
    /** Advances to `now`: returns the cards on screen (oldest first) and the ones dropped since the last call. */
    step(now: number): { readonly shown: readonly StackedCard<T>[]; readonly dropped: readonly StackedCard<T>[] } {
      const dropped: StackedCard<T>[] = [];
      for (const card of cards) if (card.leaving === null && card.from <= now && now >= card.until) card.leaving = card.until;
      const staying = cards.filter(card => card.from <= now && card.leaving === null);
      for (let i = 0; i < staying.length - max; i++) staying[i]!.leaving = now;
      for (let i = cards.length - 1; i >= 0; i--) {
        const card = cards[i]!;
        if (card.leaving !== null && now - card.leaving >= CARD_LEAVE_S) { cards.splice(i, 1); dropped.push(card); }
      }
      return { shown: cards.filter(card => card.from <= now), dropped };
    },
    clear(): readonly StackedCard<T>[] { return cards.splice(0, cards.length); },
    get size() { return cards.length; },
  };
}
