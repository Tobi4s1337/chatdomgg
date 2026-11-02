/**
 * The march call (spec 23 R3, R4, R12, R14; SEAMS §4 `RaidCall` and `RaidJourney`): the small piece that calls people
 * walking in the kingdom to the Raid Gate, holds Twitch's countdown, offers the ride out once Twitch confirms the raid,
 * and walks one person through the gate and home again. It reads the gate controller's snapshot and sends only what
 * that person presses. It never appears on a stream page, and it never offers what the authority would refuse.
 *
 * Everything said here is decided by the pure helpers below, so the words are tested without a page.
 */
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import { createRaidGateController, type GateDestination, type GateSnapshot, type JourneySnapshot, type RaidGateController } from './controller';
import { createHttpRaidGateApi } from './http-api';
import type { AtlasGateHost, GateKingdom, RaidGateApi } from './ports';

// ---- When the piece is there at all ---------------------------------------------------------------------------------

/** A stream page: `/stream`, anything under it, or any route that ends in or passes through a `stream` segment. */
export function isStreamPath(pathname: string): boolean {
  return pathname.split('/').some(segment => segment === 'stream');
}

/**
 * Whether the march call has anything to say to this viewer. Only a signed-in walker or the monarch (as the authority
 * named them) is ever called, only while a gate is gathering, counting down, being checked or has just settled for
 * them, while their own journey is under way, or while a farewell for a gate they saw is due. Never on a stream page.
 * The monarch's own preview counts as an open gate (walkers see the same request as gathering); the monarch's map,
 * grant and lapse states belong to the throne's board, not here.
 */
export function marchCallShows(snapshot: GateSnapshot, pathname: string): boolean {
  if (isStreamPath(pathname)) return false;
  if (snapshot.viewer !== 'walker' && snapshot.viewer !== 'monarch') return false;
  if (snapshot.journey) return true;
  switch (snapshot.phase) {
    case 'gathering': case 'starting': case 'countdown': case 'checking': case 'departed': case 'called-off': case 'refused':
      return snapshot.destination !== null;
    case 'preview':
      return snapshot.viewer === 'monarch' && snapshot.destination !== null;
    case 'quiet':
      return snapshot.farewell !== null && snapshot.farewell.reason !== 'changed';
    default:
      return false;
  }
}

/**
 * News is told once and then the piece goes away: `holdMs` after it first shows (null: until the person puts it away).
 * `lasting` news is keyed by the authority's request ID and stays told across a reload; the rest is remembered for
 * this page only. `ends` says what putting it away means: hiding the piece, or putting the ended journey away in the
 * controller (so the next ride is not held up by it). A journey that ended while its raid is still the gate's news
 * also puts away that raid's ride out, so someone who came home, turned back or chose to stay is not called again.
 */
export type MarchNews = Readonly<{
  key: string; holdMs: number | null; lasting: boolean; ends: 'hide' | 'journey';
  /** Other news put away with this one: a journey that ends puts away the ride out that began it. */
  covers: string | null;
}>;

/** How long plain news stays: long enough to read twice at a glance. */
export const MARCH_NEWS_MS = 14_000;
/** A journey that turned back or was refused offers to try again, so it stays a little longer. */
export const MARCH_SETBACK_MS = 45_000;

export function marchNews(s: GateSnapshot): MarchNews | null {
  const j = s.journey;
  if (j) {
    const key = `journey:${j.kind}:${j.to}:${j.ticket ?? 'none'}:${j.state}:${j.refusal ?? ''}`;
    const covers = s.phase === 'departed' && s.requestId ? `marched:${s.requestId}` : null;
    if (j.refusal || j.state === 'cancelled' || j.state === 'expired' || j.state === 'denied') return { key, holdMs: MARCH_SETBACK_MS, lasting: false, ends: 'journey', covers };
    if (j.state === 'committed' && j.kind === 'return') return { key, holdMs: MARCH_NEWS_MS, lasting: false, ends: 'journey', covers };
    return null;
  }
  const request = s.requestId ?? 'none';
  switch (s.phase) {
    case 'called-off': case 'refused':
      return { key: `${s.phase}:${request}`, holdMs: MARCH_NEWS_MS, lasting: true, ends: 'hide', covers: null };
    case 'departed':
      if (!s.joined) return { key: `departed:${request}`, holdMs: MARCH_NEWS_MS, lasting: true, ends: 'hide', covers: null };
      // A marcher's ride out (or the waiting land's Watch link) stays until they choose; staying home puts it away.
      return { key: `marched:${request}`, holdMs: null, lasting: true, ends: 'hide', covers: null };
    case 'quiet':
      return s.farewell ? { key: `farewell:${s.farewell.reason}:${s.farewell.destination.target.kingdomId}:${s.farewell.joined}`, holdMs: MARCH_NEWS_MS, lasting: false, ends: 'hide', covers: null } : null;
    default:
      return null;
  }
}

