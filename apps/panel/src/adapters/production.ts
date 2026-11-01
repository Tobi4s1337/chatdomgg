// Verified panel transport. Tokens stay in request headers and memory only.
import { PANEL_ROUTES, readPanelReading, type PanelCardWire, type PanelReading } from '../../../api/src/public/panel/contracts';
import type { HelperBridge, HelperStatus } from '../helper';
import { passportExtensionTransport } from '../passport/transport';
import { ALL_SECTIONS, type CitizenCard, type Connection, type Home, type Light, type PanelAdapter, type PanelSnapshot, type PassportSource, type Picture } from '../model';

/** After this long without the Helper's answer, the panel says so instead of waiting silently. */
export const HELPER_PATIENCE_MS = 12_000;
/** A reading is asked again this often while the panel is open, and at once after Twitch refreshes the token. */
export const READING_REFRESH_MS = 60_000;
/** After a failed reading, the next knock comes this much later (doubling up to the refresh interval). */
const RETRY_MS = 15_000;

export const KINGDOM_REFRESH_MS = 5_000;

export interface ProductionOptions {
  /** The Extension backend's origin (`https://chatdom.io`). Without one, nothing is ever sent. */
  readonly backend?: string | null;
  readonly fetch?: typeof fetch;
}

/** The backend this zip was built for. Twitch's CSP allows it only once it is on the extension's allowlist. */
export const BACKEND_ORIGIN: string | null = (() => {
  const configured = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_CHATDOM_ORIGIN;
  return configured === undefined ? 'https://chatdom.io' : configured || null;
})();

type Reading = { kind: 'none' } | { kind: 'read'; reading: PanelReading; at: number } | { kind: 'failed'; last: Extract<Reading, { kind: 'read' }> | null };

function connectionFor(status: HelperStatus, patient: boolean, reading: Reading, backend: boolean): Connection {
  if (status.kind === 'absent') return { kind: 'outside-twitch' };
  if (status.kind === 'waiting') return patient ? { kind: 'knocking' } : { kind: 'no-answer' };
  if (!backend) return { kind: 'kingdom-unavailable' };
  if (reading.kind === 'read') return { kind: 'connected' };
  if (reading.kind === 'failed' && reading.last) return { kind: 'lost', asOf: timeWords(reading.last.at) };
  return reading.kind === 'failed' ? { kind: 'kingdom-unavailable' } : { kind: 'knocking' };
}

const timeWords = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function lightFor(status: HelperStatus): Light {
  if (status.kind === 'absent') return { kind: 'outside-twitch' };
  if (status.kind === 'waiting') return { kind: 'unavailable', twitch: 'unknown' };
  if (!status.loggedIn) return { kind: 'logged-out' };
  return status.shared ? { kind: 'unavailable', twitch: 'shared' } : { kind: 'unshared' };
}

const cardOf = (wire: PanelCardWire): CitizenCard => ({ ...wire, portrait: null, worn: [] });

function homeFor(status: HelperStatus, reading: Reading, passport: (reading: PanelReading) => PassportSource): Home {
  if (status.kind === 'absent') return { kind: 'unknown', reason: 'Your home card opens on Twitch.' };
  const current = reading.kind === 'read' ? reading.reading : reading.kind === 'failed' ? reading.last?.reading ?? null : null;
  if (status.kind === 'waiting' || !current) {
    return { kind: 'unknown', reason: reading.kind === 'failed' ? 'The kingdom is not answering the panel right now. Your card will be back.' : 'Your home card is on its way.' };
  }
  const name = current.kingdom?.name ?? 'this kingdom';
  const viewer = current.viewer;
  switch (viewer.kind) {
    case 'anonymous': return { kind: 'unknown', reason: 'Log in to Twitch to see your citizen card.' };
    case 'unshared': return { kind: 'unknown', reason: `Your citizen card in ${name} is waiting. Share who you are with Chatdom to open it.`, ask: 'share' };
    case 'unknown': return { kind: 'unknown', reason: viewer.reason };
    case 'citizen': return {
      kind: 'citizen', street: viewer.home.street, place: viewer.home.place, description: viewer.home.description,
      displayName: viewer.card.name, picture: { kind: 'unavailable', reason: 'Your home’s picture is not painted yet.' },
      tenure: { kind: 'known', since: viewer.home.since }, history: [], card: cardOf(viewer.card), passport: passport(current),
    };
    case 'guest': return { kind: 'guest', displayName: viewer.card.name, history: [], card: cardOf(viewer.card), passport: passport(current) };
    case 'newcomer': return {
      kind: 'known', card: cardOf(viewer.card), passport: passport(current),
      note: `No home in ${name} yet. Say something in chat while the stream is live, and the kingdom raises one for you.`,
    };
    case 'monarch': return {
      kind: 'known', card: cardOf(viewer.card), passport: passport(current),
      note: `${name} is yours. Your home is the castle, and every lit window is someone who came for you.`,
    };
  }
}

