import type { RealmInteractionAction, RealmInteractionTarget } from '@chatdom/shared/realm';

/** One clear verb per action, said the way the place would say it. No IDs, no lease vocabulary. */
export const VERB: Readonly<Record<RealmInteractionAction, string>> = {
  sit: 'Sit by the fire', tavern: 'Take a seat', forge: 'Work the anvil', 'enter-home': 'Go inside', 'exit-home': 'Step outside', stand: 'Stand up',
};
/** While the room decides. Short enough to read in the 100 ms it first appears. */
export const PENDING: Readonly<Record<RealmInteractionAction, string>> = {
  sit: 'Sitting down…', tavern: 'Asking the table…', forge: 'Reaching for the anvil…', 'enter-home': 'Opening the door…', 'exit-home': 'Stepping out…', stand: 'Getting up…',
};
/** Quiet context when nothing is actionable. It never wins over something you can use. */
export const QUIET = { occupied: 'Someone is sitting here', 'not-yours': 'A neighbour’s home', blocked: 'Your doorway is blocked inside', far: 'Walk a little closer' } as const;
/** Where you are, while seated. */
export const SEATED: Readonly<Partial<Record<RealmInteractionTarget['kind'], string>>> = { 'bench-seat': 'Watching the square', 'campfire-seat': 'By the fire', 'tavern-seat': 'At the table' };
