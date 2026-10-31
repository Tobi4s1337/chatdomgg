/**
 * The visitor gift and the destination welcome (spec 23 R9, RG10). A gift is a person-to-person transfer of a thing the
 * item authority already holds: offered by its owner, accepted or refused by the one person it was offered to, and moved
 * once, inside one item transaction, with its maker, home kingdom and giver kept in the lineage.
 *
 * - Only around a real arrival: the visitor must still stand where the destination acknowledged them, as a visitor.
 *   A visitor gives to a host of that kingdom (its monarch or a citizen with a deed); a host gives to that visitor.
 * - Only things that may be given: made, crafted, found things and the authority's welcome offerings, transferable,
 *   never paid for, of this gate's origin. Light, homes, lots, money, rank, tenure, sub pieces, Bits products,
 *   keepsakes and companions stay bound, and the item authority's own `transferable` flag is never overridden.
 * - An offer moves nothing. The owner keeps the thing until the recipient accepts; one open offer per thing.
 * - Accepting is one transaction: the offer, the conditional ownership update (owner and revision as offered) and the
 *   transfer lineage are written together or not at all. A retried accept finds the accepted offer and answers with
 *   the same receipt, so a lost answer, a double press or a restart can neither give the thing twice nor lose it. If
 *   the thing changed hands or revision since the offer, the offer is `rejected` and nothing moves.
 * - No prices, currency, rank or rewards. Refusing is always fine and costs nothing.
 */
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import {
  GATE_LIMITS, GIFT_KINDS, displayText, readGiftStory,
  type GateCommand, type GateContext, type GateReply, type GiftKind, type GiftStory, type GiftableView, type GuestView, type TravelReason,
  type VisitorGiftView, type WelcomeView,
} from './contracts';
import { bool, complete, epoch, fields, kingdom, oneOf, person, positive, token } from './guard';
import type { RecordOrigin, Stored } from './repository';

// ---- Items, as the item authority holds them ---------------------------------------------------------------------

/** Kinds that never change hands as a gift (spec 23 R9). */
export const BOUND_KINDS = ['light', 'home', 'lot', 'money', 'rank', 'tenure', 'sub-piece', 'bits-product', 'keepsake', 'companion'] as const;
export type ItemKind = GiftKind | typeof BOUND_KINDS[number];

/**
 * One thing in the item authority's store, read inside the transfer transaction. `transferable` is the authority's own
 * verdict; `paid` marks anything bought with money or Bits. Maker and origin are the thing's provenance, not the giver.
 */
export type GiftItem = Readonly<{
  itemId: string; revision: number; ownerId: PersonId; kind: ItemKind; title: string;
  makerId: PersonId; makerName: string | null; originKingdomId: KingdomId; originName: string | null;
  transferable: boolean; paid: boolean; origin: RecordOrigin;
}>;

// ---- Records this lane owns ---------------------------------------------------------------------------------------

export type GiftRecordState = Exclude<VisitorGiftView['state'], 'unknown'>;
/** Why an offer could not be honoured at acceptance. */
export type GiftRejection = 'moved' | 'bound';

/** One offer. Unique on (giver, requestId); at most one `offered` record per item. */
export type VisitorGiftRecord = Readonly<{
  offerId: string;
  revision: number;
  /** The giver's idempotency key. */
  requestId: string;
  giverId: PersonId;
  recipientId: PersonId;
  /** The arrival this gift belongs to, its visitor and the two kingdoms of that visit. */
  arrivalId: string;
  visitorId: PersonId;
  kingdomId: KingdomId;
  homeKingdomId: KingdomId;
  direction: 'left' | 'brought-back';
  itemId: string;
  /** The item revision the owner offered. Acceptance moves exactly this revision, or nothing. */
  itemRevision: number;
  makerId: PersonId;
  originKingdomId: KingdomId;
  story: GiftStory;
  giverName: string | null;
  recipientName: string | null;
  state: GiftRecordState;
  offeredAt: number;
  expiresAt: number;
  settledAt: number | null;
  /** The transfer this offer became; equal to `offerId`. Accepted only. */
  transferId: string | null;
  rejection: GiftRejection | null;
  origin: RecordOrigin;
}>;

