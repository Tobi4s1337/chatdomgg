/**
 * The Raid Gate's feature-local boundary (spec 23). Browser-safe: it imports shared validators and nothing from the
 * server. Commands carry no actor, role or session field; main's adapter turns an authenticated request into a
 * `GateContext` and passes the JSON body here untouched. Replies are re-read in the browser with the same readers,
 * so a malformed or over-sharing transport payload is refused instead of rendered.
 */
import { AtlasRaidSchema, type AtlasRaid } from '../../../../packages/shared/src/atlas-raids';
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import { bool, complete, epoch, fields, kingdom, oneOf, person, positive, token, uint } from './guard';

export type { AtlasRaid, KingdomId, PersonId };

export const GATE_LIMITS = Object.freeze({
  /** A preview is a decision window, not a standing permission. */
  previewMs: 120_000,
  /** Twitch's own countdown between an accepted Start a Raid and the raid itself. */
  twitchCountdownMs: 90_000,
  /** After Twitch's countdown, how long a verified `channel.raid` may take to reach us before we say we are checking. */
  observationGraceMs: 60_000,
  /** How far event clocks may disagree when matching a raid to the press that asked for it. */
  clockSkewMs: 10_000,
  /** How long an unresolved raid keeps the party at the gate ("checking whether the raid began"). */
  unknownHoldMs: 15 * 60_000,
  /** How long a settled raid (departed, called off, refused) stays the gate's news. */
  settledShowMs: 5 * 60_000,
  passportPage: 50,
  passportSessionCap: 200,
  cursor: 256,
  /** A gift offer is a moment of the visit, not a standing promise. */
  giftOfferMs: 10 * 60_000,
  /** Offers a welcome lists, most recent first. */
  giftsListed: 24,
  /** A person's own giftable things a welcome shows (read from the item authority, never copied). */
  giftShelf: 12,
  /** Guests a host's welcome lists: those who arrived through a gate and still stand in the kingdom. */
  guestsListed: 24,
  /** Offers that may stand open at once around one arrival. */
  giftsOpenPerArrival: 6,
  /** Display names and item titles. */
  name: 64,
});

export type GateRole = 'monarch' | 'citizen' | 'guest';
export type GatePrincipal = Readonly<{ personId: PersonId; sessionId: string; sourceKingdomId: KingdomId; sourceRole: GateRole }>;
export type GateContext = Readonly<{ principal: GatePrincipal; now: number; signal: AbortSignal }>;

export type GateClassification = 'unknown' | 'general' | 'mature' | 'excluded';
export type GateTarget = Readonly<{ kingdomId: KingdomId; founded: boolean; live: boolean; classification: GateClassification }>;
export type GatePreview = Readonly<{
  token: string; requestId: string; from: KingdomId; to: KingdomId; expiresAt: number; optedIn: number; target: GateTarget;
}>;
export type GateActionState = 'prepared' | 'dispatching' | 'pending' | 'landed' | 'cancelled' | 'rejected' | 'unknown';
export type GateActionView = Readonly<{
  requestId: string; revision: number; from: KingdomId; to: KingdomId; state: GateActionState; observedAt: number; raid: AtlasRaid | null;
}>;
export type PartyView = Readonly<{ requestId: string; joined: boolean; optedIn: number; expiresAt: number }>;

/**
 * Why the monarch can or cannot open the gate right now. Only the verified source broadcaster receives this;
 * walkers learn that a gate is open, never the state of someone else's Twitch grant.
 */
export type GateAuthority = 'ready' | 'offline' | 'not-connected' | 'revoked' | 'disabled' | 'unavailable';
/**
 * The gate as one viewer sees it. `expiresAt` is when this view stops being the gate's news: the preview's end, the
 * end of the wait for an unresolved raid, or a few minutes after a settled one. `countdownEndsAt` is Twitch's own
 * countdown, only while Twitch holds the request (`pending`). `raid` is the verified public observation that set the
 * party out, only once `landed`.
 */
