import { draw } from '../../../world/src/genesis/landscape';
import type { KeeperRole, KeeperTemperament } from './types';

/**
 * Keepers greet people in lines written by hand (World-Tree §3: "they speak only facts the kingdom witnessed"). Each line
 * declares the facts it needs; a line is eligible only when every one is supplied, and every slot is filled from those
 * facts or from the keeper's own authored identity. No line states a count, a date, a follow, a subscription, a stream or
 * anything about the channel; nothing is spoken that the realm did not record. Delivery (the Voice, a speech bubble,
 * timing) belongs to main.
 */
export type GreetingFact = 'name' | 'first' | 'returning' | 'street';

/**
 * What the realm actually knows when someone comes by. `citizen` is present only when the person's public name passed
 * the kingdom's name check (Safety: a name that fails it is never spoken). `visit` is what the realm itself witnessed;
 * `unknown` claims nothing. `home` is the person's own settled street, when the realm records one.
 */
export interface KeeperGreetingFacts {
  readonly citizen: { readonly publicName: string; readonly nameCheck: 'passed' } | null;
  readonly visit: 'first-witnessed' | 'returning-witnessed' | 'unknown';
  readonly realmHour: number;
  readonly home: { readonly street: string } | null;
}

export interface GreetingLine {
  readonly id: string;
  /** Slots: {name} {keeper} {place} {hour} {street}. */
  readonly text: string;
  readonly needs: readonly GreetingFact[];
}

const L = (id: string, text: string, ...needs: GreetingFact[]): GreetingLine => ({ id, text, needs });

export const GREETINGS: Readonly<Record<KeeperRole, Readonly<Record<KeeperTemperament, readonly GreetingLine[]>>>> = {
  innkeeper: {
    hearty: [
      L('inn.hearty.open', "Good {hour}! Come in, come in, the fire's going."),
      L('inn.hearty.name', "{name}! In you come, there's a seat by the fire.", 'name'),
      L('inn.hearty.first', 'Welcome to {place}, {name}. First time through my door? Mind the step.', 'name', 'first'),
      L('inn.hearty.back', 'Back again, {name}? Good. The kettle never minds company.', 'name', 'returning'),
      L('inn.hearty.street', "Off {street}, aren't you, {name}? Then you're practically family.", 'name', 'street'),
    ],
    wry: [
      L('inn.wry.open', 'Door\'s open. Has been all {hour}.'),
      L('inn.wry.name', '{name}. Thought I heard the step creak.', 'name'),
      L('inn.wry.first', 'New face. Welcome to {place}. Wipe your boots.', 'first'),
      L('inn.wry.back', "{name}, back so soon? Can't keep away, can you.", 'name', 'returning'),
      L('inn.wry.street', '{street}, is it? Good street. Fine choice, {name}.', 'name', 'street'),
    ],
    gentle: [
      L('inn.gentle.open', "Come in, there's warmth to spare."),
      L('inn.gentle.name', 'Oh, {name}, hello. Come and sit, if you like.', 'name'),
      L('inn.gentle.first', "You've found {place}. I'm {keeper}; I keep the door.", 'first'),
      L('inn.gentle.back', "It's good to see you again, {name}.", 'name', 'returning'),
      L('inn.gentle.street', "{name}, from {street}. I hoped you'd stop by.", 'name', 'street'),
    ],
  },
  lamplighter: {
    hearty: [
      L('lamp.hearty.open', 'Good {hour}! The lamps of {place} are trimmed and ready.'),
      L('lamp.hearty.name', "{name}! Now there's a light worth waiting for.", 'name'),
      L('lamp.hearty.first', 'First time in {place}? Every lamp here waits for someone. Welcome.', 'first'),
      L('lamp.hearty.back', "{name}, back again. The court's brighter for it.", 'name', 'returning'),
    ],
    wry: [
      L('lamp.wry.open', 'I trim the wicks. You lot do the shining.'),
      L('lamp.wry.name', '{name}. Mind the pole.', 'name'),
      L('lamp.wry.first', 'A new one. {place} likes new ones.', 'first'),
      L('lamp.wry.back', 'Back, {name}? The lamps noticed before I did.', 'name', 'returning'),
    ],
    gentle: [
      L('lamp.gentle.open', 'Good {hour}. The lamps are ready whenever folk come.'),
      L('lamp.gentle.name', "Hello, {name}. It's warmer with you here.", 'name'),
      L('lamp.gentle.first', "Welcome to {place}. I'm {keeper}; I look after the lamps.", 'first'),
      L('lamp.gentle.back', "{name}, you came back. I'm glad.", 'name', 'returning'),
      L('lamp.gentle.street', 'Heading home to {street}, {name}? Mind the cobbles.', 'name', 'street'),
    ],
  },
  ferryman: {
    hearty: [
      L('ferry.hearty.open', 'Ahoy there! Step lively on the planks.'),
      L('ferry.hearty.name', '{name}! Good to see a face on the landing.', 'name'),
      L('ferry.hearty.first', "New to {place}? The water's been waiting. Welcome.", 'first'),
      L('ferry.hearty.back', '{name}, back at the water. It missed you.', 'name', 'returning'),
    ],
    wry: [
      L('ferry.wry.open', 'Planks are wet. They always are.'),
      L('ferry.wry.name', "{name}. Don't rock anything.", 'name'),
      L('ferry.wry.first', 'First time at the water? Keep your boots dry.', 'first'),
      L('ferry.wry.back', "{name} again. I'll start keeping a peg for you.", 'name', 'returning'),
    ],
    gentle: [
      L('ferry.gentle.open', 'Good {hour}. Sit by the water a while, if you like.'),
      L('ferry.gentle.name', 'Hello, {name}. Nice to share the landing.', 'name'),
      L('ferry.gentle.first', "Welcome to {place}. I'm {keeper}; I mind the landing.", 'first'),
      L('ferry.gentle.back', 'You came back to the water, {name}. Good.', 'name', 'returning'),
    ],
  },
};