/** The append-only lineage entry of one ownership transfer. Its ID is the offer's, so one offer moves a thing once. */
export type ItemTransferRecord = Readonly<{
  transferId: string;
  revision: 1;
  itemId: string;
  fromRevision: number;
  toRevision: number;
  from: PersonId;
  to: PersonId;
  offerId: string;
  arrivalId: string;
  /** Where it was given, and the visitor's home. */
  kingdomId: KingdomId;
  homeKingdomId: KingdomId;
  makerId: PersonId;
  originKingdomId: KingdomId;
  at: number;
  origin: RecordOrigin;
}>;

/**
 * Main's item authority as one transaction (spec 23 "Contracts"): the actual item reads, the conditional ownership
 * update, the transfer-lineage append and the gift records, all serializable and atomic. A thrown function keeps none
 * of its writes. Every `put` is a compare-and-set on `revision` (0 creates), as in `repository.ts`.
 */
export interface ItemTransferTransaction {
  getItem(itemId: string): Promise<GiftItem | null>;
  /**
   * Moves the item from `from` to `to` only if it is still owned by `from` at `expectedRevision`; the stored item is
   * then at `expectedRevision + 1`. Anything else is a conflict that changes nothing.
   */
  moveItem(itemId: string, from: PersonId, to: PersonId, expectedRevision: number): Promise<Stored<GiftItem>>;
  /** Things this person owns now, most recently received first. At most `limit` (1–50). */
  listOwned(ownerId: PersonId, limit: number): Promise<GiftItem[]>;
  getOffer(offerId: string): Promise<VisitorGiftRecord | null>;
  findOffer(giverId: PersonId, requestId: string): Promise<VisitorGiftRecord | null>;
  /** The item's one `offered` record, if any (whatever its expiry). */
  findOpenOffer(itemId: string): Promise<VisitorGiftRecord | null>;
  /** Offers around one arrival, newest first. At most `limit` (1–50). */
  listArrivalOffers(arrivalId: string, limit: number): Promise<VisitorGiftRecord[]>;
  /** Offers this person gave or was offered in this kingdom, newest first. At most `limit` (1–50). */
  listPersonOffers(personId: PersonId, kingdomId: KingdomId, limit: number): Promise<VisitorGiftRecord[]>;
  putOffer(record: VisitorGiftRecord, expectedRevision: number): Promise<Stored<VisitorGiftRecord>>;
  getTransfer(transferId: string): Promise<ItemTransferRecord | null>;
  /** Appends a lineage entry; a second entry under the same ID is a conflict. */
  appendTransfer(record: ItemTransferRecord): Promise<Stored<ItemTransferRecord>>;
}

export interface ItemTransferRepository {
  readonly origin: RecordOrigin;
  /** Serializable and atomic. Rejects with the signal's reason if aborted before commit. */
  transaction<T>(work: (tx: ItemTransferTransaction) => Promise<T>, signal: AbortSignal): Promise<T>;
}

export const GIFT_LIST_LIMIT = 50;

// ---- Other ports ----------------------------------------------------------------------------------------------------

/**
 * A destination's acknowledged arrival, read from the realm travel records (`apps/realm/src/raid-gate/arrivals.ts`).
 * `present` is true while the person still stands there on this arrival, with no journey fenced.
 */
export type ArrivalWitness = Readonly<{
  arrivalId: string; personId: PersonId; from: KingdomId; to: KingdomId; role: 'monarch' | 'citizen' | 'visitor';
  reason: TravelReason; committedAt: number; present: boolean; origin: RecordOrigin;
}>;
export interface GiftArrivals {
  readonly origin: RecordOrigin;
  read(arrivalId: string, signal: AbortSignal): Promise<ArrivalWitness | null>;
  /** People who arrived through a gate and still stand in `kingdomId`, most recent first. At most `limit` (1–100). */
  present(kingdomId: KingdomId, limit: number, signal: AbortSignal): Promise<ArrivalWitness[]>;
}