export type OpenGateView = Readonly<{
  requestId: string; revision: number; to: KingdomId; target: GateTarget; state: GateActionState;
  optedIn: number; expiresAt: number; joined: boolean; countdownEndsAt: number | null; raid: AtlasRaid | null;
}>;
export type GateStatusView = Readonly<{
  kingdomId: KingdomId; viewer: 'monarch' | 'walker'; authority: GateAuthority | null; open: OpenGateView | null;
}>;

export type TravelReason =
  | Readonly<{ kind: 'visit' }>
  | Readonly<{ kind: 'raid'; requestId: string; raidId: string }>
  | Readonly<{ kind: 'return'; arrivalId: string }>;
export type TravelState = 'reserved' | 'preparing' | 'ready' | 'committing' | 'committed' | 'cancelled' | 'expired' | 'denied' | 'unknown';
export type TravelView = Readonly<{
  ticket: string; revision: number; from: KingdomId; to: KingdomId; state: TravelState; leaseUntil: number;
  role: 'monarch' | 'citizen' | 'visitor' | null; arrivalId: string | null;
}>;
export type PassportStamp = Readonly<{ id: string; kingdomId: KingdomId; occurredAt: number; kind: 'visit' | 'raid'; raidId: string | null }>;
export type PassportView = Readonly<{ hidden: boolean; revision: number; stamps: readonly PassportStamp[]; nextCursor: string | null }>;
/** Things a person may freely give. Light, homes, lots, money, rank, sub pieces, Bits products, keepsakes and companions stay bound. */
export type GiftKind = 'forged' | 'crafted' | 'found' | 'welcome-offering';
/** What the item authority says about a thing: its title and the story of who made it where. Names are null when anonymous. */
export type GiftStory = Readonly<{ title: string; kind: GiftKind; makerName: string | null; originName: string | null }>;
export type GiftState = 'offered' | 'accepted' | 'refused' | 'expired' | 'rejected' | 'unknown';
/**
 * One offer between a visitor and a host, told to the two of them. `direction` is the visitor's view: a gift they `left`
 * with a host, or one they were given to take home (`brought-back`). `receipt` is the one recorded ownership transfer,
 * only once `accepted`. `kingdomId` is where it was given. Feature-local (RG10): story, names, expiry and receipt.
 */
export type VisitorGiftView = Readonly<{
  offerId: string; itemId: string; from: PersonId; to: PersonId; originKingdomId: KingdomId; makerId: PersonId; revision: number;
  state: GiftState;
  kingdomId: KingdomId; direction: 'left' | 'brought-back'; story: GiftStory; fromName: string | null; toName: string | null; expiresAt: number;
  receipt: Readonly<{ transferId: string; at: number }> | null;
}>;
/** One of the viewer's own things that the item authority says may be given, at its current revision. */
export type GiftableView = Readonly<{ itemId: string; revision: number; story: GiftStory }>;
/** A visitor standing in the host's kingdom, having arrived through a gate. Only hosts of that kingdom see this. */
export type GuestView = Readonly<{ arrivalId: string; personId: PersonId; name: string | null; from: KingdomId; arrivedAt: number; kind: 'raid' | 'visit' }>;
/**
 * The welcome at a destination, as one person sees it (RG10). A visitor sees their own arrival, how many of their party
 * stand here with them, the monarch who receives them and the offers around them; a host sees the guests now in their
 * kingdom. `shelf` is the viewer's own giftable things, only while a gift can be given.
 */
export type WelcomeView = Readonly<{
  kingdomId: KingdomId;
  viewer: 'visitor' | 'host';
  arrival: Readonly<{ arrivalId: string; from: KingdomId; arrivedAt: number; present: boolean; raidId: string | null }> | null;
  party: number;
  monarch: Readonly<{ personId: PersonId; name: string | null }>;
  guests: readonly GuestView[];
  offers: readonly VisitorGiftView[];
  shelf: readonly GiftableView[];
}>;

