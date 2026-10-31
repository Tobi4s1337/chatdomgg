import { colourDistance, type Hex } from './colour';
import { seedLook, type CitizenLook } from './recipe';

/*
 * Variety (spec B4): two citizens in one town should rarely look alike. `lookDistance` scores how different two
 * looks read from across the square, weighted the way people tell each other apart: hair first (style and
 * colour), then a hat, the colour of what is worn on the chest, glasses and beards, then skin, then the small
 * things. Below `NEAR_DUPLICATE` two looks read as the same person at stream distance.
 */

/** Two looks closer than this read as one person at stream distance. */
export const NEAR_DUPLICATE = 4;

const hue = (a: Hex, b: Hex, span = .25) => Math.min(1, colourDistance(a, b) / span);
const differ = (a: unknown, b: unknown) => (JSON.stringify(a) === JSON.stringify(b) ? 0 : 1);

export function lookDistance(a: CitizenLook, b: CitizenLook): number {
  let d = 0;
  d += 3 * differ(a.hair.style, b.hair.style) + 3 * hue(a.hair.colour, b.hair.colour);
  d += 1.2 * hue(a.skin, b.skin, .2);
  const hatA = a.earned.forgedHat ? 'forged' : a.hat?.style ?? null, hatB = b.earned.forgedHat ? 'forged' : b.hat?.style ?? null;
  d += hatA !== hatB ? 2.5 : a.hat && b.hat ? hue(a.hat.colour, b.hat.colour) : 0;
  // What is seen on the chest: the outer layer if one is worn, else the top.
  const chestA = a.outer ?? a.top, chestB = b.outer ?? b.top;
  d += 2.2 * hue(chestA.dye, chestB.dye) + .6 * differ(chestA.pattern, chestB.pattern);
  d += .8 * differ(a.top.style, b.top.style) + (a.outer || b.outer ? .8 * hue(a.top.dye, b.top.dye) : 0);
  d += 1.4 * differ(a.outer?.style ?? null, b.outer?.style ?? null);
  d += 1.5 * differ(a.glasses?.style ?? null, b.glasses?.style ?? null);
  d += 1.5 * differ(a.beard?.style ?? null, b.beard?.style ?? null) + differ(a.moustache?.style ?? null, b.moustache?.style ?? null);
  d += .5 * differ(a.bottom.style, b.bottom.style) + .5 * hue(a.bottom.dye, b.bottom.dye);
  d += .4 * differ(a.eyes.shape, b.eyes.shape) + .3 * differ(a.eyes.spacing, b.eyes.spacing) + .3 * differ(a.freckles, b.freckles) + .2 * differ(a.blush, b.blush);
  d += .4 * differ(a.earrings?.style ?? null, b.earrings?.style ?? null) + .6 * differ(!!a.flower, !!b.flower);
  d += .6 * differ(a.neckwear?.style ?? null, b.neckwear?.style ?? null);
  d += 1.5 * differ(a.earned.cape?.kind ?? null, b.earned.cape?.kind ?? null) + .8 * differ(!!a.earned.hood, !!b.earned.hood) + differ(!!a.earned.scarf, !!b.earned.scarf);
  return d;
}

/** The distance from a look to its nearest neighbour in a town (Infinity in an empty town). */
export function nearest(look: CitizenLook, town: readonly CitizenLook[]): number {
  let best = Infinity;
  for (const other of town) best = Math.min(best, lookDistance(look, other));
  return best;
}

const ATTEMPTS = 24;

/**
 * A person's look when they settle in a town: their seeded look, unless it is a near-twin of someone already
 * there, in which case the next seeds from their id are tried until one stands apart. Deterministic for the
 * same person and town; `adjust` applies what the person brings anyway (their favourite dye) before measuring.
 * Main runs it once at settling and saves the result, so nobody's look changes when others arrive later.
 */
export function settleLook(personId: string, town: readonly CitizenLook[], adjust: (look: CitizenLook) => CitizenLook = l => l): CitizenLook {
  let best: CitizenLook | null = null, bestDistance = -1;
  for (let i = 0; i < ATTEMPTS; i++) {
    const look = adjust(seedLook(i ? `${personId}#${i}` : personId));
    const d = nearest(look, town);
    if (d >= NEAR_DUPLICATE) return look;
    if (d > bestDistance) { best = look; bestDistance = d; }
  }
  return best!;
}

/**
 * The builder's dice: a fresh complete look that stands apart from the town, keeping what the person earned
 * and chose to wear. `random` supplies the roll so the builder can replay it.
 */
export function randomLook(random: () => number, current: CitizenLook, town: readonly CitizenLook[] = []): CitizenLook {
  const seed = `roll:${Math.floor(random() * 2 ** 32).toString(36)}`;
  const rolled = settleLook(seed, [...town, current], look => ({
    ...look,
    earned: current.earned,
    // Earned pieces that take a slot keep it: a forged hat stays over no hat, a raid scarf over no neckwear.
    hat: current.earned.forgedHat ? null : look.hat,
    neckwear: current.earned.scarf ? null : look.neckwear,
  }));
  return rolled;
}