/** Who belongs to a kingdom (its broadcaster, or a deed holder) and approved public names. */
export interface GiftHosts {
  readonly origin: RecordOrigin;
  standing(personId: PersonId, kingdomId: KingdomId, signal: AbortSignal): Promise<'monarch' | 'citizen' | 'none'>;
  /** Approved public names; a person without one is absent and shown anonymously. */
  names(personIds: readonly PersonId[], signal: AbortSignal): Promise<ReadonlyMap<PersonId, string>>;
}

export type VisitorGiftDeps = Readonly<{
  items: ItemTransferRepository;
  arrivals: GiftArrivals;
  hosts: GiftHosts;
  origin: RecordOrigin;
  /** Fresh opaque offer IDs; defaults to `crypto.randomUUID`. */
  ids?: () => string;
}>;

// ---- Readers --------------------------------------------------------------------------------------------------------

const ITEM_KINDS = [...GIFT_KINDS, ...BOUND_KINDS] as const;
const ORIGINS = ['live', 'simulated'] as const;
const nullable = <T>(value: unknown, read: (value: unknown) => T | undefined): T | null | undefined => value === null ? null : read(value);

export function readGiftItem(value: unknown): GiftItem | undefined {
  const f = fields(value, ['itemId', 'revision', 'ownerId', 'kind', 'title', 'makerId', 'makerName', 'originKingdomId', 'originName', 'transferable', 'paid', 'origin']);
  if (!f) return undefined;
  const makerName = nullable(f.makerName, displayText), originName = nullable(f.originName, displayText);
  const item = {
    itemId: token(f.itemId), revision: positive(f.revision), ownerId: person(f.ownerId), kind: oneOf(f.kind, ITEM_KINDS), title: displayText(f.title),
    makerId: person(f.makerId), originKingdomId: kingdom(f.originKingdomId), transferable: bool(f.transferable), paid: bool(f.paid), origin: oneOf(f.origin, ORIGINS),
  };
  return complete(item) && makerName !== undefined && originName !== undefined ? { ...item, makerName, originName } : undefined;
}

const OFFER_STATES = ['offered', 'accepted', 'refused', 'expired', 'rejected'] as const;

export function readGiftRecord(value: unknown): VisitorGiftRecord | undefined {
  const f = fields(value, ['offerId', 'revision', 'requestId', 'giverId', 'recipientId', 'arrivalId', 'visitorId', 'kingdomId', 'homeKingdomId', 'direction',
    'itemId', 'itemRevision', 'makerId', 'originKingdomId', 'story', 'giverName', 'recipientName', 'state', 'offeredAt', 'expiresAt', 'settledAt',
    'transferId', 'rejection', 'origin']);
  if (!f) return undefined;
  const giverName = nullable(f.giverName, displayText), recipientName = nullable(f.recipientName, displayText);
  const settledAt = nullable(f.settledAt, epoch), transferId = nullable(f.transferId, token), rejection = nullable(f.rejection, value => oneOf(value, ['moved', 'bound'] as const));
  const record = {
    offerId: token(f.offerId), revision: positive(f.revision), requestId: token(f.requestId), giverId: person(f.giverId), recipientId: person(f.recipientId),
    arrivalId: token(f.arrivalId), visitorId: person(f.visitorId), kingdomId: kingdom(f.kingdomId), homeKingdomId: kingdom(f.homeKingdomId),
    direction: oneOf(f.direction, ['left', 'brought-back'] as const), itemId: token(f.itemId), itemRevision: positive(f.itemRevision), makerId: person(f.makerId),
    originKingdomId: kingdom(f.originKingdomId), story: readGiftStory(f.story), state: oneOf(f.state, OFFER_STATES), offeredAt: epoch(f.offeredAt),
    expiresAt: positive(f.expiresAt), origin: oneOf(f.origin, ORIGINS),
  };
  if (!complete(record) || giverName === undefined || recipientName === undefined || settledAt === undefined || transferId === undefined || rejection === undefined) return undefined;
  if (record.giverId === record.recipientId || record.kingdomId === record.homeKingdomId || record.expiresAt <= record.offeredAt) return undefined;
  // The visitor is the giver of a gift they left, and the recipient of one they bring back.
  if ((record.direction === 'left' ? record.giverId : record.recipientId) !== record.visitorId) return undefined;
  if ((record.state === 'offered') !== (settledAt === null)) return undefined;
  if ((record.state === 'accepted') !== (transferId !== null) || (transferId !== null && transferId !== record.offerId)) return undefined;
  if ((record.state === 'rejected') !== (rejection !== null)) return undefined;
  return { ...record, giverName, recipientName, settledAt, transferId, rejection };
}

