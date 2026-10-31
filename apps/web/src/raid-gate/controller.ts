/**
 * The gate's browser controller (spec 23). It holds no authority: every change is a request to the server, and the
 * snapshot is a projection of what the server last said plus what this viewer is waiting for. Deterministic under
 * the injected clock; a reply that arrives after a newer one, or after dispose, is ignored.
 */
import type { AtlasChannel } from '@chatdom/shared';
import {
  GATE_LIMITS,
  type AtlasRaid, type GateActionState, type GateActionView, type GateAuthority, type GateCommand, type GateDenial, type GatePreview, type GateReply,
  type GateStatusView, type GateTarget, type KingdomId, type OpenGateView, type TravelReason, type TravelState, type TravelView,
} from '../../../api/src/raid-gate/contracts';
import type { AtlasTravelStage, GateKingdom, GateLand, RaidGatePorts } from './ports';

export type GatePhase =
  /** No authenticated authority is bound to this view. */
  | 'unbound'
  | 'loading'
  /** The authority could not be reached; nothing changed. */
  | 'unreachable'
  /** The monarch, whose gate cannot open yet: see `authority`. */
  | 'authority'
  /** The monarch, ready, no gate open. */
  | 'idle'
  /** The monarch has the Atlas finder open. */
  | 'choosing'
  | 'previewing'
  /** The monarch holds a live preview. */
  | 'preview'
  /** The monarch's preview ran out; its party is free again. */
  | 'lapsed'
  /** A walker, no gate open. */
  | 'quiet'
  /** A walker, the gate is open and gathering. */
  | 'gathering'
  /** The monarch pressed Open the gate and Twitch is being asked. */
  | 'starting'
  /** Twitch holds the raid and counts down; people can still choose. */
  | 'countdown'
  /** Twitch's answer was lost, or its countdown ended unwitnessed: the authority is checking. Nobody has left. */
  | 'checking'
  /** Twitch's verified raid was seen: the party set out. */
  | 'departed'
  /** Twitch confirmed the monarch's cancel: the party turned back. */
  | 'called-off'
  /** Twitch did not start the raid. Nothing left. */
  | 'refused';

export type GateDestination = Readonly<{ target: GateTarget; channel: AtlasChannel | null; land: GateLand | null }>;
/**
 * How the last gate this viewer saw came to an end without anyone leaving: the monarch closed it, its preview ran
 * out, or the monarch chose a different destination. `joined` is whether this viewer had chosen to march.
 */
export type GateFarewell = Readonly<{ reason: 'closed' | 'lapsed' | 'changed'; destination: GateDestination; joined: boolean }>;
export type GateNotice =
  | Readonly<{ kind: 'denied'; code: GateDenial }>
  | Readonly<{ kind: 'unreachable' }>
  | Readonly<{ kind: 'no-map' }>
  /** The monarch's press never reached the gate (the authority still holds the unstarted preview). Nothing was sent. */
  | Readonly<{ kind: 'not-sent' }>;

/**
 * This viewer's own journey through the gate, as the authority last told it. `state` is `asking` until the first
 * answer. `overrun` is true when the destination is taking longer than usual to ready its world: the drawing holds,
 * and the walker is still home until they step through. `refusal` is why a reservation was refused (`full`: no room
 * right now; others: not admitted or no longer eligible), and nothing was held.
 */
export type JourneySnapshot = Readonly<{
  kind: 'raid' | 'return';
  ticket: string | null;
  state: TravelState | 'asking';
  from: KingdomId;
  to: KingdomId;
  /** The kingdom that is not home: where a raid journey goes, or where a journey home leaves from. */
  destination: GateDestination | null;
  role: TravelView['role'];
  arrivalId: string | null;
  overrun: boolean;
  refusal: GateDenial | null;
  busy: 'cancel' | 'reconcile' | null;
}>;

