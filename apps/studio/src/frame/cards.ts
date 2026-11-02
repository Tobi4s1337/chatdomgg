// Title cards: carved type from the product's own kit (IM Fell English and Alegreya), drawn over kingdom plates.
// Each card is a pure function of t: it fades and drifts in, holds, and leaves.

export interface Card {
  id: string;
  duration: number;
  /** Fade in from `in` over `fade` seconds; fade out ending at `out`. */
  in: number;
  out: number;
  fade: number;
  lines: readonly { text: string; role: 'wordmark' | 'line' | 'url' }[];
  /** Darken behind the type so it reads on any plate (0..1). */
  scrim: number;
}

export const CARDS: Record<string, Card> = {
  title: { id: 'title', duration: 6, in: 2.2, out: 5.9, fade: 0.9, scrim: 0.22, lines: [{ text: 'Chatdom', role: 'wordmark' }] },
  close: {
    id: 'close', duration: 7, in: 1.6, out: 7, fade: 1.1, scrim: 0.35,
    lines: [{ text: 'Every chat deserves a kingdom.', role: 'line' }, { text: 'chatdom.gg', role: 'url' }],
  },
};