export function readTransferRecord(value: unknown): ItemTransferRecord | undefined {
  const f = fields(value, ['transferId', 'revision', 'itemId', 'fromRevision', 'toRevision', 'from', 'to', 'offerId', 'arrivalId', 'kingdomId', 'homeKingdomId',
    'makerId', 'originKingdomId', 'at', 'origin']);
  if (!f) return undefined;
  const record = {
    transferId: token(f.transferId), itemId: token(f.itemId), fromRevision: positive(f.fromRevision), toRevision: positive(f.toRevision),
    from: person(f.from), to: person(f.to), offerId: token(f.offerId), arrivalId: token(f.arrivalId), kingdomId: kingdom(f.kingdomId),
    homeKingdomId: kingdom(f.homeKingdomId), makerId: person(f.makerId), originKingdomId: kingdom(f.originKingdomId), at: epoch(f.at), origin: oneOf(f.origin, ORIGINS),
  };
  if (!complete(record) || f.revision !== 1 || record.from === record.to || record.transferId !== record.offerId) return undefined;
  return record.toRevision === record.fromRevision + 1 ? { ...record, revision: 1 } : undefined;
}

// ---- The application ------------------------------------------------------------------------------------------------

export type GiftCommand = Extract<GateCommand, { op: 'welcome' | 'offer-gift' | 'accept-gift' | 'refuse-gift' }>;

export interface VisitorGiftApplication {
  readonly origin: RecordOrigin;
  /** A gift command for a viewer whose session the gate application has already found current. */
  handle(context: GateContext, command: GiftCommand): Promise<GateReply>;
}

const HOSTS: ReadonlySet<string> = new Set(['monarch', 'citizen']);
const ATTEMPTS = 3;

class Refused extends Error {
  constructor(readonly code: Extract<GateReply, { kind: 'denied' }>['code']) { super(code); }
}
class Conflict extends Error {}

function stored<T>(result: Stored<T>): T {
  if (result.kind === 'conflict') throw new Conflict();
  return result.record;
}

/** May this thing be given at all? The item authority's own verdict, plus the kinds that always stay bound. */
export function giftable(item: GiftItem, origin: RecordOrigin): item is GiftItem & { kind: GiftKind } {
  return (GIFT_KINDS as readonly string[]).includes(item.kind) && item.transferable && !item.paid && item.origin === origin;
}

const storyOf = (item: GiftItem & { kind: GiftKind }): GiftStory =>
  ({ title: item.title, kind: item.kind, makerName: item.makerName, originName: item.originName });

/** What two people see of an offer. An offer past its window reads as expired before anyone writes it down. */
export function giftView(record: VisitorGiftRecord, now: number): VisitorGiftView {
  const state = record.state === 'offered' && now >= record.expiresAt ? 'expired' : record.state;
  return {
    offerId: record.offerId, itemId: record.itemId, from: record.giverId, to: record.recipientId, originKingdomId: record.originKingdomId,
    makerId: record.makerId, revision: record.revision, state, kingdomId: record.kingdomId, direction: record.direction, story: record.story,
    fromName: record.giverName, toName: record.recipientName, expiresAt: record.expiresAt,
    receipt: record.state === 'accepted' && record.transferId !== null && record.settledAt !== null ? { transferId: record.transferId, at: record.settledAt } : null,
  };
}