export type GateCommand =
  | Readonly<{ op: 'gate' }>
  /** The viewer's own outstanding journey, else the one that brought them where they are. Feature-local (RG09). */
  | Readonly<{ op: 'whereabouts' }>
  | Readonly<{ op: 'preview'; requestId: string; target: KingdomId }>
  | Readonly<{ op: 'start'; requestId: string; previewToken: string }>
  | Readonly<{ op: 'cancel' | 'reconcile' | 'read-action' | 'join' | 'leave'; requestId: string }>
  | Readonly<{ op: 'reserve'; requestId: string; target: KingdomId; reason: TravelReason }>
  | Readonly<{ op: 'prepare' | 'commit' | 'cancel-travel' | 'reconcile-travel'; ticket: string }>
  | Readonly<{ op: 'passport'; cursor: string | null }>
  | Readonly<{ op: 'hide-travels'; requestId: string; hidden: boolean }>
  | Readonly<{ op: 'offer-gift'; requestId: string; itemId: string; recipient: PersonId; arrivalId: string }>
  | Readonly<{ op: 'accept-gift' | 'refuse-gift'; requestId: string; offerId: string }>
  /** The welcome around the viewer's own arrival, or (null) the guests in the kingdom this host belongs to. Feature-local (RG10). */
  | Readonly<{ op: 'welcome'; arrivalId: string | null }>;

export type GateDenial = 'unauthorized' | 'stale' | 'unavailable' | 'full' | 'invalid';
export type GateReply =
  | Readonly<{ kind: 'gate'; value: GateStatusView }>
  | Readonly<{ kind: 'preview'; value: GatePreview }>
  | Readonly<{ kind: 'action'; value: GateActionView }>
  | Readonly<{ kind: 'party'; value: PartyView }>
  | Readonly<{ kind: 'travel'; value: TravelView }>
  | Readonly<{ kind: 'passport'; value: PassportView }>
  | Readonly<{ kind: 'gift'; value: VisitorGiftView }>
  | Readonly<{ kind: 'welcome'; value: WelcomeView }>
  | Readonly<{ kind: 'denied'; code: GateDenial }>;

const ACTION_STATES = ['prepared', 'dispatching', 'pending', 'landed', 'cancelled', 'rejected', 'unknown'] as const;
const TRAVEL_STATES = ['reserved', 'preparing', 'ready', 'committing', 'committed', 'cancelled', 'expired', 'denied', 'unknown'] as const;
const GIFT_STATES = ['offered', 'accepted', 'refused', 'expired', 'rejected', 'unknown'] as const;
export const GIFT_KINDS = ['forged', 'crafted', 'found', 'welcome-offering'] as const;
const AUTHORITIES = ['ready', 'offline', 'not-connected', 'revoked', 'disabled', 'unavailable'] as const;
const CLASSIFICATIONS = ['unknown', 'general', 'mature', 'excluded'] as const;
const DENIALS = ['unauthorized', 'stale', 'unavailable', 'full', 'invalid'] as const;
const SIMPLE_REQUEST_OPS = ['cancel', 'reconcile', 'read-action', 'join', 'leave'] as const;
const TICKET_OPS = ['prepare', 'commit', 'cancel-travel', 'reconcile-travel'] as const;

const cursor = (value: unknown): string | null | undefined => value === null ? null
  : typeof value === 'string' && value.length > 0 && value.length <= GATE_LIMITS.cursor && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : undefined;
const nullable = <T>(value: unknown, read: (value: unknown) => T | undefined): T | null | undefined => value === null ? null : read(value);

function readReason(value: unknown): TravelReason | undefined {
  const kind = typeof value === 'object' && value !== null ? (value as { kind?: unknown }).kind : undefined;
  if (kind === 'visit') return fields(value, ['kind']) ? { kind } : undefined;
  if (kind === 'raid') {
    const f = fields(value, ['kind', 'requestId', 'raidId']);
    const reason = f && { kind: 'raid' as const, requestId: token(f.requestId), raidId: token(f.raidId) };
    return reason && complete(reason) ? reason : undefined;
  }
  if (kind === 'return') {
    const f = fields(value, ['kind', 'arrivalId']);
    const reason = f && { kind: 'return' as const, arrivalId: token(f.arrivalId) };
    return reason && complete(reason) ? reason : undefined;
  }
  return undefined;
}

