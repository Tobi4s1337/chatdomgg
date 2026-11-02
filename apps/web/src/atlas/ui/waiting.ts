import type { OpenKingdom } from '@chatdom/ui/site';

export interface WaitingWords {
  readonly status: string;
  readonly note: string;
  /** The way into a founded kingdom the survey has not drawn yet; null when the channel has no kingdom. */
  readonly enter: { readonly label: string; readonly href: string } | null;
}

/** What a waiting card says: a pencil note for a channel without land, or the way in when its kingdom is founded. */
export function waitingWords(founded: OpenKingdom | null | undefined, onAir: boolean): WaitingWords {
  if (!founded) {
    return {
      status: onAir ? 'On air · no land of its own' : 'Waiting · no land of its own',
      note: 'Pencilled into the realm of its language and game. This place stays the same until the channel claims land.',
      enter: null,
    };
  }
  return {
    status: `${onAir ? 'On air' : 'Founded'} · ${founded.name}`,
    note: `${founded.name} is founded and open to visit. The map draws its land with the Atlas's next edition.`,
    enter: { label: `Enter ${founded.name}`, href: `/kingdom/${encodeURIComponent(founded.kingdomId)}` },
  };
}
