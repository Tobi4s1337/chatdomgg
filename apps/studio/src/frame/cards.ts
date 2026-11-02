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
  /** Small print at the foot of the frame, fading in at `in` (s) and out with the card. */
  note?: { text: string; in: number };
}

export const CARDS: Record<string, Card> = {
  title: { id: 'title', duration: 6, in: 2.2, out: 5.9, fade: 0.9, scrim: 0.22, lines: [{ text: 'Chatdom', role: 'wordmark' }] },
  close: {
    // The line comes up as the narrator says it (3.4 s into the card), after the caption before it has left.
    id: 'close', duration: 7, in: 3.3, out: 7, fade: 1.0, scrim: 0.35,
    lines: [{ text: 'Every chat deserves a kingdom.', role: 'line' }, { text: 'chatdom.gg', role: 'url' }],
    // The film shows a recreated Twitch page and an invented chat. Nothing inside the film is labelled (it must read
    // as a real recording), so the close says it plainly, once, where it cannot break a shot.
    note: { text: 'The Twitch page and chat in this film are staged. The kingdoms are Chatdom, rendered as they run.', in: 4.4 },
  },
};