/** The only way a command enters the application. Unknown ops, extra keys and actor fields are all refused. */
export function readGateCommand(value: unknown): GateCommand | undefined {
  const op = typeof value === 'object' && value !== null ? (value as { op?: unknown }).op : undefined;
  if (op === 'gate' || op === 'whereabouts') return fields(value, ['op']) ? { op } : undefined;
  if (op === 'preview' || op === 'reserve') {
    const f = fields(value, op === 'preview' ? ['op', 'requestId', 'target'] : ['op', 'requestId', 'target', 'reason']);
    if (!f) return undefined;
    const requestId = token(f.requestId), target = kingdom(f.target);
    if (requestId === undefined || target === undefined) return undefined;
    if (op === 'preview') return { op, requestId, target };
    const reason = readReason(f.reason);
    return reason ? { op, requestId, target, reason } : undefined;
  }
  if (op === 'start') {
    const f = fields(value, ['op', 'requestId', 'previewToken']);
    const command = f && { op: 'start' as const, requestId: token(f.requestId), previewToken: token(f.previewToken) };
    return command && complete(command) ? command : undefined;
  }
  const simple = oneOf(op, SIMPLE_REQUEST_OPS);
  if (simple) {
    const f = fields(value, ['op', 'requestId']);
    const requestId = f && token(f.requestId);
    return requestId ? { op: simple, requestId } : undefined;
  }
  const ticketOp = oneOf(op, TICKET_OPS);
  if (ticketOp) {
    const f = fields(value, ['op', 'ticket']);
    const ticket = f && token(f.ticket);
    return ticket ? { op: ticketOp, ticket } : undefined;
  }
  if (op === 'passport') {
    const f = fields(value, ['op', 'cursor']);
    const at = f && cursor(f.cursor);
    return at !== undefined && f ? { op, cursor: at } : undefined;
  }
  if (op === 'hide-travels') {
    const f = fields(value, ['op', 'requestId', 'hidden']);
    const command = f && { op: 'hide-travels' as const, requestId: token(f.requestId), hidden: bool(f.hidden) };
    return command && complete(command) ? command : undefined;
  }
  if (op === 'offer-gift') {
    const f = fields(value, ['op', 'requestId', 'itemId', 'recipient', 'arrivalId']);
    const command = f && { op: 'offer-gift' as const, requestId: token(f.requestId), itemId: token(f.itemId), recipient: person(f.recipient), arrivalId: token(f.arrivalId) };
    return command && complete(command) ? command : undefined;
  }
  if (op === 'welcome') {
    const f = fields(value, ['op', 'arrivalId']);
    const arrivalId = f && nullable(f.arrivalId, token);
    return f && arrivalId !== undefined ? { op, arrivalId } : undefined;
  }
  if (op === 'accept-gift' || op === 'refuse-gift') {
    const f = fields(value, ['op', 'requestId', 'offerId']);
    const command = f && { op: op as 'accept-gift' | 'refuse-gift', requestId: token(f.requestId), offerId: token(f.offerId) };
    return command && complete(command) ? command : undefined;
  }
  return undefined;
}

function readTarget(value: unknown): GateTarget | undefined {
  const f = fields(value, ['kingdomId', 'founded', 'live', 'classification']);
  const target = f && { kingdomId: kingdom(f.kingdomId), founded: bool(f.founded), live: bool(f.live), classification: oneOf(f.classification, CLASSIFICATIONS) };
  return target && complete(target) ? target : undefined;
}

function readPreview(value: unknown): GatePreview | undefined {
  const f = fields(value, ['token', 'requestId', 'from', 'to', 'expiresAt', 'optedIn', 'target']);
  const preview = f && {
    token: token(f.token), requestId: token(f.requestId), from: kingdom(f.from), to: kingdom(f.to),
    expiresAt: positive(f.expiresAt), optedIn: uint(f.optedIn), target: readTarget(f.target),
  };
  if (!preview || !complete(preview)) return undefined;
  return preview.from !== preview.to && preview.target.kingdomId === preview.to ? preview : undefined;
}

