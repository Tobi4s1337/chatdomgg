import { FW10_WISHES } from './fw10-wishes';

/**
 * FW11's fixed set of fifty typical wishes: FW10's twenty unchanged, then thirty more written the way chat writes
 * (short, casual, misspelt, emoji, other languages, a pun or an emote). Lane-authored and fixed before the run; never
 * real people's words. `expectedMotif` names a known motif only where the wish plainly asks for one.
 */
export const FW11_EXTRA_WISHES = [
  { id: 'fw11-21', category: 'known', expectedMotif: 'sleeping-dragon', words: 'dragon chimney pls!! a sleepy one' },
  { id: 'fw11-22', category: 'known', expectedMotif: 'crescent-moon', words: 'moon lantern for my door 🌙' },
  { id: 'fw11-23', category: 'known', expectedMotif: 'watchful-owl', words: 'can i get an owl weathervane, like a grumpy old owl' },
  { id: 'fw11-24', category: 'known', expectedMotif: 'sleeping-fox', words: 'A fox napping on my chimney, tail over its nose.' },
  { id: 'fw11-25', category: 'known', expectedMotif: 'sunflower', words: 'sunflower lantern so my house is always sunny' },
  { id: 'fw11-26', category: 'known', expectedMotif: 'scallop-shell', words: 'seashell on top of the chimney because I miss the beach' },
  { id: 'fw11-27', category: 'known', expectedMotif: 'shooting-star', words: 'a falling star on a weathervane ✨' },
  { id: 'fw11-28', category: 'known', expectedMotif: 'crescent-moon', words: 'Copper crescent moon lantern, a bit worn, please.' },
  { id: 'fw11-29', category: 'known', expectedMotif: 'sleeping-dragon', words: 'a ceramic dragon dozing on the chimney with little green scales' },
  { id: 'fw11-30', category: 'known', expectedMotif: 'watchful-owl', words: 'Owl on the roof that keeps an eye on the street at night.' },
  { id: 'fw11-31', category: 'creature', words: 'a frog sitting on my chimney like it owns the place' },
  { id: 'fw11-32', category: 'creature', words: 'Could I have a cat curled up asleep on the roof?' },
  { id: 'fw11-33', category: 'creature', words: 'a whale weathervane swimming through the wind' },
  { id: 'fw11-34', category: 'creature', words: 'little snail lantern, slow and glowy' },
  { id: 'fw11-35', category: 'creature', words: 'A rabbit made of copper for the top of my house.' },
  { id: 'fw11-36', category: 'object', words: 'a lantern that looks like a jar full of fireflies' },
  { id: 'fw11-37', category: 'object', words: 'Chimney shaped like a stack of old books.' },
  { id: 'fw11-38', category: 'object', words: 'a key weathervane, a big old brass key' },
  { id: 'fw11-39', category: 'object', words: 'mushroom lantern!!! red with white dots' },
  { id: 'fw11-40', category: 'object', words: 'A paper boat turning in the wind on my roof.' },
  { id: 'fw11-41', category: 'painting', words: 'a painting of the mountains at sunrise for over my fireplace' },
  { id: 'fw11-42', category: 'painting', words: 'Can I get a little portrait of my house on a stormy night?' },
  { id: 'fw11-43', category: 'pun', words: 'a lantern that is the light of my life lol' },
  { id: 'fw11-44', category: 'pun', words: 'a chimney with a little hat on, so it is a top hat chimney' },
  { id: 'fw11-45', category: 'emote', words: 'PogChamp weathervane on my roof' },
  { id: 'fw11-46', category: 'emote', words: 'a LUL lantern for the door' },
  { id: 'fw11-47', category: 'language', words: 'Eine kleine Laterne in Form eines Mondes für meine Tür, bitte.' },
  { id: 'fw11-48', category: 'language', words: 'Une girouette avec un petit hibou, s’il vous plaît.' },
  { id: 'fw11-49', category: 'language', words: 'Um dragãozinho dormindo na minha chaminé.' },
  { id: 'fw11-50', category: 'typo', words: 'a lantren with a sunflwoer on it pls' },
] as const;

export const FW11_WISHES = [
  ...FW10_WISHES,
  ...FW11_EXTRA_WISHES,
] as const;
