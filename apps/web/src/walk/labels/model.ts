import type { CitizenChatCue } from '@chatdom/shared';
import type { SpeechFrame } from './bus';

/** A witnessed person at the projected head (or, for a chat-only person, above their door); positions include any seated offset. */
export interface PersonLabel {
  readonly id: string;
  readonly walkerId?: string;
  readonly slot?: number;
  readonly x: number;
  readonly y: number;
  readonly distance: number;
  readonly self: boolean;
  readonly name: string | null;
  readonly speech?: CitizenChatCue['parts'];
  readonly opacity?: number;
  /** The bubble rises from a lit home: this person chats but is not walking. */
  readonly home?: boolean;
  /** 0 when a wall hides the anchor, 1 when it is in clear view. */
  readonly visibility?: number;
}
export interface WalkerLabelInput {
  readonly id: string;
  readonly slot?: number;
  readonly x: number;
  readonly y: number;
  readonly distance: number;
  readonly self: boolean;
  readonly name: string;
  readonly opacity?: number;
}
export interface SpeechLabelInput {
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  readonly distance: number;
  readonly name: string | null;
  readonly parts: CitizenChatCue['parts'];
  readonly opacity?: number;
}

/** The id of a walker's bubble: its own label beside the name plate, so each eases in and out on its own. */
export const speechLabelId = (walkerId: string) => `speech:${walkerId}`;

/** A walker's bubble at the same projected head as their name plate. */
function walkerBubble(walker: PersonLabel, name: string | null, parts: CitizenChatCue['parts']): PersonLabel {
  return { ...walker, id: speechLabelId(walker.walkerId!), name: name ?? walker.name, speech: parts };
}

/**
 * Join only on authority-supplied home slots. Unmatched speech and walkers remain visible independently. A walker
 * who speaks keeps their name plate and gains a bubble beside it (see `joinSpeech`).
 */
export function peopleFromLabels(walkers: readonly WalkerLabelInput[], speech: readonly SpeechLabelInput[]): PersonLabel[] {
  const people: PersonLabel[] = walkers.map(walker => ({ id: `walker:${walker.id}`, walkerId: walker.id,
    ...(walker.slot !== undefined ? { slot: walker.slot } : {}), x: walker.x, y: walker.y, distance: walker.distance,
    self: walker.self, name: walker.name, ...(walker.opacity !== undefined ? { opacity: walker.opacity } : {}) }));
  const bySlot = new Map(people.filter(person => person.slot !== undefined).map(person => [person.slot!, person]));
  for (const cue of speech) {
    const walker = bySlot.get(cue.slot);
    if (walker) { people.push({ ...walkerBubble(walker, cue.name, cue.parts), x: cue.x, y: cue.y, distance: cue.distance,
      ...(cue.opacity !== undefined ? { opacity: cue.opacity } : {}) }); continue; }
    people.push({ id: `slot:${cue.slot}`, slot: cue.slot, x: cue.x, y: cue.y, distance: cue.distance, self: false, name: cue.name,
      speech: cue.parts, ...(cue.opacity !== undefined ? { opacity: cue.opacity } : {}) });
  }
  return people;
}

/**
 * Join the frame's names with the same frame's speech. A walker's line becomes a bubble at that walker's own
 * projected head, beside their name plate, so the bubble sits on the head the host projected this frame (there is
 * no second, older projection of it) and each label fades and rises on its own: the bubble eases in over the name,
 * the name yields under it, and they cross back when the line ends. A speaker beyond bubble range keeps their name.
 * A chat-only person's line becomes a bubble over their home. A walker hidden this frame (behind a wall, too far,
 * your own head in first person) has no label, and so no bubble: it fades where it was.
 */
export function joinSpeech(people: readonly PersonLabel[], frame: SpeechFrame | null | undefined): PersonLabel[] {
  if (!frame?.speech.length) return [...people];
  const walkerBySlot = new Map<number, PersonLabel>();
  for (const person of people) if (person.walkerId !== undefined && person.slot !== undefined && !person.speech && !walkerBySlot.has(person.slot)) walkerBySlot.set(person.slot, person);
  const joined = [...people], homes: PersonLabel[] = [];
  const bubbles = new Set(people.filter(person => person.speech?.length).map(person => person.id));
  for (const line of frame.speech) {
    const walker = walkerBySlot.get(line.slot);
    if (walker) {
      const bubble = walkerBubble(walker, line.name, line.parts);
      // A host that still supplies its own speech for this walker keeps its place; the per-frame line wins on content.
      if (bubbles.has(bubble.id)) joined[joined.findIndex(person => person.id === bubble.id)] = bubble;
      else { joined.push(bubble); bubbles.add(bubble.id); }
      continue;
    }
    if (line.from !== 'home' || line.x === undefined || line.y === undefined || line.distance === undefined) continue;
    homes.push({ id: `home:${line.slot}`, slot: line.slot, x: line.x, y: line.y, distance: line.distance, self: false,
      name: line.name, speech: line.parts, home: true, visibility: line.visibility ?? 1 });
  }
  return [...joined, ...homes];
}

/**
 * The measured size belongs to the element, not to its words: a name appearing or disappearing above a bubble
 * (a home's own name plate taking over, a toggle) must not throw the size away and blink the bubble for a frame.
 * Only the kind of label (a name plate or a bubble with these words) decides which measurement applies.
 */
export function labelMeasureKey(person: PersonLabel): string {
  return JSON.stringify([person.id, person.speech ?? null]);
}

/** Everything that changes what a label shows; positions and fades are excluded. */
export function labelContentKey(person: PersonLabel): string {
  return JSON.stringify([person.name, person.self, person.speech ?? null, person.home ?? false]);
}
