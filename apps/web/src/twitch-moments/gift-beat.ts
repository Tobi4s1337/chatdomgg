import { CART_BEAT, GIFT_LIMITS, PARCEL_BEAT } from './choreography';
import type { Credit, MomentBodyOf } from './contracts';

/**
 * Pure planning for one gift group's beat: where each disclosed parcel goes, when it launches and what the cart
 * still carries. A parcel goes only where its public notice put it: a named citizen's home, the gate for a named
 * person with no home yet, or nowhere (it rides in the cart) for an anonymous or undisclosed recipient.
 */

export type GiftTier = MomentBodyOf<'gifts'>['tier'];
/** The giver's wax seal: a named giver, "a friend of the realm", or a gift paid forward. */
export type GiftSeal = 'named' | 'friend' | 'forward';
export type GiftDestination = { readonly kind: 'home'; readonly slot: number } | { readonly kind: 'gate' };

export const FRIEND = 'A friend of the realm';

export interface PlannedParcel {
  /** The public notice key: one parcel per notice, ever. */
  readonly key: string;
  readonly to: GiftDestination;
  /** Recipient's public name for an intimate landing caption; null keeps the landing unnamed. */
  readonly name: string | null;
  /** Absolute kingdom time of launch, or null when it settles quietly at the end of the beat (capital overflow). */
  readonly launchAt: number | null;
  readonly fromSky: boolean;
  readonly flight: number;
  /** When the parcel rests on its doorstep: landing plus the canopy lifting away, or the cart's departure. */
  readonly restFrom: number;
}

export interface GiftBeat {
  readonly kind: 'gift';
  readonly id: string;
  readonly groupKey: string;
  readonly startAt: number;
  /** A lone parcel sinking from the sky, or a cart that brings a group and hands its load out in waves. */
  readonly mode: 'single' | 'cart';
  readonly tier: GiftTier;
  readonly seal: GiftSeal;
  readonly giver: string;
  readonly forwardedFrom: string | null;
  readonly total: number;
  readonly parcels: readonly PlannedParcel[];
  /** Parcels the cart carries on: anonymous and undisclosed recipients. Never located. */
  readonly riding: number;
  readonly departAt: number;
  readonly endAt: number;
  readonly intimate: boolean;
}

export const giftSeal = (body: MomentBodyOf<'gifts'>): GiftSeal => body.forwardedFrom ? 'forward' : body.giver ? 'named' : 'friend';

export function destinationOf(credit: Credit): GiftDestination | null {
  if (!credit) return null;
  return credit.slot === null ? { kind: 'gate' } : { kind: 'home', slot: credit.slot };
}

const LONGEST_BEAT_MS = 40_000;

/** The beat's end once its last parcel has landed and the cart has rolled on. */
function closing(startAt: number, mode: GiftBeat['mode'], parcels: readonly PlannedParcel[]): { departAt: number; endAt: number } {
  const landings = parcels.filter(p => p.launchAt !== null).map(p => p.restFrom);
  if (mode === 'single') {
    const end = Math.max(startAt, ...landings) + 2600;
    return { departAt: end, endAt: end };
  }
  const departAt = Math.min(startAt + LONGEST_BEAT_MS - CART_BEAT.depart, Math.max(startAt + CART_BEAT.arrive + 1800, ...landings.map(l => l - PARCEL_BEAT.canopyAway + CART_BEAT.departAfterLast)));
  return { departAt, endAt: departAt + CART_BEAT.depart };
}

const lead = (fromSky: boolean) => fromSky ? PARCEL_BEAT.bloom : PARCEL_BEAT.lift;

/**
 * Plan a fresh beat from the group's current public state. `name` trims a public name for a caption. Located
 * parcels go out in waves of six in slot order (homes along a street share nearby slots), at most 48 flights;
 * any more settle quietly as the cart leaves, so a capital never rains a hundred canopies.
 */
export function planGiftBeat(id: string, body: MomentBodyOf<'gifts'>, startAt: number, name: (n: string) => string): GiftBeat {
  const located = body.recipients.flatMap(r => { const to = destinationOf(r.credit); return to ? [{ key: r.noticeKey, to, name: r.credit!.displayName }] : []; });
  const mode: GiftBeat['mode'] = body.total === 1 && located.length === 1 ? 'single' : 'cart';
  const ordered = [...located].sort((a, b) => order(a.to) - order(b.to));
  const parcels = mode === 'single'
    ? [skyParcel(ordered[0]!, startAt, name)]
    : ordered.map((p, i) => cartParcel(p, startAt, i, name));
  const intimate = located.length <= GIFT_LIMITS.intimate;
  const { departAt, endAt } = closing(startAt, mode, parcels);
  const quietAt = (p: PlannedParcel) => p.launchAt === null ? { ...p, restFrom: departAt } : p;
  return {
    kind: 'gift', id, groupKey: body.groupKey, startAt, mode, tier: body.tier, seal: giftSeal(body),
    giver: body.giver ? name(body.giver.displayName) : FRIEND, forwardedFrom: body.forwardedFrom ? name(body.forwardedFrom.displayName) : null,
    total: body.total, parcels: parcels.map(quietAt), riding: Math.max(0, body.total - located.length), departAt, endAt, intimate,
  };
}

