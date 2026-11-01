import {
  PORTRAIT_FIXTURES, earnedOffers, wearPiece,
  type CitizenEntitlements, type CitizenLook, type CrestShape, type EarnedOffer, type Hex,
} from '@chatdom/content/avatar-style';
import { FIXTURE_AS_OF, simulatedPassport } from '../../../../packages/ui/src/passport/craft';

/**
 * The one SIMULATED citizen every card surface shows: Wren Tarnwalker, the well-travelled holder of the passport
 * craft's `many` book. The same saved look paints their portrait in the builder, the town, the card page, the panel
 * and the share picture, so a reviewer sees one person everywhere. Not a real person: every surface that shows
 * them says SIMULATED.
 *
 * Their earned pieces are not chosen freely: `SITTER_RECORDS` are the verified records a look authority would
 * supply, the worn pieces come from `earnedOffers` for those records, and the keepsake pin is a keepsake that
 * really is in their passport. A test holds the look to `checkEarned`.
 */
export const SITTER = {
  personId: '930000003',
  name: 'Wren Tarnwalker',
  login: 'wren_tarnwalker',
  /** The kingdom of the panel's SIMULATED night, where their card is read. */
  kingdom: { id: 'simulated-willowmere', name: 'Willowmere', colours: ['#2f5e4e', '#e3b955'] as const satisfies readonly [Hex, Hex] },
  /** Their other home, where most of their roads begin. */
  elsewhere: { name: 'Tarnhollow', colours: ['#24485a', '#d8b25a'] as const satisfies readonly [Hex, Hex] },
} as const;

const DAY = 86_400_000;
const book = simulatedPassport('many');
/** The passport's newest raid: the scarf they wear was knitted on that road. */
const newestRaid = book.stamps.items.find(stamp => stamp.kind === 'raid');
/** A keepsake from the passport, worn as a pin. */
const keepsake = book.keepsakes.items[0];
const crestColours = (colours: readonly string[]): readonly [Hex, Hex] => [colours[0] as Hex, (colours[1] ?? colours[0]) as Hex];

export const SITTER_RECORDS: CitizenEntitlements = {
  origin: 'simulated',
  kingdom: { id: SITTER.kingdom.id, name: SITTER.kingdom.name, colours: SITTER.kingdom.colours },
  followedMonths: 26,
  sub: { tier: '1', months: 14, active: true },
  founder: false,
  keepsakes: keepsake ? [{
    id: keepsake.id, name: keepsake.name, earnedAt: keepsake.earnedAt,
    kingdom: { name: keepsake.kingdom.name, shape: keepsake.kingdom.crest.shape as CrestShape, colours: crestColours(keepsake.kingdom.crest.colours) },
  }] : [],
  forged: [{ id: 'sim-forged-heron-vane', title: 'Heron weathervane', forgedAt: FIXTURE_AS_OF - 19 * DAY, motif: 'watchful-owl', palette: ['#2f5e4e', '#e3b955'] }],
  moments: newestRaid ? [{
    id: `sim-raid-${newestRaid.id.replace(/^arrival:/, '')}`, kind: 'raid', at: newestRaid.at,
    kingdom: { name: newestRaid.kingdom.name, colours: crestColours(newestRaid.kingdom.crest.colours) },
    from: { name: SITTER.elsewhere.name, colours: SITTER.elsewhere.colours },
  }] : [],
};

/** The offers their records unlock, in the builder's order. */
export const SITTER_OFFERS: readonly EarnedOffer[] = earnedOffers(SITTER_RECORDS).filter(offer => offer.unlocked);

/** What they chose to wear of it: the month ribbons, the tenure hood, the keepsake pin and the raid scarf. */
const WEARS = (offer: EarnedOffer) => offer.key === 'ribbons' || offer.key === 'hood' || offer.key.startsWith('pin:keepsake:') || offer.key.startsWith('scarf:');

/** Based on the portrait sheet's Wren: auburn braids and a warm coat for the road. The sheet's glasses are left off:
 * at the panel's coin size the frames cover the eyes, and the eyes are what make a portrait somebody. */
const base = PORTRAIT_FIXTURES.find(entry => entry.name === 'Simulated Wren')!.look;
const dressed: CitizenLook = {
  ...base,
  top: { style: 'shirt', dye: '#efe4cf', pattern: 'plain', accent: '#1e1d22' },
  outer: { style: 'coat', dye: '#8c4a2f', pattern: 'plain', accent: '#f3f1ee' },
  bottom: { style: 'trousers', dye: '#3d3a45', pattern: 'plain', accent: '#1e1d22' },
  neckwear: null,
  glasses: null,
};

export const SITTER_LOOK: CitizenLook = SITTER_OFFERS.filter(WEARS).reduce((look, offer) => wearPiece(look, offer.piece), dressed);

/** A piece that remembers a journey: a keepsake from a passport, or the scarf knitted on a raid's road. */
export const remembersTravel = (offer: EarnedOffer): boolean =>
  offer.piece.family === 'scarf' || (offer.piece.family === 'pin' && offer.piece.value.kind === 'keepsake');

/** The worn pieces as the card names them, each with the story its record tells. */
export const SITTER_WORN: readonly EarnedOffer[] = SITTER_OFFERS.filter(WEARS);