interface KingdomWire {
  readonly version: 1;
  readonly status: 'kingdom' | 'unfounded';
  readonly stream: 'live' | 'resting';
  readonly lights: number | null;
  readonly moment: string | null;
  readonly picture: { readonly capturedAt: number; readonly revision: string; readonly kind: 'realm' | 'sketch' } | null;
  readonly pledges: string | null;
}
type Claim = 'deed' | 'guest' | 'castle' | 'unfounded' | 'held' | 'unavailable';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const words = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(value);
function kingdomWire(value: unknown): KingdomWire | null {
  if (!object(value) || value.version !== 1 || !['kingdom', 'unfounded'].includes(String(value.status)) || !['live', 'resting'].includes(String(value.stream))) return null;
  if (value.lights !== null && !(Number.isSafeInteger(value.lights) && Number(value.lights) >= 0)) return null;
  if (value.moment !== null && !words(value.moment, 280)) return null;
  if (value.pledges !== null && !words(value.pledges, 120)) return null;
  if (value.picture !== null && (!object(value.picture) || !Number.isSafeInteger(value.picture.capturedAt) || Number(value.picture.capturedAt) < 0 || Number(value.picture.capturedAt) > 8.64e15 || !words(value.picture.revision, 160) || !['realm', 'sketch'].includes(String(value.picture.kind)))) return null;
  return value as unknown as KingdomWire;
}

