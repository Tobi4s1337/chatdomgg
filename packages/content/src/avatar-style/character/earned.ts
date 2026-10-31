import type { Hex } from './colour';
import { MAX_PINS, MONTH_MARKS, type CitizenLook, type CrestShape, type EarnedLook, type EarnedPin, type ForgedMotif, type MonthMark } from './recipe';

/*
 * Earned items (spec B3): never bought, only shown. The builder lists every earned piece there is; the ones a
 * person has unlocked can be worn, the rest say plainly how they are earned. What unlocks a piece is a verified
 * record supplied by main (`CitizenEntitlements`): never a client-only grant. A worn piece must equal the piece
 * its record allows exactly, so nobody can recolour a keepsake or wear a cape from someone else's night.
 */

/** A kingdom as the records name it: its id, its name and its two colours (field, charge). */
export interface EntitlementKingdom {
  readonly id: string;
  readonly name: string;
  readonly colours: readonly [Hex, Hex];
}

export interface MomentKingdom { readonly name: string; readonly colours: readonly [Hex, Hex] }

/**
 * The verified records one person holds in one kingdom, as main's look authority supplies them. Tenure and sub
 * pieces are Bound to the kingdom of the records; keepsakes, forged pieces and moment drops travel with the
 * person. `origin` is `simulated` for bench and test data, which every surface labels SIMULATED.
 */
export interface CitizenEntitlements {
  readonly origin: 'live' | 'simulated';
  readonly kingdom: EntitlementKingdom;
  /** Months following this channel. */
  readonly followedMonths: number;
  /** The sub to this channel, if any: tier, months subscribed, and whether it is current. */
  readonly sub: { readonly tier: 'prime' | '1' | '2' | '3'; readonly months: number; readonly active: boolean } | null;
  /** Holds Twitch's founder badge in this channel. */
  readonly founder: boolean;
  /** Passport keepsakes: each from a kingdom, with its crest. */
  readonly keepsakes: readonly {
    readonly id: string; readonly name: string; readonly earnedAt: number;
    readonly kingdom: { readonly name: string; readonly shape: CrestShape; readonly colours: readonly [Hex, Hex] };
  }[];
  /** Pieces this person forged: the motif and the piece's two palette colours. */
  readonly forged: readonly { readonly id: string; readonly title: string; readonly forgedAt: number; readonly motif: ForgedMotif; readonly palette: readonly [Hex, Hex] }[];
  /** Moments this person was part of that leave a worn piece: a cheer storm, a raid ridden. */
  readonly moments: readonly (
    | { readonly id: string; readonly kind: 'cheer-storm'; readonly at: number; readonly kingdom: MomentKingdom }
    /** A raid ridden: from the raiders' kingdom to the one raided; the scarf is knitted in both colours. */
    | { readonly id: string; readonly kind: 'raid'; readonly at: number; readonly kingdom: MomentKingdom; readonly from: MomentKingdom }
  )[];
}

/** Nothing earned yet: a newcomer. */
export const NO_ENTITLEMENTS = (kingdom: EntitlementKingdom, origin: CitizenEntitlements['origin'] = 'live'): CitizenEntitlements => ({
  origin, kingdom, followedMonths: 0, sub: null, founder: false, keepsakes: [], forged: [], moments: [],
});

export type EarnedFamily = 'ribbons' | 'hood' | 'pin' | 'cape' | 'scarf' | 'forgedHat';
export type EarnedPiece =
  | { readonly family: 'ribbons'; readonly value: NonNullable<EarnedLook['ribbons']> }
  | { readonly family: 'hood'; readonly value: NonNullable<EarnedLook['hood']> }
  | { readonly family: 'pin'; readonly value: EarnedPin }
  | { readonly family: 'cape'; readonly value: NonNullable<EarnedLook['cape']> }
  | { readonly family: 'scarf'; readonly value: NonNullable<EarnedLook['scarf']> }
  | { readonly family: 'forgedHat'; readonly value: NonNullable<EarnedLook['forgedHat']> };

/** One earned item as the builder shows it. */
export interface EarnedOffer {
  /** Stable across sessions: the family and the record id. */
  readonly key: string;
  readonly name: string;
  /** How it is earned, always: on a locked tile it is the whole message. */
  readonly earnedBy: string;
  /** What it remembers, once earned: "Rode the raid to Saltmarsh, 14 Oct". */
  readonly story: string | null;
  readonly unlocked: boolean;
  /** A sub piece after the sub lapsed: still worn, dimmed. */
  readonly dim: boolean;
  /** Towards a tenure piece, or to the next month mark. */
  readonly progress: { readonly have: number; readonly need: number; readonly unit: 'months' } | null;
  /** What wearing it puts on. A locked offer carries a preview piece that can never be saved. */
  readonly piece: EarnedPiece;
  readonly origin: CitizenEntitlements['origin'];
}

