// An earned piece as the look authority's records name it (the builder's `EarnedOffer`, reduced to what the card
// shows), and how the card draws it. Kept free of the avatar library so the panel never loads it.
import type { WornPiece } from '../model';

type Pair = readonly [string, string];
export interface WornRecord {
  readonly key: string;
  readonly name: string;
  readonly story: string | null;
  readonly piece:
    | { readonly family: 'ribbons'; readonly value: { readonly months: number } }
    | { readonly family: 'hood'; readonly value: { readonly cloth: string; readonly trim: string } }
    | { readonly family: 'pin'; readonly value: { readonly kind: 'keepsake'; readonly id?: string; readonly shape: 'heater' | 'round' | 'swallowtail'; readonly colours: Pair } | { readonly kind: 'forged'; readonly colours: Pair } | { readonly kind: 'founder' } }
    | { readonly family: 'cape'; readonly value: { readonly cloth: string; readonly trim: string } }
    | { readonly family: 'scarf'; readonly value: { readonly id?: string; readonly colours: Pair } }
    | { readonly family: 'forgedHat'; readonly value: { readonly colours: Pair } };
}

const FOUNDER: Pair = ['#e3b955', '#6a4c2b'];

/**
 * A piece that remembers a journey: the scarf knitted on a raid's road, or a keepsake pin from a kingdom reached. Its
 * name and story are travel, so the card names it only while the passport itself is open to read.
 */
export function remembersTravel(piece: WornPiece): boolean {
  return piece.family === 'scarf' || (piece.family === 'pin' && piece.shape !== 'founder' && piece.shape !== 'forged');
}

export function wornPiece(record: WornRecord): WornPiece {
  const { key: id, name, story, piece } = record;
  switch (piece.family) {
    case 'ribbons': return { id, family: 'ribbons', name, story, months: piece.value.months };
    case 'hood': return { id, family: 'hood', name, story, colours: [piece.value.cloth, piece.value.trim] };
    case 'cape': return { id, family: 'cape', name, story, colours: [piece.value.cloth, piece.value.trim] };
    case 'scarf': return { id, family: 'scarf', name, story, colours: piece.value.colours };
    case 'forgedHat': return { id, family: 'forgedHat', name, story, colours: piece.value.colours };
    case 'pin': {
      const pin = piece.value;
      if (pin.kind === 'keepsake') return { id, family: 'pin', name, story, shape: pin.shape, colours: pin.colours };
      return { id, family: 'pin', name, story, shape: pin.kind, colours: pin.kind === 'forged' ? pin.colours : FOUNDER };
    }
  }
}