const order = (to: GiftDestination) => to.kind === 'gate' ? -1 : to.slot;

function skyParcel(p: { key: string; to: GiftDestination; name: string }, startAt: number, name: (n: string) => string): PlannedParcel {
  const launchAt = startAt, flight = PARCEL_BEAT.skyFlight;
  return { key: p.key, to: p.to, name: name(p.name), launchAt, fromSky: true, flight, restFrom: launchAt + lead(true) + flight + PARCEL_BEAT.canopyAway };
}

function cartParcel(p: { key: string; to: GiftDestination; name: string }, startAt: number, index: number, name: (n: string) => string): PlannedParcel {
  const wave = Math.floor(index / GIFT_LIMITS.wave);
  if (index >= GIFT_LIMITS.flights) return { key: p.key, to: p.to, name: null, launchAt: null, fromSky: false, flight: 0, restFrom: Infinity };
  // Within a wave the parcels lift a breath apart, so the bed empties in a ripple rather than all at once.
  const launchAt = startAt + CART_BEAT.firstWave + wave * CART_BEAT.waveGap + (index % GIFT_LIMITS.wave) * 170;
  const flight = PARCEL_BEAT.cartFlight;
  return { key: p.key, to: p.to, name: name(p.name), launchAt, fromSky: false, flight, restFrom: launchAt + lead(false) + flight + PARCEL_BEAT.canopyAway };
}

/**
 * Fold a later public update for the same group into its live beat. Parcels already planned keep their times;
 * new disclosed recipients join the next wave if the cart has not yet left, otherwise they settle quietly. A
 * single parcel that turns out to be part of a group keeps its sky descent; the newcomers sink from the sky too.
 */
export function extendGiftBeat(beat: GiftBeat, body: MomentBodyOf<'gifts'>, now: number, name: (n: string) => string): GiftBeat {
  const known = new Set(beat.parcels.map(p => p.key));
  const fresh = body.recipients.flatMap(r => { const to = destinationOf(r.credit); return to && !known.has(r.noticeKey) ? [{ key: r.noticeKey, to, name: r.credit!.displayName }] : []; });
  const located = beat.parcels.length + fresh.length;
  const base = { ...beat, total: Math.max(beat.total, body.total), seal: giftSeal(body),
    forwardedFrom: body.forwardedFrom ? name(body.forwardedFrom.displayName) : beat.forwardedFrom, riding: Math.max(0, Math.max(beat.total, body.total) - located) };
  if (fresh.length === 0) return base;
  const leaving = now >= beat.departAt - 1000;
  const flown = beat.parcels.filter(p => p.launchAt !== null).length;
  const next = Math.max(now + 400, ...beat.parcels.map(p => (p.launchAt ?? 0) + CART_BEAT.waveGap));
  const added = fresh.map((p, i): PlannedParcel => {
    if (leaving || flown + i >= GIFT_LIMITS.flights) return { key: p.key, to: p.to, name: null, launchAt: null, fromSky: false, flight: 0, restFrom: Infinity };
    const fromSky = beat.mode === 'single', launchAt = next + Math.floor(i / GIFT_LIMITS.wave) * CART_BEAT.waveGap + (i % GIFT_LIMITS.wave) * 170;
    const flight = fromSky ? PARCEL_BEAT.skyFlight : PARCEL_BEAT.cartFlight;
    return { key: p.key, to: p.to, name: name(p.name), launchAt, fromSky, flight, restFrom: launchAt + lead(fromSky) + flight + PARCEL_BEAT.canopyAway };
  });
  const parcels = [...beat.parcels, ...added];
  const timing = leaving ? { departAt: beat.departAt, endAt: beat.endAt } : closing(beat.startAt, beat.mode, parcels);
  // Quiet parcels settle as the cart leaves; one that arrives after it left settles now.
  const quiet = Math.max(leaving ? now : 0, timing.departAt);
  return { ...base, parcels: parcels.map(p => p.launchAt === null && p.restFrom > now ? { ...p, restFrom: quiet } : p), ...timing,
    intimate: beat.intimate && parcels.length <= GIFT_LIMITS.intimate };
}

/** Parcels still riding at `atMs`: the anonymous load plus located parcels not yet lifted off, bounded for display. */
export function cartLoad(beat: GiftBeat, atMs: number): number {
  const waiting = beat.parcels.filter(p => p.launchAt !== null ? atMs < p.launchAt : atMs < beat.departAt).length;
  return Math.min(GIFT_LIMITS.cartLoad, beat.riding + waiting);
}

/** The honest collective line: up to three names, then "and N others"; anonymous and undisclosed are never named. */
export function recipientLine(beat: GiftBeat, names: readonly string[]): string {
  const shown = names.slice(0, GIFT_LIMITS.names), rest = beat.total - shown.length;
  if (shown.length === 0) return beat.total === 1 ? 'for a friend of the realm' : `for ${beat.total} friends of the realm`;
  const list = shown.length === 1 ? shown[0]! : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
  return rest > 0 ? `for ${shown.join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}` : `for ${list}`;
}