// ---- The words ------------------------------------------------------------------------------------------------------

/** Whole seconds left on Twitch's own countdown (from Twitch's `countdownEndsAt`), never below zero; null when unknown. */
export function countdownSeconds(endsAt: number | null, now: number): number | null {
  if (endsAt === null) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** How far through Twitch's countdown the breath still holds, 1 at its start and 0 when it ends. */
export function countdownShare(endsAt: number | null, now: number, countdownMs: number): number {
  if (endsAt === null || countdownMs <= 0) return 0;
  return Math.min(1, Math.max(0, (endsAt - now) / countdownMs));
}

/** The destination as people know it: its kingdom's name, else the channel's, else plainly what it is. */
export function marchDestinationName(destination: GateDestination | null): string {
  if (!destination) return 'a neighbouring kingdom';
  return destination.channel?.kingdomName ?? destination.channel?.displayName ?? (destination.target.founded ? 'a neighbouring kingdom' : 'a live channel');
}

/** The source's monarch, as chat calls them; a host that is not told the channel's login says it plainly. */
export function monarchName(source: GateKingdom): string {
  return source.login || 'The monarch';
}

/** Whether the destination is a founded kingdom, by the authority's own word (the map's land only refines it). */
function founded(destination: GateDestination): boolean {
  return destination.target.founded && destination.land !== 'waiting' && destination.land !== 'edge';
}

/** The party as it really stands: the authority's opted-in count and this viewer's own choice. */
export function marchPartyLine(s: GateSnapshot): string {
  const count = s.optedIn;
  const others = count - (s.joined ? 1 : 0);
  if (count === 0) return 'No one has chosen to march yet. Staying is always fine.';
  if (s.joined) return others <= 0 ? "You're the first to march." : `You and ${others} ${others === 1 ? 'other' : 'others'} are marching.`;
  return `${count === 1 ? 'One walker is' : `${count} walkers are`} marching. Staying is always fine.`;
}

export type MarchTone = 'call' | 'breath' | 'checking' | 'ride' | 'waiting' | 'journey' | 'arrived' | 'news';
export type MarchWords = Readonly<{ eyebrow: string; title: string; detail: string; tone: MarchTone }>;

/**
 * A title begins with a capital when it begins with one of our own plain phrases ("a neighbouring kingdom"). A channel's
 * login keeps the case its owner chose.
 */
function titled(words: MarchWords): MarchWords {
  return /^(a|that) /u.test(words.title) ? { ...words, title: words.title.charAt(0).toUpperCase() + words.title.slice(1) } : words;
}

/** The whole of what the piece says, for one snapshot at one moment. */
export function marchWords(s: GateSnapshot, now: number): MarchWords {
  return titled(saidNow(s, now));
}

function saidNow(s: GateSnapshot, now: number): MarchWords {
  if (s.journey) return journeyWords(s, s.journey);
  const where = marchDestinationName(s.destination);
  const monarch = s.viewer === 'monarch';
  const ride = monarch ? `You ride to ${where}` : `${monarchName(s.source)} rides to ${where}`;
  const party = () => s.farewell?.reason === 'changed' && !s.joined
    ? `The call to ${marchDestinationName(s.farewell.destination)} ended, so your choice to march ended with it. Join again if you'd like to come.`
    : marchPartyLine(s);
  switch (s.phase) {
    case 'gathering': case 'preview':
      return { eyebrow: 'The gate is open', title: ride, detail: party(), tone: 'call' };
    case 'starting':
      return { eyebrow: 'The gate is opening', title: ride, detail: monarch ? 'Asking Twitch to start the raid…' : 'Twitch is being asked to start the raid. Nobody has left.', tone: 'call' };
    case 'countdown': {
      const left = countdownSeconds(s.countdownEndsAt, now) ?? 0;
      return left > 0
        ? { eyebrow: 'Twitch counts down', title: ride, detail: `The party sets out when Twitch confirms the raid. ${marchPartyLine(s)}`, tone: 'breath' }
        : { eyebrow: 'Twitch counts down', title: ride, detail: "Twitch's countdown has ended. Waiting for Twitch to confirm the raid.", tone: 'breath' };
    }
    case 'checking':
      return {
        eyebrow: `The road to ${where}`, title: 'Checking whether the raid began', tone: 'checking',
        detail: s.checking === 'countdown'
          ? "Twitch's countdown ended, but the raid hasn't been seen on Twitch yet. Nobody has left, and staying home is always fine."
          : "We haven't seen the raid begin on Twitch yet. Nobody has left, and nothing is sent to Twitch twice.",
      };
    case 'departed': {
      const destination = s.destination;
      if (s.canTravel) return { eyebrow: 'Twitch confirmed the raid', title: `The party rides out for ${where}`, detail: `You stay home until ${where} is ready for you. Your door here is kept.`, tone: 'ride' };
      if (s.joined && destination && !founded(destination)) {
        return { eyebrow: 'Twitch confirmed the raid', title: `${destination.channel?.displayName ?? 'That channel'} has no kingdom yet`, detail: 'The raid landed on Twitch. There is no world to walk into there yet, so you stay home.', tone: 'waiting' };
      }
      if (s.joined) return { eyebrow: 'Twitch confirmed the raid', title: `The party rides out for ${where}`, detail: 'The raid landed on Twitch.', tone: 'news' };
      return {
        eyebrow: 'Twitch confirmed the raid', title: `The party rode out for ${where}`, tone: 'news',
        detail: s.optedIn === 0 ? 'Nobody chose to march this time; the raid rode on Twitch.'
          : `${s.optedIn === 1 ? 'One walker' : `${s.optedIn} walkers`} marched. You stayed home, and your door is right where you left it.`,
      };
    }
    case 'called-off':
      return { eyebrow: 'The gate is closed', title: 'The raid was called off', detail: `Twitch confirmed the raid to ${where} was called off. Nobody left, and everyone is home.`, tone: 'news' };
    case 'refused':
      return { eyebrow: 'The gate is closed', title: "Twitch didn't start the raid", detail: `Nothing left ${s.source.name}, and everyone is home.`, tone: 'news' };
    default: {
      const farewell = s.farewell;
      if (!farewell) return { eyebrow: `The gate of ${s.source.name}`, title: 'The gate is quiet', detail: 'Nobody travels unless they choose to.', tone: 'news' };
      const away = marchDestinationName(farewell.destination);
      const choice = farewell.joined ? ', and your choice to march ended with it' : '';
      return farewell.reason === 'lapsed'
        ? { eyebrow: 'The gate is closed', title: 'The call has ended', detail: `The call to ${away} ran out before the gate opened. Nobody left${choice}.`, tone: 'news' }
        : { eyebrow: 'The gate is closed', title: 'The gate has closed', detail: `${monarchName(s.source)} closed the gate before the ride to ${away}. Nobody left${choice}.`, tone: 'news' };
    }
  }
}

function journeyNames(s: GateSnapshot, j: JourneySnapshot): Readonly<{ leaving: string; going: string }> {
  const away = j.destination ? marchDestinationName(j.destination) : 'that kingdom';
  return j.kind === 'return' ? { leaving: away, going: s.source.name } : { leaving: s.source.name, going: away };
}

const REFUSALS = {
  full: (going: string) => `${going} has no room right now. Nobody was moved and nothing was held.`,
  unauthorized: (going: string, leaving: string) => `${going} isn't admitting you right now. You never left ${leaving}.`,
  unavailable: (going: string) => `${going} can't be reached right now. Nothing moved.`,
  stale: (_going: string, leaving: string) => `That journey has moved on. You're still in ${leaving}.`,
  invalid: () => "That journey didn't look right, so nothing moved.",
} as const;

function journeyWords(s: GateSnapshot, j: JourneySnapshot): MarchWords {
  const { leaving, going } = journeyNames(s, j);
  const eyebrow = j.kind === 'return' ? 'The way home' : 'Through the gate';
  if (j.refusal) {
    return { eyebrow, title: j.refusal === 'full' ? `${going} is full right now` : `You're still in ${leaving}`, detail: REFUSALS[j.refusal](going, leaving), tone: 'news' };
  }
  switch (j.state) {
    case 'asking':
      return { eyebrow, title: j.kind === 'return' ? 'Setting out for home' : `Setting out for ${going}`, detail: `Asking ${going} for a place. You're still in ${leaving}.`, tone: 'journey' };
    case 'reserved':
      return { eyebrow, title: j.kind === 'return' ? 'Setting out for home' : `Setting out for ${going}`, detail: `${going} holds a place for you. You're still in ${leaving} until you step through.`, tone: 'journey' };
    case 'preparing':
      return j.overrun
        ? { eyebrow, title: `${going} is still drawing its world`, detail: `It's taking longer than usual. The road holds, and you're still in ${leaving} until it's ready.`, tone: 'journey' }
        : { eyebrow, title: `${going} draws its world`, detail: `You're still in ${leaving} until you step through.`, tone: 'journey' };
    case 'ready': case 'committing':
      return { eyebrow, title: 'Stepping through the gate', detail: `${going} is ready for you.`, tone: 'journey' };
    case 'unknown':
      return { eyebrow, title: 'Confirming where you stand', detail: `Your step is being confirmed with ${going}. You stand in exactly one place, and nothing will move you twice.`, tone: 'checking' };
    case 'committed':
      if (j.kind === 'return') return { eyebrow, title: `Home in ${going}`, detail: 'Your door is right where you left it.', tone: 'news' };
      return {
        eyebrow: `Arrived in ${going}`, tone: 'arrived', detail: `Your home in ${s.source.name} waits, exactly as you left it.`,
        title: j.role === 'monarch' ? `You're on your own throne in ${going}` : j.role === 'citizen' ? `You're at your own door in ${going}` : `You stand at ${going}'s gate as a visitor`,
      };
    case 'cancelled':
      return { eyebrow, title: 'You turned back', detail: `You never left ${leaving}, and nothing moved.`, tone: 'news' };
    case 'expired':
      return { eyebrow, title: 'The held place lapsed', detail: `${going} held a place for you, but it lapsed before you stepped through. You never left ${leaving}.`, tone: 'news' };
    case 'denied':
      return { eyebrow, title: `${going} couldn't take you`, detail: `You never left ${leaving}, and your door is where you left it.`, tone: 'news' };
  }
}

/** A refusal or a lost answer, said plainly and briefly in the piece. */
export function marchNotice(s: GateSnapshot): string | null {
  const notice = s.notice;
  if (!notice) return null;
  if (notice.kind === 'unreachable') return "Couldn't reach the gatekeeper. Nothing changed.";
  if (notice.kind !== 'denied') return null;
  switch (notice.code) {
    case 'stale': return 'That gate has moved on. This is where it stands now.';
    case 'full': return 'That kingdom is full right now. Nobody was moved.';
    case 'unavailable': return "That kingdom can't be reached right now. Nothing moved.";
    case 'unauthorized': return "That isn't open to you right now. Nothing changed.";
    case 'invalid': return "That request didn't look right, so nothing was sent.";
  }
}

// ---- What may be pressed -------------------------------------------------------------------------------------------

export type MarchAction =
  /** Join or leave the gathering party (the authority accepts both while the gate gathers or Twitch holds the raid). */
  | 'join' | 'leave'
  /** Follow the witnessed raid through the gate. */
  | 'ride'
  /** Put the ride away and stay home; nothing is sent. */
  | 'stay'
  /** A normal link to the destination on Twitch, opened only by the person. */
  | 'watch'
  | 'turn-back' | 'check' | 'return'
  /** Ask the full destination again, or try the gate again after turning back. */
  | 'again'
  /** Put away an ended journey or a piece of news. */
  | 'done';

/** The controller would let this viewer follow the party, once any ended journey is put away. */
function couldRide(s: GateSnapshot): boolean {
  return s.phase === 'departed' && s.joined && s.raid !== null && s.destination !== null && s.destination.target.founded;
}

const TURNABLE = new Set(['reserved', 'preparing', 'ready']);

/** What this viewer may press now, in order. Only what the controller and the authority would carry out. */
export function marchActions(s: GateSnapshot): readonly MarchAction[] {
  const j = s.journey;
  if (j) {
    if (j.refusal) return j.refusal === 'full' && j.kind === 'raid' && couldRide(s) ? ['again', 'done'] : ['done'];
    switch (j.state) {
      case 'asking': case 'committing': return [];
      case 'reserved': case 'preparing': case 'ready': return j.ticket !== null && TURNABLE.has(j.state) ? ['turn-back'] : [];
      case 'unknown': return ['check'];
      case 'committed':
        if (j.kind === 'return') return ['done'];
        return [...(j.arrivalId !== null ? ['return' as const] : []), ...(j.destination?.channel ? ['watch' as const] : [])];
      case 'cancelled': case 'expired': case 'denied':
        return j.kind === 'raid' && couldRide(s) ? ['again', 'done'] : ['done'];
    }
  }
  switch (s.phase) {
    case 'gathering': case 'preview': case 'starting': case 'countdown': case 'checking':
      return [s.joined ? 'leave' : 'join'];
    case 'departed':
      if (s.canTravel) return ['ride', 'stay'];
      if (s.joined && s.destination && !founded(s.destination)) return [...(s.destination.channel ? ['watch' as const] : []), 'stay'];
      return ['done'];
    default:
      return ['done'];
  }
}

/** The one thing the walking key answers the gate with: joining, riding out, going home or trying again. Never leaving. */
export function marchPrimary(s: GateSnapshot): MarchAction | null {
  const actions = marchActions(s);
  return (['join', 'ride', 'return', 'again', 'check'] as const).find(action => actions.includes(action)) ?? null;
}

/** Presses `action` on the controller, exactly as its button would. */
export function pressMarch(controller: RaidGateController, action: MarchAction): void {
  switch (action) {
    case 'join': void controller.join(); return;
    case 'ride': void controller.travel(); return;
    case 'return': void controller.returnHome(); return;
    case 'again': controller.dismissJourney(); void controller.travel(); return;
    case 'check': void controller.reconcileTravel(); return;
    default: return;
  }
}

/** A Twitch channel page for a login, for an ordinary link the person opens themselves. */
export function twitchChannelUrl(login: string): string {
  return `https://www.twitch.tv/${encodeURIComponent(login)}`;
}

/** The login a Watch link points at: the destination channel the map named, if it named one. */
export function watchLogin(s: GateSnapshot): string | null {
  return (s.journey?.destination ?? s.destination)?.channel?.login ?? null;
}

// ---- Mounting -------------------------------------------------------------------------------------------------------

export type RaidMarchCallOptions = Readonly<{
  kingdomId: KingdomId;
  source: GateKingdom;
  origin: 'live' | 'simulated';
  signal: AbortSignal;
  /** The gate's authority; defaults to the session-bound HTTP gate at `/api/raid-gate/<kingdomId>`. */
  api?: RaidGateApi;
  /** Names destinations when a map is at hand. Without one, the piece names them as plainly as it can. */
  atlas?: AtlasGateHost | null;
  clock?: () => number;
  /** Where the piece's layer is placed; defaults to the page body. */
  parent?: HTMLElement;
  /** `slot`: the piece flows in a HUD region rather than standing at the foot of the page. */
  placement?: 'page' | 'slot';
  /** Every snapshot, for a host that follows the journey (the journey layer). */
  onSnapshot?: (snapshot: GateSnapshot) => void;
  /** The piece's own element and controller, for a host that moves the piece or presses it from a key. */
  onMount?: (host: HTMLElement, controller: RaidGateController) => void;
  /** The key that answers the gate while walking, shown on the primary button (for example `G`). */
  keyHint?: () => string | null;
}>;

/**
 * Mounts the march call for one kingdom: a gate controller bound to this person's session and the piece in its own
 * fixed layer, loaded the first time there is something to say. Returns a disposer (also run when `signal` aborts).
 * On a stream page it does nothing at all: no controller, no request, no layer.
 */
export function mountRaidMarchCall(options: RaidMarchCallOptions): () => void {
  const pathname = () => globalThis.location?.pathname ?? '/';
  if (options.signal.aborted || isStreamPath(pathname())) return () => undefined;
  const clock = options.clock ?? (() => Date.now());
  const api = options.api ?? createHttpRaidGateApi({ url: `/api/raid-gate/${encodeURIComponent(options.kingdomId)}`, origin: options.origin });
  const controller: RaidGateController = createRaidGateController({ api, atlas: options.atlas ?? null, source: options.source, clock });
  const host = document.createElement('div');
  host.className = 'mc-host';
  host.dataset.place = options.placement ?? 'page';
  (options.parent ?? document.body).append(host);
  options.onMount?.(host, controller);

  let disposed = false;
  let loading = false;
  let unrender: (() => void) | null = null;
  const load = (snapshot: GateSnapshot) => {
    if (disposed || loading || unrender || !marchCallShows(snapshot, pathname())) return;
    loading = true;
    void Promise.all([import('solid-js/web'), import('./MarchCall')]).then(([web, view]) => {
      if (disposed) return;
      unrender = web.render(() => web.createComponent(view.MarchCall, { controller, clock, pathname, ...(options.keyHint ? { keyHint: options.keyHint } : {}) }), host);
    }, error => {
      loading = false;
      console.error('The march call could not be loaded', error);
    });
  };
  const stop = controller.subscribe(snapshot => { load(snapshot); options.onSnapshot?.(snapshot); });
  load(controller.snapshot());
  options.onSnapshot?.(controller.snapshot());

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stop();
    options.signal.removeEventListener('abort', dispose);
    unrender?.();
    controller.dispose();
    host.remove();
  };
  options.signal.addEventListener('abort', dispose, { once: true });
  return dispose;
}