/** The year of following the tenure hood marks. */
export const HOOD_MONTHS = 12;
const PREVIEW = 'preview';

const date = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The highest month mark reached with `months` subscribed, or null below the first. */
export function monthMark(months: number): MonthMark | null {
  let mark: MonthMark | null = null;
  for (const m of MONTH_MARKS) if (months >= m) mark = m;
  return mark;
}

/** Every earned item, unlocked or not, in the builder's order. */
export function earnedOffers(e: CitizenEntitlements): readonly EarnedOffer[] {
  const k = e.kingdom, origin = e.origin, offers: EarnedOffer[] = [];
  const lapsed = !!e.sub && !e.sub.active;
  const offer = (o: Omit<EarnedOffer, 'origin' | 'dim' | 'progress' | 'story'> & Partial<Pick<EarnedOffer, 'dim' | 'progress' | 'story'>>) =>
    offers.push({ dim: false, progress: null, story: null, origin, ...o });

  // Tenure: the month ribbons (sub months) and the hood (a year of following).
  const mark = e.sub ? monthMark(e.sub.months) : null;
  const next = MONTH_MARKS.find(m => m > (e.sub?.months ?? 0));
  offer({
    key: 'ribbons', name: 'Month ribbons', unlocked: !!mark, dim: lapsed && !!mark,
    earnedBy: `A ribbon is tied on at 1, 3, 6, 9, 12, 18, 24, 36, 48 and 60 months subscribed to ${k.name}.`,
    story: mark && e.sub ? `${plural(e.sub.months, 'month')} subscribed${lapsed ? ', the sub has lapsed' : ''}` : null,
    // Progress toward the next mark only means something to someone subscribed.
    progress: next && e.sub ? { have: e.sub.months, need: next, unit: 'months' } : null,
    piece: { family: 'ribbons', value: { months: mark ?? 3 } },
  });
  offer({
    key: 'hood', name: 'Tenure hood', unlocked: e.followedMonths >= HOOD_MONTHS,
    earnedBy: `A year following ${k.name}. Worn down on the shoulders, in the kingdom's colours.`,
    story: e.followedMonths >= HOOD_MONTHS ? `Following ${k.name} for ${plural(e.followedMonths, 'month')}` : null,
    progress: e.followedMonths < HOOD_MONTHS ? { have: e.followedMonths, need: HOOD_MONTHS, unit: 'months' } : null,
    piece: { family: 'hood', value: { cloth: k.colours[0], trim: k.colours[1] } },
  });

  // Pins: the founder's pin, every keepsake, every forged piece.
  offer({
    key: 'pin:founder', name: "Founder's pin", unlocked: e.founder,
    earnedBy: `Holding the founder badge in ${k.name}: among its first subscribers.`,
    story: e.founder ? `A founder of ${k.name}` : null,
    piece: { family: 'pin', value: { kind: 'founder', id: e.founder ? `founder.${k.id}` : PREVIEW } },
  });
  for (const keepsake of e.keepsakes) offer({
    key: `pin:keepsake:${keepsake.id}`, name: keepsake.name, unlocked: true,
    earnedBy: 'A passport keepsake, worn as a pin in its kingdom\'s crest.',
    story: `${keepsake.kingdom.name}, ${date(keepsake.earnedAt)}`,
    piece: { family: 'pin', value: { kind: 'keepsake', id: keepsake.id, shape: keepsake.kingdom.shape, colours: keepsake.kingdom.colours } },
  });
  if (!e.keepsakes.length) offer({
    key: 'pin:keepsake', name: 'Keepsake pin', unlocked: false,
    earnedBy: 'Be there for a moment (a raid ridden, a dragon woken, a founding). Its keepsake can be worn as a pin.',
    piece: { family: 'pin', value: { kind: 'keepsake', id: PREVIEW, shape: 'heater', colours: k.colours } },
  });
  for (const piece of e.forged) {
    offer({
      key: `pin:forged:${piece.id}`, name: `${piece.title} pin`, unlocked: true,
      earnedBy: 'A piece you forged, worn as a pin with its motif.',
      story: `Forged ${date(piece.forgedAt)}`,
      piece: { family: 'pin', value: { kind: 'forged', id: piece.id, motif: piece.motif, colours: piece.palette } },
    });
    offer({
      key: `forgedHat:${piece.id}`, name: `${piece.title} hat`, unlocked: true,
      earnedBy: 'A piece you forged, as a felt hat in its palette with its motif on the front.',
      story: `Forged ${date(piece.forgedAt)}`,
      piece: { family: 'forgedHat', value: { id: piece.id, motif: piece.motif, colours: piece.palette } },
    });
  }
  if (!e.forged.length) {
    const sample = { motif: 'crescent-moon' as const, colours: ['#2d5fd8', '#f6d23c'] as const };
    offer({
      key: 'pin:forged', name: 'Forged pin', unlocked: false,
      earnedBy: 'Forge a piece in the Forge while the stream is live. Its motif becomes a pin.',
      piece: { family: 'pin', value: { kind: 'forged', id: PREVIEW, ...sample } },
    });
    offer({
      key: 'forgedHat', name: 'Forged hat', unlocked: false,
      earnedBy: 'Forge a piece in the Forge while the stream is live. Wear a hat in its palette, its motif on the front.',
      piece: { family: 'forgedHat', value: { id: PREVIEW, ...sample } },
    });
  }

  // Moment drops: the raid scarf and the cheer cape.
  const raids = e.moments.filter(m => m.kind === 'raid'), storms = e.moments.filter(m => m.kind === 'cheer-storm');
  for (const raid of raids) offer({
    key: `scarf:${raid.id}`, name: `Raid scarf: ${raid.kingdom.name}`, unlocked: true,
    earnedBy: 'Everyone who rode the raid gets the same scarf, in both kingdoms\' colours.',
    story: `Rode the raid to ${raid.kingdom.name}, ${date(raid.at)}`,
    piece: { family: 'scarf', value: { id: raid.id, colours: [raid.from.colours[0], raid.kingdom.colours[0]] } },
  });
  if (!raids.length) offer({
    key: 'scarf', name: 'Raid scarf', unlocked: false,
    earnedBy: 'Ride a raid: be in the kingdom when it marches through the Raid Gate. Everyone who rides gets the same scarf.',
    piece: { family: 'scarf', value: { id: PREVIEW, colours: [k.colours[0], '#f3f1ee'] } },
  });
  for (const storm of storms) offer({
    key: `cape:cheer:${storm.id}`, name: 'Cheer cape', unlocked: true,
    earnedBy: 'Everyone there when a cheer storm broke over the kingdom gets the same cape; the cheerers get nothing more.',
    story: `${storm.kingdom.name}, ${date(storm.at)}`,
    piece: { family: 'cape', value: { kind: 'cheer', id: storm.id, cloth: storm.kingdom.colours[0], lining: storm.kingdom.colours[1], trim: '#e8b54a' } },
  });
  if (!storms.length) offer({
    key: 'cape:cheer', name: 'Cheer cape', unlocked: false,
    earnedBy: 'Be there when a cheer storm breaks over the kingdom. Everyone present gets the same cape; the cheerers get nothing more.',
    piece: { family: 'cape', value: { kind: 'cheer', id: PREVIEW, cloth: k.colours[0], lining: k.colours[1], trim: '#e8b54a' } },
  });

  // Sub pieces: shown on Twitch, they show something true, dim when the sub lapses and never vanish.
  const tier = e.sub ? (e.sub.tier === 'prime' ? 1 : Number(e.sub.tier)) : 0;
  offer({
    key: 'cape:tier-cloak', name: 'Tier cloak', unlocked: tier >= 2, dim: lapsed && tier >= 2,
    earnedBy: `A sub piece: a tier 2 or tier 3 sub to ${k.name} shows as a cloak in the tier's rose.`,
    story: tier >= 2 ? `Tier ${tier} sub to ${k.name}${lapsed ? ', lapsed' : ''}` : null,
    piece: { family: 'cape', value: { kind: 'tier-cloak', id: tier >= 2 ? `sub.${k.id}` : PREVIEW, cloth: '#c8506e', lining: '#f3d2da', trim: k.colours[0] } },
  });
  offer({
    key: 'cape:rainbow', name: 'Rainbow cape', unlocked: tier >= 3, dim: lapsed && tier >= 3,
    earnedBy: `A sub piece: a tier 3 sub to ${k.name} shows as the rainbow cape, shimmering through the colours.`,
    story: tier >= 3 ? `Tier 3 sub to ${k.name}${lapsed ? ', lapsed' : ''}` : null,
    piece: { family: 'cape', value: { kind: 'rainbow', id: tier >= 3 ? `sub.${k.id}` : PREVIEW, cloth: '#8a3fe6', lining: '#f3f1ee', trim: '#f6d23c' } },
  });
  return offers;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The pieces a look wears, one per family slot (pins one each). */
export function wornPieces(look: CitizenLook): readonly EarnedPiece[] {
  const e = look.earned, out: EarnedPiece[] = [];
  if (e.ribbons) out.push({ family: 'ribbons', value: e.ribbons });
  if (e.hood) out.push({ family: 'hood', value: e.hood });
  for (const pin of e.pins) out.push({ family: 'pin', value: pin });
  if (e.cape) out.push({ family: 'cape', value: e.cape });
  if (e.scarf) out.push({ family: 'scarf', value: e.scarf });
  if (e.forgedHat) out.push({ family: 'forgedHat', value: e.forgedHat });
  return out;
}

export function isWorn(look: CitizenLook, offer: EarnedOffer): boolean {
  return wornPieces(look).some(p => same(p, offer.piece));
}

/**
 * Puts an earned piece on. A forged hat takes the place of a hat and the raid scarf of neckwear; a third pin
 * replaces the older of two. Locked offers can be tried on in the builder (a preview), never saved.
 */
export function wearPiece(look: CitizenLook, piece: EarnedPiece): CitizenLook {
  const e = look.earned;
  switch (piece.family) {
    case 'ribbons': return { ...look, earned: { ...e, ribbons: piece.value } };
    case 'hood': return { ...look, earned: { ...e, hood: piece.value } };
    case 'pin': {
      const pins = [...e.pins.filter(p => p.id !== piece.value.id), piece.value];
      return { ...look, earned: { ...e, pins: pins.slice(-MAX_PINS) } };
    }
    case 'cape': return { ...look, earned: { ...e, cape: piece.value } };
    case 'scarf': return { ...look, neckwear: null, earned: { ...e, scarf: piece.value } };
    case 'forgedHat': return { ...look, hat: null, earned: { ...e, forgedHat: piece.value } };
  }
}

export function takeOffPiece(look: CitizenLook, piece: EarnedPiece): CitizenLook {
  const e = look.earned;
  switch (piece.family) {
    case 'ribbons': return { ...look, earned: { ...e, ribbons: null } };
    case 'hood': return { ...look, earned: { ...e, hood: null } };
    case 'pin': return { ...look, earned: { ...e, pins: e.pins.filter(p => !same(p, piece.value)) } };
    case 'cape': return { ...look, earned: { ...e, cape: null } };
    case 'scarf': return { ...look, earned: { ...e, scarf: null } };
    case 'forgedHat': return { ...look, earned: { ...e, forgedHat: null } };
  }
}

/**
 * What is wrong with the earned pieces a look wears, against one kingdom's verified records: every worn piece
 * must be exactly a piece an unlocked offer allows. Empty when the look may be saved as it is.
 */
export function checkEarned(look: CitizenLook, e: CitizenEntitlements): readonly string[] {
  const allowed = earnedOffers(e).filter(o => o.unlocked).map(o => o.piece);
  return wornPieces(look).filter(p => !allowed.some(a => same(a, p))).map(p => `Not earned: ${describe(p)}.`);
}

/** The look as it is worn in a kingdom: pieces its records do not support are left off (Bound sub and tenure pieces stay home). */
export function wornIn(look: CitizenLook, e: CitizenEntitlements): CitizenLook {
  const allowed = earnedOffers(e).filter(o => o.unlocked).map(o => o.piece);
  return wornPieces(look).filter(p => !allowed.some(a => same(a, p))).reduce(takeOffPiece, look);
}

/** Whether a kingdom's sub pieces are lapsed for this person: they render dimmed. */
export const subLapsed = (e: CitizenEntitlements): boolean => !!e.sub && !e.sub.active;

function describe(p: EarnedPiece): string {
  switch (p.family) {
    case 'ribbons': return `the ${p.value.months}-month ribbons`;
    case 'hood': return 'the tenure hood';
    case 'pin': return p.value.kind === 'founder' ? "the founder's pin" : `the ${p.value.kind} pin ${p.value.id}`;
    case 'cape': return `the ${p.value.kind} cape ${p.value.id}`;
    case 'scarf': return `the raid scarf ${p.value.id}`;
    case 'forgedHat': return `the forged hat ${p.value.id}`;
  }
}

/** Tenure garb a person wears by default: the ribbons, the hood and their sub cape, as their records allow. */
export function tenureGarb(look: CitizenLook, e: CitizenEntitlements): CitizenLook {
  let out = look;
  for (const o of earnedOffers(e)) {
    if (!o.unlocked) continue;
    const garb = o.piece.family === 'ribbons' || o.piece.family === 'hood'
      || (o.piece.family === 'cape' && o.piece.value.kind !== 'cheer' && !(o.key === 'cape:tier-cloak' && (e.sub?.tier === '3')));
    if (garb) out = wearPiece(out, o.piece);
  }
  return out;
}