function readRaid(value: unknown): AtlasRaid | undefined {
  const parsed = AtlasRaidSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function readAction(value: unknown): GateActionView | undefined {
  const f = fields(value, ['requestId', 'revision', 'from', 'to', 'state', 'observedAt', 'raid']);
  if (!f) return undefined;
  const raid = nullable(f.raid, readRaid);
  const action = { requestId: token(f.requestId), revision: positive(f.revision), from: kingdom(f.from), to: kingdom(f.to), state: oneOf(f.state, ACTION_STATES), observedAt: epoch(f.observedAt) };
  if (!complete(action) || raid === undefined) return undefined;
  // Landed if and only if a raid between this exact pair was observed.
  if ((action.state === 'landed') !== (raid !== null)) return undefined;
  if (raid && (raid.fromKingdomId !== action.from || raid.toKingdomId !== action.to)) return undefined;
  return action.from !== action.to ? { ...action, raid } : undefined;
}

function readParty(value: unknown): PartyView | undefined {
  const f = fields(value, ['requestId', 'joined', 'optedIn', 'expiresAt']);
  const party = f && { requestId: token(f.requestId), joined: bool(f.joined), optedIn: uint(f.optedIn), expiresAt: positive(f.expiresAt) };
  return party && complete(party) && (!party.joined || party.optedIn > 0) ? party : undefined;
}

function readOpenGate(value: unknown): OpenGateView | undefined {
  const f = fields(value, ['requestId', 'revision', 'to', 'target', 'state', 'optedIn', 'expiresAt', 'joined', 'countdownEndsAt', 'raid']);
  if (!f) return undefined;
  const countdownEndsAt = nullable(f.countdownEndsAt, positive), raid = nullable(f.raid, readRaid);
  const open = {
    requestId: token(f.requestId), revision: positive(f.revision), to: kingdom(f.to), target: readTarget(f.target),
    state: oneOf(f.state, ACTION_STATES), optedIn: uint(f.optedIn), expiresAt: positive(f.expiresAt), joined: bool(f.joined),
  };
  if (!complete(open) || countdownEndsAt === undefined || raid === undefined || open.target.kingdomId !== open.to) return undefined;
  // A countdown exists only while Twitch holds the request; a raid only once it is witnessed, and only to this gate's destination.
  if ((open.state === 'pending') !== (countdownEndsAt !== null) || (open.state === 'landed') !== (raid !== null)) return undefined;
  if (raid && raid.toKingdomId !== open.to) return undefined;
  return !open.joined || open.optedIn > 0 ? { ...open, countdownEndsAt, raid } : undefined;
}

function readStatus(value: unknown): GateStatusView | undefined {
  const f = fields(value, ['kingdomId', 'viewer', 'authority', 'open']);
  if (!f) return undefined;
  const kingdomId = kingdom(f.kingdomId), viewer = oneOf(f.viewer, ['monarch', 'walker'] as const);
  const authority = nullable(f.authority, value => oneOf(value, AUTHORITIES)), open = nullable(f.open, readOpenGate);
  if (!kingdomId || !viewer || authority === undefined || open === undefined) return undefined;
  // A walker never learns the monarch's grant state.
  if ((viewer === 'monarch') !== (authority !== null)) return undefined;
  if (open?.raid && open.raid.fromKingdomId !== kingdomId) return undefined;
  return open && open.to === kingdomId ? undefined : { kingdomId, viewer, authority, open };
}

function readTravel(value: unknown): TravelView | undefined {
  const f = fields(value, ['ticket', 'revision', 'from', 'to', 'state', 'leaseUntil', 'role', 'arrivalId']);
  if (!f) return undefined;
  const role = nullable(f.role, value => oneOf(value, ['monarch', 'citizen', 'visitor'] as const)), arrivalId = nullable(f.arrivalId, token);
  const travel = { ticket: token(f.ticket), revision: positive(f.revision), from: kingdom(f.from), to: kingdom(f.to), state: oneOf(f.state, TRAVEL_STATES), leaseUntil: epoch(f.leaseUntil) };
  if (!complete(travel) || role === undefined || arrivalId === undefined) return undefined;
  // Committed if and only if the destination acknowledged an arrival and a role.
  const committed = travel.state === 'committed';
  if (committed !== (role !== null) || committed !== (arrivalId !== null)) return undefined;
  return { ...travel, role, arrivalId };
}

function readStamp(value: unknown): PassportStamp | undefined {
  const f = fields(value, ['id', 'kingdomId', 'occurredAt', 'kind', 'raidId']);
  if (!f) return undefined;
  const raidId = nullable(f.raidId, token);
  const stamp = { id: token(f.id), kingdomId: kingdom(f.kingdomId), occurredAt: epoch(f.occurredAt), kind: oneOf(f.kind, ['visit', 'raid'] as const) };
  if (!complete(stamp) || raidId === undefined || (stamp.kind === 'raid') !== (raidId !== null)) return undefined;
  return { ...stamp, raidId };
}

function readPassport(value: unknown): PassportView | undefined {
  const f = fields(value, ['hidden', 'revision', 'stamps', 'nextCursor']);
  if (!f || !Array.isArray(f.stamps) || f.stamps.length > GATE_LIMITS.passportPage) return undefined;
  const hidden = bool(f.hidden), revision = positive(f.revision), nextCursor = cursor(f.nextCursor);
  const stamps = f.stamps.map(readStamp);
  if (hidden === undefined || revision === undefined || nextCursor === undefined || stamps.some(stamp => !stamp)) return undefined;
  if (hidden && (stamps.length > 0 || nextCursor !== null)) return undefined;
  return { hidden, revision, stamps: stamps as PassportStamp[], nextCursor };
}

/** A display name or title: trimmed, 1–64 characters, no control characters. */
export const displayText = (value: unknown): string | undefined =>
  // eslint-disable-next-line no-control-regex -- Refuse control characters at the gate's boundary.
  typeof value === 'string' && value.length > 0 && value.length <= GATE_LIMITS.name && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;

export function readGiftStory(value: unknown): GiftStory | undefined {
  const f = fields(value, ['title', 'kind', 'makerName', 'originName']);
  if (!f) return undefined;
  const makerName = nullable(f.makerName, displayText), originName = nullable(f.originName, displayText);
  const story = { title: displayText(f.title), kind: oneOf(f.kind, GIFT_KINDS) };
  return complete(story) && makerName !== undefined && originName !== undefined ? { ...story, makerName, originName } : undefined;
}

function readGift(value: unknown): VisitorGiftView | undefined {
  const f = fields(value, ['offerId', 'itemId', 'from', 'to', 'originKingdomId', 'makerId', 'revision', 'state',
    'kingdomId', 'direction', 'story', 'fromName', 'toName', 'expiresAt', 'receipt']);
  if (!f) return undefined;
  const fromName = nullable(f.fromName, displayText), toName = nullable(f.toName, displayText);
  const receipt = nullable(f.receipt, value => {
    const r = fields(value, ['transferId', 'at']);
    const read = r && { transferId: token(r.transferId), at: epoch(r.at) };
    return read && complete(read) ? read : undefined;
  });
  const gift = {
    offerId: token(f.offerId), itemId: token(f.itemId), from: person(f.from), to: person(f.to), originKingdomId: kingdom(f.originKingdomId),
    makerId: person(f.makerId), revision: positive(f.revision), state: oneOf(f.state, GIFT_STATES), kingdomId: kingdom(f.kingdomId),
    direction: oneOf(f.direction, ['left', 'brought-back'] as const), story: readGiftStory(f.story), expiresAt: positive(f.expiresAt),
  };
  if (!complete(gift) || fromName === undefined || toName === undefined || receipt === undefined || gift.from === gift.to) return undefined;
  // A receipt exists if and only if the item changed hands, and its transfer is this offer's own.
  if ((gift.state === 'accepted') !== (receipt !== null) || (receipt && receipt.transferId !== gift.offerId)) return undefined;
  return { ...gift, fromName, toName, receipt };
}

function readGiftable(value: unknown): GiftableView | undefined {
  const f = fields(value, ['itemId', 'revision', 'story']);
  const item = f && { itemId: token(f.itemId), revision: positive(f.revision), story: readGiftStory(f.story) };
  return item && complete(item) ? item : undefined;
}

function readGuest(value: unknown): GuestView | undefined {
  const f = fields(value, ['arrivalId', 'personId', 'name', 'from', 'arrivedAt', 'kind']);
  if (!f) return undefined;
  const name = nullable(f.name, displayText);
  const guest = { arrivalId: token(f.arrivalId), personId: person(f.personId), from: kingdom(f.from), arrivedAt: epoch(f.arrivedAt), kind: oneOf(f.kind, ['raid', 'visit'] as const) };
  return complete(guest) && name !== undefined ? { ...guest, name } : undefined;
}

function readList<T>(value: unknown, max: number, read: (value: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value) || value.length > max) return undefined;
  const items = value.map(read);
  return items.every(item => item !== undefined) ? items as T[] : undefined;
}