export type GateSnapshot = Readonly<{
  phase: GatePhase;
  origin: 'live' | 'simulated' | null;
  mapOrigin: 'live' | 'simulated' | null;
  viewer: 'monarch' | 'walker' | null;
  authority: GateAuthority | null;
  source: GateKingdom;
  destination: GateDestination | null;
  requestId: string | null;
  optedIn: number;
  joined: boolean;
  expiresAt: number | null;
  /** The open gate's state as the authority last said, or null. */
  state: GateActionState | null;
  /** When Twitch's countdown ends, while it holds the raid. */
  countdownEndsAt: number | null;
  /** The verified public raid that set the party out. */
  raid: AtlasRaid | null;
  /** While checking: whether this viewer watched Twitch's countdown run out (`countdown`) or never saw it begin (`answer`). */
  checking: 'countdown' | 'answer' | null;
  /** The monarch holds this preview's token and can open the gate with it (not after a reload: renew the preview). */
  canStart: boolean;
  busy: 'preview' | 'join' | 'leave' | 'close' | 'start' | 'reconcile' | null;
  /** The gate this viewer last saw ended and nobody moved. Shown for a few minutes, then ordinary life resumes. */
  farewell: GateFarewell | null;
  /** The destination a preview is being asked for, as the map named it. Not yet the authority's answer. */
  asking: AtlasChannel | null;
  notice: GateNotice | null;
  canReconnect: boolean;
  /** This viewer's journey, if one is under way or just ended. Null for everyone who stayed. */
  journey: JourneySnapshot | null;
  /** This viewer marched with a party that set out for a founded kingdom and may follow it through the gate. */
  canTravel: boolean;
}>;

export interface RaidGateController {
  snapshot(): GateSnapshot;
  subscribe(listener: (snapshot: GateSnapshot) => void): () => void;
  /** Opens Atlas gate mode at the source. No side effects anywhere else. */
  open(): void;
  close(): void;
  preview(target: KingdomId): Promise<void>;
  /**
   * The monarch closes the gate: before starting nothing was sent and nobody moves; once Twitch holds the raid, the
   * cancel goes to Twitch and the party turns back only when Twitch confirms it.
   */
  cancel(): Promise<void>;
  /** The monarch opens the gate with the preview they hold. Sent once; a lost reply is reconciled, never re-sent. */
  start(): Promise<void>;
  /** Asks the authority what became of the open request (the monarch's reconcile also asks Twitch's transport). */
  reconcile(): Promise<void>;
  join(): Promise<void>;
  leave(): Promise<void>;
  /** A marcher follows the witnessed raid through the gate: reserve, ready, step through. Each step is the authority's. */
  travel(): Promise<void>;
  /** After arriving, go home the same careful way. */
  returnHome(): Promise<void>;
  /** Turns back before stepping through. A step that may have happened is checked instead, never undone by guess. */
  cancelTravel(): Promise<void>;
  /** Asks the authority what became of this viewer's journey, and carries on from there. */
  reconcileTravel(): Promise<void>;
  /** Puts away a journey that has ended (home again, or turned back). */
  dismissJourney(): void;
  reconnect(): void;
  refresh(): Promise<void>;
  dispose(): void;
}

type Pick = Readonly<{ channel: AtlasChannel; land: GateLand }>;
type Ended = Readonly<{ reason: 'closed' | 'changed'; target: GateTarget; joined: boolean; at: number }>;

/** A farewell is news, not a state: after this long the gate is simply quiet again. */
export const FAREWELL_MS = 5 * 60_000;
/** Readying a world longer than this is told as an overrun: the drawing holds with the real stage. */
export const JOURNEY_OVERRUN_MS = 6_000;
const PREPARE_POLL_MS = 900;
const CONFIRM_POLL_MS = 3_000;
const JOURNEY_STEPS = 120;
const OPEN_TRAVEL: ReadonlySet<TravelState> = new Set(['reserved', 'preparing', 'ready', 'committing', 'unknown']);