/** The realm hour as a greeting word; late night is still "evening" to a keeper. */
export function hourWord(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (!Number.isFinite(hour)) throw new Error('A greeting needs a finite realm hour.');
  const h = ((hour % 24) + 24) % 24;
  return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : 'evening';
}

export interface KeeperGreeting {
  readonly lineId: string;
  readonly text: string;
  /** The facts this line used, so the host can show or audit why it was said. */
  readonly used: readonly GreetingFact[];
}

export interface KeeperSpeaker {
  readonly role: KeeperRole;
  readonly temperament: KeeperTemperament;
  /** The keeper's authored fantasy name. */
  readonly name: string;
  /** The authored name of the place it keeps. */
  readonly placeName: string;
  readonly seedKey: string;
}

/**
 * Pick and fill a greeting. Lines that need a fact the realm does not have are never eligible; among the rest, more
 * personal lines are likelier. `salt` (for example the person's realm id and the realm day) varies the choice without
 * any global randomness: the same keeper, facts and salt always give the same line.
 */
export function keeperGreeting(speaker: KeeperSpeaker, facts: KeeperGreetingFacts, salt: string): KeeperGreeting {
  const lines = GREETINGS[speaker.role]?.[speaker.temperament];
  if (!lines) throw new Error(`No lines for a ${speaker.temperament} ${speaker.role}.`);
  if (facts.citizen && facts.citizen.nameCheck !== 'passed') throw new Error('Only a name that passed the name check is spoken.');
  const have = new Set<GreetingFact>();
  if (facts.citizen) have.add('name');
  if (facts.visit === 'first-witnessed') have.add('first');
  if (facts.visit === 'returning-witnessed') have.add('returning');
  if (facts.home && facts.citizen) have.add('street');
  const eligible = lines.filter(line => line.needs.every(need => have.has(need)));
  if (!eligible.length) throw new Error(`The ${speaker.role} has no line for these facts.`);
  const weights = eligible.map(line => 1 + line.needs.length * 2);
  let pick = draw(speaker.seedKey, `greeting/${speaker.role}/${salt}`) * weights.reduce((a, b) => a + b, 0);
  let line = eligible[eligible.length - 1]!;
  for (const [i, candidate] of eligible.entries()) { pick -= weights[i]!; if (pick < 0) { line = candidate; break; } }
  const slots: Record<string, string> = { keeper: speaker.name, place: speaker.placeName, hour: hourWord(facts.realmHour) };
  if (facts.citizen) slots.name = facts.citizen.publicName;
  if (facts.home) slots.street = facts.home.street;
  const text = line.text.replace(/\{(\w+)\}/g, (_match, slot: string) => {
    const value = slots[slot];
    if (value === undefined) throw new Error(`Line ${line.id} has no value for {${slot}}.`);
    return value;
  });
  return { lineId: line.id, text, used: line.needs };
}