export function createVisitorGifts(deps: VisitorGiftDeps): VisitorGiftApplication {
  const { items, arrivals, hosts, origin } = deps;
  const ids = deps.ids ?? (() => crypto.randomUUID());
  for (const [name, port] of [['item authority', items], ['arrival witness', arrivals], ['host directory', hosts]] as const) {
    if (port.origin !== origin) throw new Error(`The visitor gifts are ${origin}, but their ${name} is ${port.origin}.`);
  }

  async function transact<T>(work: (tx: ItemTransferTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await items.transaction(work, signal);
      } catch (error) {
        if (!(error instanceof Conflict)) throw error;
        if (attempt >= ATTEMPTS) throw new Refused('stale');
      }
    }
  }

  const isHost = async (personId: PersonId, kingdomId: KingdomId, signal: AbortSignal) => HOSTS.has(await hosts.standing(personId, kingdomId, signal));

  async function nameOf(personIds: readonly PersonId[], signal: AbortSignal): Promise<ReadonlyMap<PersonId, string>> {
    const asked = [...new Set(personIds)];
    const found = asked.length ? await hosts.names(asked, signal) : new Map<PersonId, string>();
    // Only names that read cleanly are shown; anything else is anonymous.
    return new Map([...found].filter(([id, name]) => asked.includes(id) && displayText(name) !== undefined));
  }

  /** Writes an offer whose window has passed down as expired, so its item may be offered again. */
  async function settleExpired(tx: ItemTransferTransaction, record: VisitorGiftRecord, now: number): Promise<VisitorGiftRecord> {
    if (record.state !== 'offered' || now < record.expiresAt) return record;
    return stored(await tx.putOffer({ ...record, state: 'expired', settledAt: Math.max(now, record.offeredAt), revision: record.revision + 1 }, record.revision));
  }

  async function offer(context: GateContext, command: Extract<GiftCommand, { op: 'offer-gift' }>): Promise<GateReply> {
    const { principal, now, signal } = context;
    const giver = principal.personId;
    const arrival = await arrivals.read(command.arrivalId, signal);
    if (!arrival || arrival.origin !== origin) return { kind: 'denied', code: 'stale' };
    // Gifts welcome visitors; someone coming home or to their own door is not a guest.
    if (arrival.role !== 'visitor') return { kind: 'denied', code: 'unauthorized' };
    let direction: VisitorGiftRecord['direction'];
    if (giver === arrival.personId) {
      if (command.recipient === giver || !await isHost(command.recipient, arrival.to, signal)) return { kind: 'denied', code: 'unauthorized' };
      direction = 'left';
    } else {
      // A host of the visited kingdom, signed in there, gives to the visitor themselves.
      if (principal.sourceKingdomId !== arrival.to || !HOSTS.has(principal.sourceRole) || command.recipient !== arrival.personId) return { kind: 'denied', code: 'unauthorized' };
      if (!await isHost(giver, arrival.to, signal)) return { kind: 'denied', code: 'unauthorized' };
      direction = 'brought-back';
    }
    const names = await nameOf([giver, command.recipient], signal);
    return transact(async tx => {
      const again = await tx.findOffer(giver, command.requestId);
      if (again) {
        // The same press arriving twice answers with the offer it made; a different gift under the same key is refused.
        const same = again.itemId === command.itemId && again.recipientId === command.recipient && again.arrivalId === command.arrivalId;
        return same ? { kind: 'gift', value: giftView(again, now) } : { kind: 'denied', code: 'invalid' };
      }
      // Only while the visitor still stands here on this arrival.
      if (!arrival.present) return { kind: 'denied', code: 'stale' };
      const item = await tx.getItem(command.itemId);
      if (!item || item.ownerId !== giver) return { kind: 'denied', code: 'stale' };
      if (!giftable(item, origin)) return { kind: 'denied', code: 'unauthorized' };
      const open = await tx.findOpenOffer(item.itemId);
      if (open && (await settleExpired(tx, open, now)).state === 'offered') return { kind: 'denied', code: 'stale' };
      const around = await tx.listArrivalOffers(arrival.arrivalId, GIFT_LIST_LIMIT);
      if (around.filter(each => each.state === 'offered' && now < each.expiresAt).length >= GATE_LIMITS.giftsOpenPerArrival) return { kind: 'denied', code: 'full' };
      const record: VisitorGiftRecord = {
        offerId: ids(), revision: 1, requestId: command.requestId, giverId: giver, recipientId: command.recipient, arrivalId: arrival.arrivalId,
        visitorId: arrival.personId, kingdomId: arrival.to, homeKingdomId: arrival.from, direction, itemId: item.itemId, itemRevision: item.revision,
        makerId: item.makerId, originKingdomId: item.originKingdomId, story: storyOf(item), giverName: names.get(giver) ?? null,
        recipientName: names.get(command.recipient) ?? null, state: 'offered', offeredAt: now, expiresAt: now + GATE_LIMITS.giftOfferMs, settledAt: null,
        transferId: null, rejection: null, origin,
      };
      return { kind: 'gift', value: giftView(stored(await tx.putOffer(record, 0)), now) };
    }, signal);
  }

  /** The recipient's answer. Accepting moves the thing once; a repeat answers with what already happened. */
  async function answer(context: GateContext, offerId: string, accept: boolean): Promise<GateReply> {
    const { principal, now, signal } = context;
    return transact(async tx => {
      const found = await tx.getOffer(offerId);
      if (!found) return { kind: 'denied', code: 'stale' };
      if (found.recipientId !== principal.personId) return { kind: 'denied', code: 'unauthorized' };
      const record = await settleExpired(tx, found, now);
      // Already answered (or expired): the same answer again, never a second transfer.
      if (record.state !== 'offered') return { kind: 'gift', value: giftView(record, now) };
      const settle = (change: Partial<VisitorGiftRecord>) => tx.putOffer({ ...record, ...change, settledAt: now, revision: record.revision + 1 }, record.revision).then(stored);
      if (!accept) return { kind: 'gift', value: giftView(await settle({ state: 'refused' }), now) };
      const item = await tx.getItem(record.itemId);
      // The thing changed hands or changed since it was offered: the offer cannot be honoured, and nothing moves.
      if (!item || item.ownerId !== record.giverId || item.revision !== record.itemRevision) {
        return { kind: 'gift', value: giftView(await settle({ state: 'rejected', rejection: 'moved' }), now) };
      }
      if (!giftable(item, origin)) return { kind: 'gift', value: giftView(await settle({ state: 'rejected', rejection: 'bound' }), now) };
      const moved = stored(await tx.moveItem(item.itemId, record.giverId, record.recipientId, item.revision));
      if (moved.ownerId !== record.recipientId || moved.revision !== item.revision + 1) throw new Error('The item authority moved the wrong thing.');
      stored(await tx.appendTransfer({
        transferId: record.offerId, revision: 1, itemId: item.itemId, fromRevision: item.revision, toRevision: moved.revision, from: record.giverId,
        to: record.recipientId, offerId: record.offerId, arrivalId: record.arrivalId, kingdomId: record.kingdomId, homeKingdomId: record.homeKingdomId,
        makerId: item.makerId, originKingdomId: item.originKingdomId, at: now, origin,
      }));
      return { kind: 'gift', value: giftView(await settle({ state: 'accepted', transferId: record.offerId }), now) };
    }, signal);
  }

  const shelfOf = async (tx: ItemTransferTransaction, personId: PersonId): Promise<GiftableView[]> =>
    (await tx.listOwned(personId, GIFT_LIST_LIMIT)).filter(item => giftable(item, origin)).slice(0, GATE_LIMITS.giftShelf)
      .map(item => ({ itemId: item.itemId, revision: item.revision, story: storyOf(item as GiftItem & { kind: GiftKind }) }));

  async function welcome(context: GateContext, arrivalId: string | null): Promise<GateReply> {
    const { principal, now, signal } = context;
    const me = principal.personId;
    if (arrivalId !== null) {
      const arrival = await arrivals.read(arrivalId, signal);
      if (!arrival || arrival.origin !== origin) return { kind: 'denied', code: 'stale' };
      if (arrival.personId !== me) return { kind: 'denied', code: 'unauthorized' };
      if (arrival.role !== 'visitor') return { kind: 'denied', code: 'unauthorized' };
      const raidId = arrival.reason.kind === 'raid' ? arrival.reason.raidId : null;
      // How many of the same witnessed raid stand here too: a count, never a roster.
      const party = raidId === null ? 0 : (await arrivals.present(arrival.to, 100, signal))
        .filter(each => each.personId !== me && each.reason.kind === 'raid' && each.reason.raidId === raidId).length;
      const monarchId = arrival.to as unknown as PersonId;
      const names = await nameOf([monarchId], signal);
      const { offers, shelf } = await transact(async tx => ({
        offers: await tx.listArrivalOffers(arrival.arrivalId, GATE_LIMITS.giftsListed),
        shelf: arrival.present ? await shelfOf(tx, me) : [],
      }), signal);
      const value: WelcomeView = {
        kingdomId: arrival.to, viewer: 'visitor',
        arrival: { arrivalId: arrival.arrivalId, from: arrival.from, arrivedAt: arrival.committedAt, present: arrival.present, raidId },
        party, monarch: { personId: monarchId, name: names.get(monarchId) ?? null }, guests: [], offers: offers.map(record => giftView(record, now)), shelf,
      };
      return { kind: 'welcome', value };
    }
    // A host's welcome: the kingdom they are signed in to, and only if they belong to it.
    const kingdomId = principal.sourceKingdomId;
    if (!HOSTS.has(principal.sourceRole) || !await isHost(me, kingdomId, signal)) return { kind: 'denied', code: 'unauthorized' };
    const present = (await arrivals.present(kingdomId, 100, signal))
      .filter(each => each.origin === origin && each.present && each.role === 'visitor' && each.to === kingdomId && each.from !== kingdomId && each.personId !== me)
      .slice(0, GATE_LIMITS.guestsListed);
    const monarchId = kingdomId as unknown as PersonId;
    const names = await nameOf([monarchId, ...present.map(each => each.personId)], signal);
    const guests: GuestView[] = present.map(each => ({
      arrivalId: each.arrivalId, personId: each.personId, name: names.get(each.personId) ?? null, from: each.from, arrivedAt: each.committedAt,
      kind: each.reason.kind === 'raid' ? 'raid' : 'visit',
    }));
    const { offers, shelf } = await transact(async tx => ({
      offers: await tx.listPersonOffers(me, kingdomId, GATE_LIMITS.giftsListed),
      shelf: guests.length > 0 ? await shelfOf(tx, me) : [],
    }), signal);
    const value: WelcomeView = {
      kingdomId, viewer: 'host', arrival: null, party: 0, monarch: { personId: monarchId, name: names.get(monarchId) ?? null }, guests,
      offers: offers.map(record => giftView(record, now)), shelf,
    };
    return { kind: 'welcome', value };
  }

  return {
    origin,
    async handle(context, command) {
      try {
        switch (command.op) {
          case 'welcome': return await welcome(context, command.arrivalId);
          case 'offer-gift': return await offer(context, command);
          case 'accept-gift': return await answer(context, command.offerId, true);
          case 'refuse-gift': return await answer(context, command.offerId, false);
        }
      } catch (error) {
        if (error instanceof Refused) return { kind: 'denied', code: error.code };
        throw error;
      }
    },
  };
}
