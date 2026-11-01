// The real panel. It reads one thing from the kingdom: the reading of this channel's kingdom
// and this viewer's own card, from the Extension backend on Chatdom, signed with the token
// Twitch's Helper gave this view. The backend decides whose card it is from that verified
// token; the panel never names a person and never treats a Twitch ID as one.
//
// What no service can do yet stays honest: the panel never marks a window lit, never sends a
// world command, never offers the Bits shelf and never borrows the fixture.
import { PANEL_ROUTES, readPanelReading, type PanelCardWire, type PanelReading } from '../../../api/src/public/panel/contracts';
import type { HelperBridge, HelperStatus } from '../helper';
import { passportExtensionTransport } from '../passport/transport';
import { ALL_SECTIONS, type CitizenCard, type Connection, type Home, type Light, type PanelAdapter, type PanelSnapshot, type PassportSource } from '../model';

/** After this long without the Helper's answer, the panel says so instead of waiting silently. */
export const HELPER_PATIENCE_MS = 12_000;
/** A reading is asked again this often while the panel is open, and at once after Twitch refreshes the token. */
export const READING_REFRESH_MS = 5 * 60_000;
/** After a failed reading, the next knock comes this much later (doubling up to the refresh interval). */
const RETRY_MS = 15_000;

export const UNLIT_FROM_PANEL = 'Your window cannot be lit from the panel yet. Chat still counts.';
export const SHARED_NOT_CONFIRMED = 'Twitch connected; the kingdom has not confirmed your light.';

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

/**
 * Only the kingdom could confirm a light, and no panel light service exists yet. What Twitch says
 * about sharing changes the words, never the outcome.
 */
function lightFor(status: HelperStatus): Light {
  if (status.kind === 'absent') return { kind: 'outside-twitch' };
  if (status.kind === 'waiting') return { kind: 'unavailable', twitch: 'unknown' };
  if (!status.loggedIn) return { kind: 'logged-out' };
  return { kind: 'unavailable', twitch: status.shared ? 'shared' : 'unshared' };
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

export function createProductionAdapter(helper: HelperBridge, options: ProductionOptions = {}): PanelAdapter {
  const backend = options.backend === undefined ? null : options.backend;
  const send = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const listeners = new Set<(snapshot: PanelSnapshot) => void>();
  let patient = true, reading: Reading = { kind: 'none' }, disposed = false;
  let request: AbortController | undefined, next: ReturnType<typeof setTimeout> | undefined, retry = RETRY_MS;
  // One passport transport per panel: the token is read at send time, so a refreshed token is used at once.
  const transport = backend ? passportExtensionTransport({ url: `${backend}${PANEL_ROUTES.passport}`, token: helper.token, fetch: send }) : null;
  const passports = new WeakMap<PanelReading, PassportSource>();
  const passport = (current: PanelReading): PassportSource => {
    if (!transport) return { kind: 'unavailable', reason: 'The passport is not reaching the panel yet.' };
    let source = passports.get(current);
    if (!source) {
      const places = new Map<string, string>();
      source = { kind: 'readable', transport, places, disclosure: null, simulated: false };
      passports.set(current, source);
    }
    return source;
  };

  const snapshotFor = (): PanelSnapshot => {
    const status = helper.status();
    const current = reading.kind === 'read' ? reading.reading : reading.kind === 'failed' ? reading.last?.reading ?? null : null;
    const kingdom = current?.kingdom ?? null;
    return {
      source: { kind: 'production', label: null },
      connection: connectionFor(status, patient, reading, Boolean(backend)),
      kingdom: kingdom ? { name: kingdom.name, tier: kingdom.tier, motto: kingdom.motto } : null,
      stream: 'unknown',
      picture: { kind: 'unavailable', reason: 'The kingdom’s picture is not reaching the panel yet.' },
      light: lightFor(status),
      tonight: { kind: 'unavailable', reason: 'Tonight’s moments are not reaching the panel yet.' },
      home: homeFor(status, reading, passport),
      tavern: { kind: 'unavailable', reason: 'The tavern is not reaching the panel yet.' },
      forge: { kind: 'unavailable', reason: 'The forge is not reaching the panel yet.' },
      act: null,
      shelf: { kind: 'hidden' },
      entry: kingdom ? { kind: 'gate', path: kingdom.walk } : { kind: 'none' },
      // No saved choice can reach the panel yet, so every section keeps its designed place (and stays honest when empty).
      sections: ALL_SECTIONS,
    };
  };
  let snapshot = snapshotFor();
  const refresh = () => { snapshot = snapshotFor(); for (const listener of listeners) listener(snapshot); };

  const read = async () => {
    clearTimeout(next);
    request?.abort();
    const token = helper.token();
    if (!backend || !token || disposed) return;
    const controller = new AbortController();
    request = controller;
    try {
      const response = await send(`${backend}${PANEL_ROUTES.reading}`, {
        method: 'POST', signal: controller.signal, mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: '{}',
      });
      const text = response.ok ? await response.text() : '';
      if (controller.signal.aborted) return;
      let body: unknown = null;
      try { body = JSON.parse(text); } catch { body = null; }
      const parsed = response.ok && text.length < 64 * 1024 ? readPanelReading(body) : null;
      if (!parsed) throw new Error('unreadable');
      reading = { kind: 'read', reading: parsed, at: Date.now() };
      retry = RETRY_MS;
      next = setTimeout(() => void read(), READING_REFRESH_MS);
    } catch {
      if (controller.signal.aborted || disposed) return;
      reading = { kind: 'failed', last: reading.kind === 'read' ? reading : reading.kind === 'failed' ? reading.last : null };
      next = setTimeout(() => void read(), retry);
      retry = Math.min(retry * 2, READING_REFRESH_MS);
    } finally {
      if (request === controller) request = undefined;
    }
    refresh();
  };

  let lastToken: string | null = null;
  const unsubscribe = helper.subscribe(() => {
    // Twitch refreshes the token on its own and again after the viewer shares who they are: read again then.
    const token = helper.token();
    if (token && token !== lastToken) { lastToken = token; void read(); }
    refresh();
  });
  const timer = helper.status().kind === 'waiting' ? setTimeout(() => { patient = false; refresh(); }, HELPER_PATIENCE_MS) : undefined;
  if (helper.token()) { lastToken = helper.token(); void read(); }

  return {
    get: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // No panel light service exists to receive this. Nothing is sent and nothing changes.
    requestLight() {},
    // Opening the viewer's own card needs Twitch to say who they are: only then does the token carry their id.
    requestIdentity() {
      // A failed refresh keeps showing the last reading, and its ask to share still works.
      const current = reading.kind === 'read' ? reading.reading : reading.kind === 'failed' ? reading.last?.reading ?? null : null;
      if (current?.viewer.kind === 'unshared') helper.requestIdShare();
    },
    // No crowd-act or Bits delivery service exists: no act or shelf is ever offered, and a call does nothing.
    requestAct() {},
    requestProduct() {},
    dispose() { disposed = true; clearTimeout(timer); clearTimeout(next); request?.abort(); unsubscribe(); listeners.clear(); },
  };
}