export function createProductionAdapter(helper: HelperBridge, options: ProductionOptions = {}): PanelAdapter {
  const backend = options.backend ?? null;
  const send = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const listeners = new Set<(snapshot: PanelSnapshot) => void>();
  const requests = new Set<AbortController>();
  let presenceRequest: AbortController | undefined;
  let patient = true, reading: Reading = { kind: 'none' }, disposed = false;
  let kingdom: KingdomWire | null = null, kingdomLost = false, kingdomAt = 0;
  let picture: Picture = { kind: 'unavailable', reason: 'The kingdom’s picture is on its way.' };
  let pictureRevision: string | null = null, pictureUrl: string | null = null;
  let light: Light | null = null, claimed: Claim | null = null;
  let queued: { token: string | null; authorization: number | undefined } | null = null;
  let readingTimer: ReturnType<typeof setTimeout> | undefined, kingdomTimer: ReturnType<typeof setTimeout> | undefined;
  let retry = RETRY_MS, readingBusy = false, readingAgain = false, kingdomBusy = false, actionBusy = false, presenceBusy = false;
  let epoch = 0, presenceSent = false;
  const visible = () => !disposed && helper.visible?.() !== false && (typeof document === 'undefined' || !document.hidden);
  // A bridge without playback evidence cannot send presence.
  const active = () => visible() && helper.active?.() === true;
  const shared = () => { const status = helper.status(); return status.kind === 'authorized' && status.loggedIn && status.shared; };
  const currentReading = () => reading.kind === 'read' ? reading.reading : reading.kind === 'failed' ? reading.last?.reading ?? null : null;
  const transport = backend ? passportExtensionTransport({ url: `${backend}${PANEL_ROUTES.passport}`, token: helper.token, fetch: send }) : null;
  const passports = new WeakMap<PanelReading, PassportSource>();
  const passport = (current: PanelReading): PassportSource => {
    if (!transport) return { kind: 'unavailable', reason: 'The passport is not reaching the panel yet.' };
    let source = passports.get(current);
    if (!source) { source = { kind: 'readable', transport, places: new Map<string, string>(), disclosure: null, simulated: false }; passports.set(current, source); }
    return source;
  };
  const currentLight = (): Light => {
    const status = helper.status();
    if (status.kind !== 'authorized' || !status.loggedIn) return lightFor(status);
    if (!status.shared && light?.kind !== 'pending' && light?.kind !== 'refused') return lightFor(status);
    if (light?.kind === 'pending' || light?.kind === 'held' || light?.kind === 'refused') return light;
    if (kingdomLost) return kingdomAt ? { kind: 'out-of-reach', asOf: timeWords(kingdomAt) } : { kind: 'unavailable', twitch: 'shared' };
    if (kingdom?.status === 'unfounded') return { kind: 'unfounded', pledged: light?.kind === 'unfounded' && light.pledged, band: light?.kind === 'unfounded' ? light.band : kingdom.pledges };
    if (kingdom?.stream === 'resting') return { kind: 'resting', choice: 'named' };
    if (!light && status.shared && currentReading()?.viewer.kind === 'newcomer') return { kind: 'ready' };
    return light ?? lightFor(status);
  };
  const snapshotFor = (): PanelSnapshot => {
    const status = helper.status(), current = currentReading(), realm = current?.kingdom ?? null;
    const connection = kingdomLost ? kingdomAt ? { kind: 'lost' as const, asOf: timeWords(kingdomAt) } : { kind: 'kingdom-unavailable' as const } : connectionFor(status, patient, reading, Boolean(backend));
    return {
      source: { kind: 'production', label: null }, connection,
      kingdom: realm ? { name: realm.name, tier: realm.tier, motto: realm.motto } : null,
      stream: kingdom?.stream ?? 'unknown', kingdomLights: kingdom?.lights ?? null, moment: kingdom?.moment ?? null,
      picture, light: currentLight(),
      tonight: { kind: 'unavailable', reason: 'Tonight’s chronicle is not reaching the panel yet.' },
      home: homeFor(status, reading, passport),
      tavern: { kind: 'unavailable', reason: 'Walk into the kingdom to visit the tavern.' },
      forge: { kind: 'unavailable', reason: 'Walk into the kingdom to visit the forge.' },
      act: null, shelf: { kind: 'hidden' }, entry: realm ? { kind: 'gate', path: realm.walk } : { kind: 'none' }, sections: ALL_SECTIONS,
    };
  };
  let snapshot = snapshotFor();
  const refresh = () => { if (!disposed) { snapshot = snapshotFor(); for (const listener of listeners) listener(snapshot); } };
  const request = async <T>(path: string, consume: (response: Response) => Promise<T>, method: 'POST' | 'GET' = 'POST', body: { observe?: boolean } = {}): Promise<T> => {
    const token = helper.token();
    if (!backend || !token || !visible()) throw new Error('unavailable');
    const controller = new AbortController(); requests.add(controller);
    if (path === '/api/panel/v1/presence') presenceRequest = controller;
    try {
      const response = await send(`${backend}${path}`, {
        method, signal: controller.signal, mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), accept: method === 'GET' ? 'image/webp' : 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      });
      if (controller.signal.aborted || !response.ok) throw new Error('unavailable');
      const result = await consume(response);
      if (controller.signal.aborted) throw new Error('unavailable');
      return result;
    } finally { requests.delete(controller); if (presenceRequest === controller) presenceRequest = undefined; }
  };
  const json = async (path: string, body?: { observe: boolean }): Promise<unknown> => {
    const text = await request(path, response => response.text(), 'POST', body);
    if (text.length > 64 * 1024) throw new Error('unreadable');
    return JSON.parse(text) as unknown;
  };
  const read = async (afterClaim = false) => {
    clearTimeout(readingTimer);
    if (!backend || !helper.token() || !visible()) return;
    if (readingBusy) { readingAgain ||= afterClaim; return; }
    readingBusy = true; const version = epoch;
    try {
      const parsed = readPanelReading(await json(PANEL_ROUTES.reading));
      if (!parsed) throw new Error('unreadable');
      if (version !== epoch || !visible()) return;
      reading = { kind: 'read', reading: parsed, at: Date.now() }; retry = RETRY_MS;
      readingTimer = setTimeout(() => void read(), READING_REFRESH_MS);
      void observe();
    } catch {
      if (version !== epoch || !visible()) return;
      reading = { kind: 'failed', last: reading.kind === 'read' ? reading : reading.kind === 'failed' ? reading.last : null };
      readingTimer = setTimeout(() => void read(), retry); retry = Math.min(retry * 2, READING_REFRESH_MS);
    } finally {
      if (version === epoch) {
        readingBusy = false;
        if (readingAgain) { readingAgain = false; void read(); }
      }
    }
    refresh();
  };
  const loadPicture = async (frame: NonNullable<KingdomWire['picture']>, version: number) => {
    if (pictureRevision === frame.revision) return;
    try {
      const blob = await request('/api/panel/v1/picture', response => response.blob(), 'GET');
      if (!['image/webp', 'image/png', 'image/jpeg'].includes(blob.type) || blob.size > 512 * 1024 || blob.size === 0) throw new Error('unreadable');
      if (version !== epoch || !visible()) return;
      const url = URL.createObjectURL(blob);
      if (pictureUrl) URL.revokeObjectURL(pictureUrl);
      pictureUrl = url; pictureRevision = frame.revision;
      const capturedOn = new Date(frame.capturedAt).toISOString();
      picture = { kind: 'still', url, alt: frame.kind === 'sketch' ? 'The waiting land of this channel.' : 'The kingdom as its people left it.', width: 640, height: 400, portrait: null,
        provenance: { origin: frame.kind, caption: frame.kind === 'sketch' ? 'Waiting land' : `Painted at ${timeWords(frame.capturedAt)}`, capturedOn } };
      refresh();
    } catch { /* A previous authenticated painting may stay visible with its captured time. */ }
  };
  const confirm = (claim: Claim, lit: boolean) => {
    claimed = claim;
    if (claim === 'held') light = { kind: 'held' };
    else if (claim === 'unfounded') light = { kind: 'unfounded', pledged: false, band: kingdom?.pledges ?? null };
    else if (lit && ['deed', 'guest', 'castle'].includes(claim)) light = { kind: 'lit', choice: 'named', as: claim === 'deed' ? 'citizen' : claim as 'guest' | 'castle', by: 'realm' };
    else light = { kind: 'unavailable', twitch: 'shared' };
  };
  const observe = async () => {
    if (presenceSent || presenceBusy || actionBusy || !currentReading() || !backend || !shared() || !active() || kingdom?.status !== 'kingdom' || kingdom.stream !== 'live' || claimed === 'held') return;
    const viewer = currentReading()?.viewer.kind;
    if (!['deed', 'guest', 'castle'].includes(claimed ?? '') && !['citizen', 'guest', 'monarch'].includes(viewer ?? '')) return;
    presenceBusy = true; presenceSent = true; const version = epoch;
    try {
      const answer = await json('/api/panel/v1/presence');
      if (version !== epoch || !shared() || !active()) return;
      if (object(answer) && answer.status === 'held') { confirm('held', false); refresh(); return; }
      if (!object(answer) || answer.status !== 'accepted' || typeof answer.lit !== 'boolean') throw new Error('unreadable');
      if (answer.lit) {
        const claim = claimed ?? (viewer === 'citizen' ? 'deed' : viewer === 'guest' ? 'guest' : viewer === 'monarch' ? 'castle' : null);
        if (claim) confirm(claim, true);
      }
    } catch { /* Presence has no optimistic outcome. The next open session may retry. */ }
    finally { if (version === epoch) presenceBusy = false; }
    refresh();
  };
  const poll = async () => {
    clearTimeout(kingdomTimer);
    if (!backend || !helper.token() || !visible() || kingdomBusy) return;
    kingdomBusy = true; const version = epoch;
    try {
      const parsed = kingdomWire(await json('/api/panel/v1/kingdom'));
      if (!parsed) throw new Error('unreadable');
      if (version !== epoch || !visible()) return;
      kingdom = parsed; kingdomLost = false; kingdomAt = Date.now();
      if (parsed.stream !== 'live') { presenceSent = false; if (light?.kind === 'lit') light = null; }
      if (parsed.picture) await loadPicture(parsed.picture, version);
      else if (pictureUrl) { URL.revokeObjectURL(pictureUrl); pictureUrl = null; pictureRevision = null; picture = { kind: 'unavailable', reason: 'No painting has arrived yet.' }; }
      void observe();
    } catch { if (version === epoch && visible()) kingdomLost = true; }
    finally {
      if (version === epoch) { kingdomBusy = false; if (visible()) kingdomTimer = setTimeout(() => void poll(), KINGDOM_REFRESH_MS); }
    }
    refresh();
  };
  const claim = async () => {
    if (actionBusy || !backend || !shared() || !visible() || !kingdom) return;
    actionBusy = true; queued = null; const version = epoch;
    light = { kind: 'pending', choice: 'named', step: 'confirming' }; refresh();
    try {
      const answer = kingdom.status === 'unfounded' ? await json('/api/panel/v1/pledge') : await json('/api/panel/v1/light', { observe: active() });
      if (version !== epoch || !shared() || !visible()) return;
      if (object(answer) && answer.status === 'pledged' && words(answer.band, 120)) light = { kind: 'unfounded', pledged: true, band: answer.band };
      else {
        if (!object(answer) || !['deed', 'guest', 'castle', 'unfounded', 'held', 'unavailable'].includes(String(answer.status)) || typeof answer.lit !== 'boolean') throw new Error('unreadable');
        confirm(answer.status as Claim, answer.lit);
        presenceSent = answer.lit;
      }
      void read(true); void poll();
    } catch { if (version === epoch && visible()) light = { kind: 'unavailable', twitch: 'shared' }; }
    finally { if (version === epoch) actionBusy = false; }
    refresh();
  };
  const stop = () => {
    epoch++; clearTimeout(readingTimer); clearTimeout(kingdomTimer);
    for (const controller of requests) controller.abort(); requests.clear();
    readingBusy = false; readingAgain = false; kingdomBusy = false; actionBusy = false; presenceBusy = false; presenceSent = false; queued = null;
    if (light?.kind === 'pending' || light?.kind === 'lit') light = null;
  };
  let lastToken = helper.token(), lastAuthorization = helper.authorization?.(), wasVisible = visible(), wasActive = active(), wasShared = shared();
  const changed = () => {
    if (disposed) return;
    const nowVisible = visible(), nowActive = active(), token = helper.token(), authorization = helper.authorization?.();
    const tokenChanged = token !== lastToken || authorization !== lastAuthorization;
    if (wasActive && !nowActive) { presenceRequest?.abort(); presenceSent = false; }
    if (!nowVisible || !shared()) {
      // Hiding the view or revoking identity cancels its queued gesture.
      if (!nowVisible || (wasShared && !shared())) stop();
      else if (!shared() && light?.kind !== 'pending') { claimed = null; light = null; presenceSent = false; }
    }
    if (wasShared && !shared()) { reading = { kind: 'none' }; claimed = null; light = null; }
    const pending = queued;
    if (tokenChanged && nowVisible) {
      // An identity change invalidates old personal readings and in-flight replies.
      if (!pending) stop();
      else { for (const controller of requests) controller.abort(); epoch++; readingBusy = false; kingdomBusy = false; presenceBusy = false; }
      reading = { kind: 'none' };
      void read(); void poll();
    } else if (nowVisible && !wasVisible) { void read(); void poll(); }
    if (pending && shared() && nowVisible && (authorization !== undefined ? authorization !== pending.authorization : token !== pending.token)) void claim();
    else if (pending && tokenChanged && !shared()) { queued = null; light = { kind: 'refused' }; }
    else if (nowActive && !wasActive) void observe();
    lastToken = token; lastAuthorization = authorization; wasVisible = nowVisible; wasActive = nowActive; wasShared = shared();
    refresh();
  };
  const unsubscribe = helper.subscribe(changed);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', changed);
  const timer = helper.status().kind === 'waiting' ? setTimeout(() => { patient = false; refresh(); }, HELPER_PATIENCE_MS) : undefined;
  if (helper.token()) { void read(); void poll(); }
  return {
    get: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    requestLight() {
      const status = helper.status();
      if (!backend || !visible() || status.kind !== 'authorized' || !status.loggedIn || actionBusy || queued || !kingdom) return;
      if (status.shared) { void claim(); return; }
      queued = { token: helper.token(), authorization: helper.authorization?.() };
      light = { kind: 'pending', choice: 'named', step: 'sharing' }; refresh();
      if (!helper.requestIdShare()) { queued = null; light = { kind: 'refused' }; refresh(); }
    },
    requestIdentity() { if (visible() && currentReading()?.viewer.kind === 'unshared') helper.requestIdShare(); },
    requestAct() {}, requestProduct() {},
    dispose() {
      disposed = true; stop(); clearTimeout(timer); unsubscribe(); listeners.clear();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', changed);
      if (pictureUrl) URL.revokeObjectURL(pictureUrl);
    },
  };
}
