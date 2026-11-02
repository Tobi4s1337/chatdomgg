/**
 * Fixed shared celebrations. Twitch's product list supplies the amount shown in the panel;
 * suggestedBits is only the catalogue's suggested band economy. The three bands of a gift
 * all bring the same moment, with no difference in scale, standing, or outcome.
 *
 * The bard's verse is written and displayed in the kingdom. It requests no song or audio.
 */
export type GiftTarget = 'none' | 'friend' | 'self';

export interface GiftBand {
  readonly id: string;
  readonly suggestedBits: number;
}

export interface GiftDefinition {
  readonly id: string;
  readonly title: string;
  readonly what: string;
  readonly durationMs: number;
  readonly target: GiftTarget;
  readonly bands: readonly [GiftBand, GiftBand, GiftBand];
}

const minute = 60_000;
const hour = 60 * minute;
const bands = (id: string): GiftDefinition['bands'] => [
  { id: `${id}a`, suggestedBits: 100 },
  { id: `${id}b`, suggestedBits: 300 },
  { id: `${id}c`, suggestedBits: 500 },
];

/** The catalogue is deliberately finite; no text or effect is supplied by the viewer. */
export const GIFT_CATALOGUE: readonly GiftDefinition[] = [
  { id: 'friendfireworks', title: 'Fireworks for a friend', what: 'A little burst of stars over a friend’s home.', durationMs: minute, target: 'friend', bands: bands('friendfireworks') },
  { id: 'streetlanterns', title: 'Street lanterns', what: 'Decorative lanterns dress the streets in warm colour.', durationMs: 24 * hour, target: 'none', bands: bands('streetlanterns') },
  { id: 'kites', title: 'Kites on the breeze', what: 'A handful of bright kites cross the sky.', durationMs: 5 * minute, target: 'none', bands: bands('kites') },
  { id: 'bell', title: 'The plaza bell', what: 'The plaza bell swings to mark a happy moment.', durationMs: minute, target: 'none', bands: bands('bell') },
  { id: 'bunting', title: 'Dress my home', what: 'Festival bunting dresses your home for everyone to see.', durationMs: 24 * hour, target: 'self', bands: bands('bunting') },
  { id: 'parade', title: 'A little parade', what: 'Pennants and ribbons pass through the plaza.', durationMs: 5 * minute, target: 'none', bands: bands('parade') },
  { id: 'feast', title: 'A feast for the table', what: 'A shared feast is laid out in the plaza.', durationMs: hour, target: 'none', bands: bands('feast') },
  { id: 'bardverse', title: 'A bard’s verse', what: 'A short written verse celebrates the kingdom.', durationMs: 5 * minute, target: 'none', bands: bands('bardverse') },
  { id: 'flowerpetals', title: 'Petals in the air', what: 'Petals drift gently across the plaza.', durationMs: 5 * minute, target: 'none', bands: bands('flowerpetals') },
  { id: 'paperboats', title: 'Paper boats', what: 'A flotilla of paper boats sets sail together.', durationMs: 5 * minute, target: 'none', bands: bands('paperboats') },
  { id: 'ribbonarch', title: 'The ribbon arch', what: 'A ribbon arch welcomes everyone at the gate.', durationMs: 24 * hour, target: 'none', bands: bands('ribbonarch') },
  { id: 'plazaflowers', title: 'Flowers for the plaza', what: 'Flower baskets appear around the gathering place.', durationMs: 24 * hour, target: 'none', bands: bands('plazaflowers') },
  { id: 'friendflowers', title: 'Flowers for a friend', what: 'A flower basket rests at a friend’s door.', durationMs: 24 * hour, target: 'friend', bands: bands('friendflowers') },
  { id: 'confetti', title: 'Confetti shower', what: 'A flutter of paper confetti fills the plaza.', durationMs: minute, target: 'none', bands: bands('confetti') },
  { id: 'skybanners', title: 'Sky banners', what: 'Long banners unfurl above the kingdom.', durationMs: 5 * minute, target: 'none', bands: bands('skybanners') },
  { id: 'picnic', title: 'A picnic in the square', what: 'Blankets and baskets make a place to gather.', durationMs: hour, target: 'none', bands: bands('picnic') },
  { id: 'pinwheels', title: 'Pinwheels', what: 'Colourful pinwheels turn along the streets.', durationMs: 24 * hour, target: 'none', bands: bands('pinwheels') },
  { id: 'starribbons', title: 'Ribbons of stars', what: 'A trail of paper stars winds over the plaza.', durationMs: 5 * minute, target: 'none', bands: bands('starribbons') },
  { id: 'gatewreath', title: 'A wreath for the gate', what: 'A festive wreath hangs above the open gate.', durationMs: 24 * hour, target: 'none', bands: bands('gatewreath') },
  { id: 'friendpennant', title: 'A friend’s pennant', what: 'A festive pennant flies by a friend’s home.', durationMs: 24 * hour, target: 'friend', bands: bands('friendpennant') },
];

/** The streamer's first selection, changeable in their settings. */
export const DEFAULT_GIFT_IDS: readonly string[] = [
  'friendfireworks', 'streetlanterns', 'kites', 'bell',
  'bunting', 'parade', 'feast', 'bardverse',
];
