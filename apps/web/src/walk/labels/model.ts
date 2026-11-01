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

/** Join only on authority-supplied home slots. Unmatched speech and walkers remain visible independently. */
export function peopleFromLabels(walkers: readonly WalkerLabelInput[], speech: readonly SpeechLabelInput[]): PersonLabel[] {
  const bySlot = new Map(walkers.filter(walker => walker.slot !== undefined).map(walker => [walker.slot!, walker]));
  const spoken = new Set<string>();
  const people: PersonLabel[] = speech.map(cue => {
    const walker = bySlot.get(cue.slot);
    if (walker) spoken.add(walker.id);
    return { id: walker ? `walker:${walker.id}` : `slot:${cue.slot}`, ...(walker ? { walkerId: walker.id } : {}), slot: cue.slot,
      x: cue.x, y: cue.y, distance: cue.distance, self: walker?.self ?? false, name: cue.name ?? walker?.name ?? null,
      speech: cue.parts, ...(cue.opacity !== undefined ? { opacity: cue.opacity } : walker?.opacity !== undefined ? { opacity: walker.opacity } : {}) };
  });
  for (const walker of walkers) if (!spoken.has(walker.id)) people.push({ id: `walker:${walker.id}`, walkerId: walker.id,
    ...(walker.slot !== undefined ? { slot: walker.slot } : {}), x: walker.x, y: walker.y, distance: walker.distance,
    self: walker.self, name: walker.name, ...(walker.opacity !== undefined ? { opacity: walker.opacity } : {}) });
  return people;
}

/**
 * Join the frame's names with the same frame's speech. A walker's line rides on that walker's own label, so the
 * bubble sits on the head the host projected this frame; there is no second, older projection of the same head.
 * A chat-only person's line becomes a bubble over their home. A walker hidden this frame (behind a wall, too far,
 * your own head in first person) has no label, and so no bubble: it fades where it was.
 */
export function joinSpeech(people: readonly PersonLabel[], frame: SpeechFrame | null | undefined): PersonLabel[] {
  if (!frame?.speech.length) return [...people];
  const walkerBySlot = new Map<number, number>();
  people.forEach((person, index) => { if (person.walkerId !== undefined && person.slot !== undefined && !walkerBySlot.has(person.slot)) walkerBySlot.set(person.slot, index); });
  const joined = [...people], homes: PersonLabel[] = [];
  for (const line of frame.speech) {
    const index = walkerBySlot.get(line.slot);
    if (index !== undefined) {
      const walker = joined[index]!;
      // A host that still supplies its own speech for this walker keeps it; the per-frame line wins only on content.
      joined[index] = { ...walker, name: line.name ?? walker.name, speech: line.parts };
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
