import type { CitizenChatCue } from '@chatdom/shared';

/** A witnessed person at the projected head; positions include any seated offset. */
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

/** Content key prevents stale measurements from putting a changed bubble into an old name's space. */
export function labelMeasureKey(person: PersonLabel): string {
  return JSON.stringify([person.id, person.name, person.self, person.speech ?? null]);
}