function readWelcome(value: unknown): WelcomeView | undefined {
  const f = fields(value, ['kingdomId', 'viewer', 'arrival', 'party', 'monarch', 'guests', 'offers', 'shelf']);
  if (!f) return undefined;
  const arrival = nullable(f.arrival, value => {
    const a = fields(value, ['arrivalId', 'from', 'arrivedAt', 'present', 'raidId']);
    if (!a) return undefined;
    const raidId = nullable(a.raidId, token);
    const read = { arrivalId: token(a.arrivalId), from: kingdom(a.from), arrivedAt: epoch(a.arrivedAt), present: bool(a.present) };
    return complete(read) && raidId !== undefined ? { ...read, raidId } : undefined;
  });
  const m = fields(f.monarch, ['personId', 'name']);
  const monarchName = m ? nullable(m.name, displayText) : undefined, monarchId = m ? person(m.personId) : undefined;
  const welcome = {
    kingdomId: kingdom(f.kingdomId), viewer: oneOf(f.viewer, ['visitor', 'host'] as const), party: uint(f.party),
    guests: readList(f.guests, GATE_LIMITS.guestsListed, readGuest), offers: readList(f.offers, GATE_LIMITS.giftsListed, readGift),
    shelf: readList(f.shelf, GATE_LIMITS.giftShelf, readGiftable),
  };
  if (!complete(welcome) || arrival === undefined || monarchName === undefined || !monarchId) return undefined;
  // A visitor sees their own arrival and no guest list; a host sees guests and has no arrival of their own here.
  if ((welcome.viewer === 'visitor') !== (arrival !== null) || (welcome.viewer === 'visitor' && welcome.guests.length > 0)) return undefined;
  if (arrival && arrival.from === welcome.kingdomId) return undefined;
  if (welcome.offers.some(offer => offer.kingdomId !== welcome.kingdomId) || welcome.guests.some(guest => guest.from === welcome.kingdomId)) return undefined;
  return { ...welcome, arrival, monarch: { personId: monarchId, name: monarchName } };
}

const VALUE_READERS = {
  gate: readStatus, preview: readPreview, action: readAction, party: readParty, travel: readTravel, passport: readPassport, gift: readGift,
  welcome: readWelcome,
} as const;

/** Re-reads a reply from any transport. Used by the server before sending and by the browser after receiving. */
export function readGateReply(value: unknown): GateReply | undefined {
  const kind = typeof value === 'object' && value !== null ? (value as { kind?: unknown }).kind : undefined;
  if (kind === 'denied') {
    const f = fields(value, ['kind', 'code']);
    const code = f && oneOf(f.code, DENIALS);
    return code ? { kind, code } : undefined;
  }
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(VALUE_READERS, kind)) return undefined;
  const f = fields(value, ['kind', 'value']);
  if (!f) return undefined;
  const read = VALUE_READERS[kind as keyof typeof VALUE_READERS] as (value: unknown) => unknown;
  const parsed = read(f.value);
  return parsed === undefined ? undefined : { kind, value: parsed } as GateReply;
}