type Journey = {
  kind: 'raid' | 'return'; requestId: string; target: KingdomId; reason: TravelReason; destination: GateTarget | null;
  view: TravelView | null; startedAt: number; refusal: GateDenial | null; busy: JourneySnapshot['busy'];
};

function stageOf(state: TravelState): AtlasTravelStage['kind'] {
  switch (state) {
    case 'reserved': return 'rise';
    case 'preparing': return 'road';
    case 'ready': case 'committing': case 'unknown': return 'drawing';
    case 'committed': return 'arrived';
    default: return 'back';
  }
}

const STARTED_PHASES: Readonly<Record<Exclude<GateActionState, 'prepared'>, GatePhase>> = {
  dispatching: 'starting', pending: 'countdown', unknown: 'checking', landed: 'departed', cancelled: 'called-off', rejected: 'refused',
};
const STARTED: ReadonlySet<GatePhase> = new Set(Object.values(STARTED_PHASES));
/** A raid whose news is told; the monarch may already choose the next destination. */
const SETTLED: ReadonlySet<GateActionState> = new Set(['landed', 'cancelled', 'rejected']);

export function createRaidGateController(ports: RaidGatePorts): RaidGateController {
  const { api, atlas, source, clock } = ports;
  const ids = ports.ids ?? (() => crypto.randomUUID());
  const wait = ports.wait ?? ((ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  }));
  const life = new AbortController();
  const listeners = new Set<(snapshot: GateSnapshot) => void>();
  const known = new Map<KingdomId, Pick>();

  let status: GateStatusView | null = null;
  let preview: GatePreview | null = null;
  let choosing = false;
  let asking: AtlasChannel | null = null;
  let loading = api !== null;
  let unreachable = false;
  let busy: GateSnapshot['busy'] = null;
  let notice: GateNotice | null = null;
  /** The newest open gate the authority showed us, and how the one before it ended. */
  let seen: OpenGateView | null = null;
  let ended: Ended | null = null;
  /** Each kind of request only lets its newest reply land. */
  const generation = { status: 0, preview: 0, party: 0, close: 0, start: 0, reconcile: 0 };
  /** Raids already handed to the map, so a refresh never sends a second caravan. */
  const followed = new Set<string>();
  /** Requests this viewer saw Twitch counting down. */
  const counted = new Set<string>();
  let journey: Journey | null = null;
  /** Only the newest journey's steps land; turning back or starting over retires the older loop. */
  let journeyGeneration = 0;
  /** Stages already shown on the map, so a refresh never replays one. */
  const staged = new Set<string>();

  function destinationFor(target: GateTarget): GateDestination {
    const pick = known.get(target.kingdomId);
    return { target, channel: pick?.channel ?? null, land: pick?.land ?? (target.founded ? 'founded' : null) };
  }

  function farewellAt(now: number, live: OpenGateView | null, viewer: GateSnapshot['viewer']): GateFarewell | null {
    let end: Readonly<{ reason: GateFarewell['reason']; target: GateTarget; joined: boolean; at: number }> | null = null;
    if (!live && seen && seen.state === 'prepared' && now >= seen.expiresAt) end = { reason: 'lapsed', target: seen.target, joined: seen.joined, at: seen.expiresAt };
    else if (ended && (ended.reason === 'changed') === (live !== null)) end = ended;
    // The monarch sees their own lapse as its own phase, and chose any new destination themselves.
    if (!end || now - end.at >= FAREWELL_MS || (viewer === 'monarch' && end.reason !== 'closed')) return null;
    if (end.reason === 'changed' && !end.joined) return null;
    return { reason: end.reason, destination: destinationFor(end.target), joined: end.joined };
  }

  function snapshot(): GateSnapshot {
    const now = clock();
    const open = status?.open ?? null;
    const viewer = status?.viewer ?? null;
    const live = open && now < open.expiresAt ? open : null;
    const lapsed = viewer === 'monarch' && !live && preview !== null && now >= preview.expiresAt;
    let phase: GatePhase;
    if (!api) phase = 'unbound';
    else if (!status) phase = loading ? 'loading' : 'unreachable';
    else if (busy === 'start') phase = 'starting';
    else if (live && live.state !== 'prepared') phase = STARTED_PHASES[live.state];
    else if (viewer === 'walker') phase = live ? 'gathering' : 'quiet';
    else if (status.authority !== 'ready') phase = 'authority';
    else if (busy === 'preview') phase = 'previewing';
    else if (choosing) phase = 'choosing';
    else if (live) phase = 'preview';
    else if (lapsed) phase = 'lapsed';
    else phase = 'idle';
    // A monarch may choose a new destination from a settled raid's news; the map takes over.
    if (viewer === 'monarch' && (choosing || busy === 'preview') && live && SETTLED.has(live.state)) phase = busy === 'preview' ? 'previewing' : 'choosing';
    const target = live?.target ?? preview?.target ?? null;
    const showsRoad = phase === 'preview' || phase === 'gathering' || phase === 'lapsed' || phase === 'previewing' || STARTED.has(phase);
    return {
      phase, origin: api?.origin ?? null, mapOrigin: atlas?.origin ?? null, viewer, authority: status?.authority ?? null, source,
      destination: target && showsRoad && !(phase === 'previewing' && live && SETTLED.has(live.state)) ? destinationFor(target) : null,
      requestId: live?.requestId ?? null, optedIn: live?.optedIn ?? 0, joined: live?.joined ?? false, expiresAt: live?.expiresAt ?? (phase === 'lapsed' ? preview?.expiresAt ?? null : null),
      state: live?.state ?? null, countdownEndsAt: live?.countdownEndsAt ?? null, raid: live?.raid ?? null,
      checking: phase === 'checking' && live ? (counted.has(live.requestId) ? 'countdown' : 'answer') : null,
      canStart: viewer === 'monarch' && live?.state === 'prepared' && preview?.requestId === live.requestId && now < preview.expiresAt,
      busy, farewell: status ? farewellAt(now, live, viewer) : null, asking: busy === 'preview' ? asking : null, notice: unreachable && status ? { kind: 'unreachable' } : notice, canReconnect: ports.account !== undefined,
      journey: journeyAt(now),
      canTravel: journey === null && live?.state === 'landed' && live.joined && live.raid !== null && live.target.founded,
    };
  }

  function journeyAt(now: number): JourneySnapshot | null {
    if (!journey) return null;
    const view = journey.view;
    const state = view?.state ?? 'asking';
    const readying = state === 'asking' || state === 'reserved' || state === 'preparing';
    const destination = journey.destination ? destinationFor(journey.destination) : null;
    return {
      kind: journey.kind, ticket: view?.ticket ?? null, state, from: view?.from ?? (journey.kind === 'return' ? journey.target : source.kingdomId), to: journey.target,
      destination, role: view?.role ?? null, arrivalId: view?.arrivalId ?? null, overrun: readying && journey.refusal === null && now - journey.startedAt >= JOURNEY_OVERRUN_MS,
      refusal: journey.refusal, busy: journey.busy,
    };
  }

  function emit(): void {
    if (life.signal.aborted) return;
    const next = snapshot();
    for (const listener of listeners) listener(next);
  }

  function resolve(kingdomId: KingdomId): void {
    if (!atlas || known.has(kingdomId)) return;
    void atlas.resolve(kingdomId, life.signal).then(pick => {
      if (pick && pick.channel.kingdomId === kingdomId) { known.set(kingdomId, pick); emit(); }
    }, () => undefined);
  }

  /** Applies a status if it is not older than what we hold for the same request. */
  function applyStatus(next: GateStatusView): void {
    const held = status?.open;
    if (held && next.open && held.requestId === next.open.requestId && next.open.revision < held.revision) return;
    status = next;
    track(next.open);
    if (preview && next.open?.requestId !== preview.requestId && clock() < preview.expiresAt) preview = null;
    // A started request has no preview left to lapse or to start again.
    if (preview && next.open?.requestId === preview.requestId && next.open.state !== 'prepared') preview = null;
    if (next.open) resolve(next.open.to);
    if (next.open?.raid) follow(next.open.raid);
    if (next.open?.state === 'pending') counted.add(next.open.requestId);
  }

  /** The party set out: the map attaches to the public caravan of this one raid, once. */
  function follow(raid: AtlasRaid): void {
    if (!atlas || followed.has(raid.id)) return;
    followed.add(raid.id);
    atlas.follow(raid, life.signal);
  }

  /** What a start, cancel or reconcile reply says about the open gate, until the next full status replaces it. */
  function applyAction(view: GateActionView): void {
    const open = status?.open;
    if (!status || !open || open.requestId !== view.requestId || view.revision < open.revision) return;
    const countdownEndsAt = view.state === 'pending' ? open.countdownEndsAt ?? view.observedAt + GATE_LIMITS.twitchCountdownMs : null;
    status = { ...status, open: { ...open, revision: view.revision, state: view.state, raid: view.raid, countdownEndsAt } };
    if (view.state !== 'prepared' && preview?.requestId === view.requestId) preview = null;
    seen = status.open;
    if (view.raid) follow(view.raid);
    if (view.state === 'pending') counted.add(view.requestId);
  }

  /** Notices a gate that ended without a lapse: closed by the monarch, or replaced by another destination. */
  function track(open: OpenGateView | null): void {
    const now = clock();
    const before = seen && now < seen.expiresAt ? seen : null;
    if (open) {
      if (open.requestId !== seen?.requestId) ended = before?.state === 'prepared' ? { reason: 'changed', target: before.target, joined: before.joined, at: now } : null;
      seen = open;
    } else if (before?.state === 'prepared') {
      ended = { reason: 'closed', target: before.target, joined: before.joined, at: now };
      seen = null;
    }
  }

  function absorb(reply: GateReply): void {
    if (reply.kind === 'gate') applyStatus(reply.value);
  }

  async function request(command: GateCommand): Promise<GateReply | null> {
    if (!api) return null;
    try {
      const reply = await api.request(command, life.signal);
      unreachable = false;
      return reply;
    } catch {
      if (life.signal.aborted) return null;
      unreachable = true;
      return null;
    }
  }

  async function refresh(): Promise<void> {
    const mine = ++generation.status;
    const reply = await request({ op: 'gate' });
    if (mine !== generation.status || life.signal.aborted) return;
    loading = false;
    if (reply?.kind === 'gate') applyStatus(reply.value);
    else if (reply?.kind === 'denied') notice = { kind: 'denied', code: reply.code };
    emit();
  }

  async function choosePreview(target: KingdomId): Promise<void> {
    if (status?.viewer !== 'monarch' || status.authority !== 'ready') return;
    const mine = ++generation.preview;
    // Asking again for the same open destination refreshes that decision; anything else is a new one.
    const open = status.open;
    const requestId = open && open.state === 'prepared' && open.to === target && clock() < open.expiresAt ? open.requestId : ids();
    busy = 'preview'; notice = null; asking = known.get(target)?.channel ?? null; emit();
    const reply = await request({ op: 'preview', requestId, target });
    if (mine !== generation.preview || life.signal.aborted) return;
    busy = null; choosing = false; asking = null;
    if (reply?.kind === 'preview') {
      preview = reply.value;
      const held = status?.open?.requestId === reply.value.requestId ? status.open : null;
      // Shown at once; the authority's next status (revision ≥ 1) replaces this provisional one.
      if (status) status = { ...status, open: { requestId: reply.value.requestId, revision: held?.revision ?? 0, to: reply.value.to, target: reply.value.target, state: 'prepared', optedIn: reply.value.optedIn, expiresAt: reply.value.expiresAt, joined: held?.joined ?? false, countdownEndsAt: null, raid: null } };
      track(status?.open ?? null);
      resolve(target);
    } else if (reply?.kind === 'denied') {
      notice = { kind: 'denied', code: reply.code };
    }
    emit();
    void refresh();
  }

  async function choose(join: boolean): Promise<void> {
    const open = status?.open;
    if (!open || busy) return;
    const mine = ++generation.party;
    busy = join ? 'join' : 'leave'; notice = null; emit();
    const reply = await request({ op: join ? 'join' : 'leave', requestId: open.requestId });
    if (mine !== generation.party || life.signal.aborted) return;
    busy = null;
    if (reply?.kind === 'party' && status?.open?.requestId === reply.value.requestId) {
      status = { ...status, open: { ...status.open, joined: reply.value.joined, optedIn: reply.value.optedIn, expiresAt: reply.value.expiresAt } };
      seen = status.open; ended = null;
    } else if (reply?.kind === 'denied') {
      notice = { kind: 'denied', code: reply.code };
    }
    emit();
    void refresh();
  }

  async function close(): Promise<void> {
    const open = status?.open;
    if (status?.viewer !== 'monarch' || !open || busy) return;
    const mine = ++generation.close;
    busy = 'close'; notice = null; emit();
    const reply = await request({ op: 'cancel', requestId: open.requestId });
    if (mine !== generation.close || life.signal.aborted) return;
    busy = null;
    if (reply?.kind === 'action' && reply.value.requestId === open.requestId && reply.value.state === 'cancelled' && open.state === 'prepared') {
      preview = null;
      if (status?.open?.requestId === open.requestId) { status = { ...status, open: null }; track(null); }
    } else if (reply?.kind === 'action') {
      // A raid Twitch held: the authority's answer (called off, still checking, or already gone) is the news.
      applyAction(reply.value);
    } else if (reply?.kind === 'denied') {
      notice = { kind: 'denied', code: reply.code };
    }
    emit();
    void refresh();
  }

  async function start(): Promise<void> {
    const open = status?.open;
    if (status?.viewer !== 'monarch' || !open || open.state !== 'prepared' || busy) return;
    if (!preview || preview.requestId !== open.requestId || clock() >= preview.expiresAt) return;
    const mine = ++generation.start;
    busy = 'start'; notice = null; emit();
    let reply = await request({ op: 'start', requestId: open.requestId, previewToken: preview.token });
    if (mine !== generation.start || life.signal.aborted) return;
    let lost = false;
    if (reply === null) {
      // The press may or may not have arrived. Ask what became of it; never press again on the monarch's behalf.
      lost = true;
      reply = await request({ op: 'reconcile', requestId: open.requestId });
      if (mine !== generation.start || life.signal.aborted) return;
    }
    busy = null;
    if (reply?.kind === 'action') {
      applyAction(reply.value);
      if (lost && reply.value.state === 'prepared') notice = { kind: 'not-sent' };
    } else if (reply?.kind === 'denied') {
      notice = { kind: 'denied', code: reply.code };
    }
    emit();
    void refresh();
  }

  async function reconcile(): Promise<void> {
    const open = status?.open;
    if (!open || busy) return;
    const mine = ++generation.reconcile;
    busy = 'reconcile'; notice = null; emit();
    const reply = await request({ op: 'reconcile', requestId: open.requestId });
    if (mine !== generation.reconcile || life.signal.aborted) return;
    busy = null;
    if (reply?.kind === 'action') applyAction(reply.value);
    else if (reply?.kind === 'denied') notice = { kind: 'denied', code: reply.code };
    emit();
    void refresh();
  }

  // ---- This viewer's journey ------------------------------------------------------------------------------------

  /** Takes a travel reply for the current journey. False when the transport failed and nothing is known. */
  function applyTravel(reply: GateReply | null): boolean {
    if (!journey || reply === null) return false;
    if (reply.kind === 'denied') { if (!journey.view) journey.refusal = reply.code; return true; }
    if (reply.kind !== 'travel') return true;
    const held = journey.view;
    if (held && (held.ticket !== reply.value.ticket || reply.value.revision < held.revision)) return true;
    journey.view = reply.value;
    present(reply.value);
    return true;
  }

  /** The map shows each stage once, at the pace of the authority's answers. */
  function present(view: TravelView): void {
    const kind = stageOf(view.state);
    const key = `${view.ticket}/${kind}`;
    if (!atlas?.travel || staged.has(key)) return;
    staged.add(key);
    atlas.travel({ kind, ticket: view.ticket, from: view.from, to: view.to, state: view.state }, life.signal);
  }

  /** Carries the journey forward one authority answer at a time, until it arrives, ends, or needs the viewer. */
  async function walk(mine: number): Promise<void> {
    let confirms = 0;
    for (let step = 0; step < JOURNEY_STEPS; step++) {
      if (mine !== journeyGeneration || life.signal.aborted || !journey?.view) return;
      const { ticket, state } = journey.view;
      let command: GateCommand;
      if (state === 'reserved' || state === 'preparing') command = { op: 'prepare', ticket };
      else if (state === 'ready') command = { op: 'commit', ticket };
      else if (state === 'committing' || (state === 'unknown' && confirms < 4)) {
        // A step through the gate that may have happened is only ever asked about.
        confirms++;
        await wait(CONFIRM_POLL_MS, life.signal);
        if (mine !== journeyGeneration || life.signal.aborted) return;
        command = { op: 'reconcile-travel', ticket };
      } else return;
      let reply = await request(command);
      if (mine !== journeyGeneration || life.signal.aborted) return;
      // The answer was lost: ask what became of the step rather than repeating it.
      if (reply === null) reply = await request({ op: 'reconcile-travel', ticket });
      if (mine !== journeyGeneration || life.signal.aborted) return;
      if (!applyTravel(reply)) { emit(); return; }
      emit();
      const next = journey.view?.state;
      if (next === 'reserved' || next === 'preparing') await wait(PREPARE_POLL_MS, life.signal);
    }
  }

  async function begin(next: Omit<Journey, 'requestId' | 'view' | 'startedAt' | 'refusal' | 'busy'>): Promise<void> {
    const mine = ++journeyGeneration;
    const previous = journey;
    journey = { ...next, requestId: ids(), view: null, startedAt: clock(), refusal: null, busy: null };
    notice = null; emit();
    const command: GateCommand = { op: 'reserve', requestId: journey.requestId, target: next.target, reason: next.reason };
    let reply = await request(command);
    // A reservation is keyed by its request ID: asking again returns the same ticket, never a second one.
    if (reply === null && mine === journeyGeneration && !life.signal.aborted) reply = await request(command);
    if (mine !== journeyGeneration || life.signal.aborted) return;
    if (!applyTravel(reply)) { journey = previous; notice = { kind: 'unreachable' }; emit(); return; }
    // A refused journey home leaves the walker where they stand, with the arrival they came on.
    if (journey.refusal && previous) { notice = { kind: 'denied', code: journey.refusal }; journey = previous; emit(); return; }
    emit();
    await walk(mine);
  }

  async function travel(): Promise<void> {
    const open = status?.open;
    if (journey || !open || open.state !== 'landed' || !open.joined || !open.raid || !open.target.founded) return;
    await begin({ kind: 'raid', target: open.to, reason: { kind: 'raid', requestId: open.requestId, raidId: open.raid.id }, destination: open.target });
  }

  async function returnHome(): Promise<void> {
    const view = journey?.view;
    if (!journey || !view || view.state !== 'committed' || !view.arrivalId || journey.kind === 'return') return;
    // The kingdom being left keeps its name on the board on the way home.
    await begin({ kind: 'return', target: view.from, reason: { kind: 'return', arrivalId: view.arrivalId }, destination: journey.destination });
  }

  async function cancelTravel(): Promise<void> {
    const view = journey?.view;
    if (!journey || !view || !OPEN_TRAVEL.has(view.state) || journey.busy) return;
    const mine = ++journeyGeneration;
    journey.busy = 'cancel'; emit();
    const reply = await request({ op: 'cancel-travel', ticket: view.ticket });
    if (mine !== journeyGeneration || life.signal.aborted || !journey) return;
    journey.busy = null;
    if (!applyTravel(reply)) notice = { kind: 'unreachable' };
    emit();
    // A step that may have happened is still being found out; keep asking.
    if (journey.view?.state === 'committing' || journey.view?.state === 'unknown') await walk(mine);
  }

  async function reconcileTravel(): Promise<void> {
    const view = journey?.view;
    if (!journey || !view || journey.busy) return;
    const mine = ++journeyGeneration;
    journey.busy = 'reconcile'; emit();
    const reply = await request({ op: 'reconcile-travel', ticket: view.ticket });
    if (mine !== journeyGeneration || life.signal.aborted || !journey) return;
    journey.busy = null;
    if (!applyTravel(reply)) notice = { kind: 'unreachable' };
    emit();
    await walk(mine);
  }

  /** After a reload or reconnect: the authority's record of where this person stands, and any journey still open. */
  async function restoreJourney(): Promise<void> {
    const reply = await request({ op: 'whereabouts' });
    if (life.signal.aborted || journey || reply?.kind !== 'travel') return;
    const view = reply.value;
    // Home, and nothing outstanding: ordinary life.
    if (view.state === 'committed' && view.to === source.kingdomId) return;
    if (!OPEN_TRAVEL.has(view.state) && view.state !== 'committed') return;
    const kind = view.to === source.kingdomId ? 'return' : 'raid';
    const mine = ++journeyGeneration;
    journey = {
      kind, requestId: ids(), target: view.to, reason: { kind: 'visit' }, view, startedAt: clock(), refusal: null, busy: null,
      destination: kind === 'raid' ? { kingdomId: view.to, founded: true, live: false, classification: 'unknown' } : null,
    };
    if (kind === 'raid') resolve(view.to);
    present(view);
    emit();
    if (OPEN_TRAVEL.has(view.state)) {
      applyTravel(await request({ op: 'reconcile-travel', ticket: view.ticket }));
      emit();
      await walk(mine);
    }
  }

  if (api) {
    api.subscribe(null, reply => { if (!life.signal.aborted) { absorb(reply); emit(); } }, life.signal);
    void refresh();
    void restoreJourney();
  }
  atlas?.subscribe(event => {
    if (event.kind === 'closed') { choosing = false; emit(); return; }
    known.set(event.channel.kingdomId, { channel: event.channel, land: event.land });
    void choosePreview(event.channel.kingdomId);
  }, life.signal);

  return {
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    open() {
      if (status?.viewer !== 'monarch' || status.authority !== 'ready' || busy) return;
      const open = status.open;
      // A raid Twitch holds or may hold is settled through Twitch first.
      if (open && clock() < open.expiresAt && open.state !== 'prepared' && !SETTLED.has(open.state)) return;
      if (!atlas) { notice = { kind: 'no-map' }; emit(); return; }
      choosing = true; notice = null; emit();
      atlas.open(source.kingdomId, life.signal);
    },
    close() { if (choosing) { choosing = false; atlas?.close(); emit(); } },
    preview: choosePreview,
    cancel: close,
    start,
    reconcile,
    join: () => choose(true),
    leave: () => choose(false),
    travel,
    returnHome,
    cancelTravel,
    reconcileTravel,
    dismissJourney() {
      const state = journey?.view?.state;
      if (!journey || (state && OPEN_TRAVEL.has(state))) return;
      // An arrival abroad stays until the walker goes home; a journey home or one that turned back may be put away.
      if (state === 'committed' && journey.kind === 'raid') return;
      ++journeyGeneration; journey = null; emit();
    },
    reconnect() { ports.account?.reconnect(); },
    refresh,
    dispose() { life.abort(); listeners.clear(); if (choosing) atlas?.close(); },
  };
}
