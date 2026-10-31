import { colourDistance, oklab, rgb, type Hex } from './colour';
import { tenureGarb, type CitizenEntitlements } from './earned';
import { DYES } from './palette';
import { defaultAccent, seedLook, type CitizenLook } from './recipe';
import { settleLook } from './variety';

/*
 * Defaults from Twitch (spec B2). A newcomer already looks like someone: the look is seeded from their person
 * id and kept apart from the town's other citizens; their chat name colour becomes their favourite dye, worn on
 * the garment people see first; and the tenure garb their records allow is already on. Everything is a
 * starting point the person tweaks in the builder.
 */

/**
 * The garment dye nearest a Twitch name colour. Twitch's own name colours are pure web colours (#0000ff,
 * #00ff7f), so they are matched to the dye swatches rather than used raw; a saturated name never lands on a grey.
 */
export function favouriteDye(nameColour: string | null | undefined): Hex | null {
  if (!nameColour || !/^#[0-9a-f]{6}$/i.test(nameColour)) return null;
  const name = nameColour.toLowerCase() as Hex;
  const [, a, b] = oklab(rgb(name));
  const chromatic = Math.hypot(a, b) > .06;
  const candidates = DYES.filter(d => {
    if (!chromatic) return true;
    const [, da, db] = oklab(rgb(d.hex));
    return Math.hypot(da, db) > .06;
  });
  return candidates.reduce((best, d) => (colourDistance(d.hex, name) < colourDistance(best.hex, name) ? d : best), candidates[0]!).hex;
}

/** Wears the favourite dye on the garment seen first: an open outer layer if there is one, else the top. */
export function withFavouriteDye(look: CitizenLook, dye: Hex): CitizenLook {
  const recolour = <G extends { dye: Hex; accent: Hex; pattern: string }>(g: G): G => ({
    ...g, dye, accent: colourDistance(g.accent, dye) < .12 ? defaultAccent(dye) : g.accent,
  });
  if (look.outer) {
    // An outer layer in the favourite dye over a top of the same colour would merge: the top steps aside.
    const top = colourDistance(look.top.dye, dye) < .12 ? { ...look.top, dye: defaultAccent(dye) === '#f3f1ee' ? '#f3f1ee' as Hex : '#3a3a40' as Hex } : look.top;
    return { ...look, top, outer: recolour(look.outer) };
  }
  return { ...look, top: recolour(look.top) };
}

export interface TwitchDefaults {
  /** The person id main resolves from the Twitch identity: the seed. */
  readonly personId: string;
  /** The chat name colour, `#rrggbb`, or null when none is set. */
  readonly nameColour: string | null;
  /** Verified records in the kingdom they arrive in. */
  readonly entitlements: CitizenEntitlements;
  /** Looks already in the town, so a newcomer is never a near-twin of a neighbour. */
  readonly town?: readonly CitizenLook[];
}

/** The look a person has before they ever open the builder. Deterministic for the same inputs. */
export function twitchDefaultLook({ personId, nameColour, entitlements, town = [] }: TwitchDefaults): CitizenLook {
  const dye = favouriteDye(nameColour);
  const base = town.length ? settleLook(personId, town, look => (dye ? withFavouriteDye(look, dye) : look)) : seedLook(personId);
  const dyed = dye ? withFavouriteDye(base, dye) : base;
  return tenureGarb(dyed, entitlements);
}
