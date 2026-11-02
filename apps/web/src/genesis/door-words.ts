/** A failure written for the visitor: its message is shown in the door's margin as it is. */
export class DoorRefusal extends Error {
  override readonly name = 'DoorRefusal';
}

/** What the door's margin says when the way in fails. Only a refusal speaks its own words; any other cause is logged. */
export function doorFailureWords(cause: unknown): { readonly words: string; readonly log: boolean } {
  if (cause instanceof DoorRefusal) return { words: cause.message, log: false };
  return { words: 'The road into this land could not be opened just now. Try again in a moment.', log: true };
}

/** The door of a kingdom chatdom.io opens at its front door: its own name, never "a holding". */
export function foundedDoor(kingdom: { readonly name: string; readonly login: string }) {
  return { name: kingdom.name, subtitle: `${kingdom.login}’s kingdom`, eyebrow: 'Founded kingdom' };
}
