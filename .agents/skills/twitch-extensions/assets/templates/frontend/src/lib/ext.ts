/**
 * Shared glue around window.Twitch.ext for every view (panel, overlay, mobile, config, live_config).
 * Requires ../twitch-ext.d.ts (copy assets/templates/twitch-ext.d.ts into src/).
 */

export const ext = window.Twitch.ext;

/** EBS base URL, injected at build time from .env (VITE_EBS_URL). Must be HTTPS + allowlisted. */
export const EBS_URL: string = (import.meta.env.VITE_EBS_URL as string | undefined) ?? 'https://localhost:8081';

/** Query params Twitch appends to the iframe URL (stable for the frame's lifetime). */
export const query: TwitchExtQueryParams = Object.fromEntries(new URLSearchParams(location.search)) as TwitchExtQueryParams;

// ───────────────────────── Auth ─────────────────────────
// Register onAuthorized ONCE and fan out; the helper re-fires it whenever the JWT is refreshed,
// so always read `currentAuth()` at request time instead of caching the first token.

let latestAuth: Twitch.ext.Authorized | null = null;
const authListeners: Array<(auth: Twitch.ext.Authorized) => void> = [];
let resolveFirstAuth!: (auth: Twitch.ext.Authorized) => void;
/** Resolves on the first onAuthorized — nothing that needs channelId/token should run before. */
export const firstAuth = new Promise<Twitch.ext.Authorized>((r) => (resolveFirstAuth = r));

ext.onAuthorized((auth) => {
  const first = latestAuth === null;
  latestAuth = auth;
  if (first) resolveFirstAuth(auth);
  for (const l of authListeners) l(auth);
});

export function currentAuth(): Twitch.ext.Authorized | null {
  return latestAuth;
}

export function onAuth(listener: (auth: Twitch.ext.Authorized) => void): void {
  authListeners.push(listener);
  if (latestAuth) listener(latestAuth);
}

/** True when the viewer is logged in to Twitch (opaque id "U…"); "A…" = anonymous. */
export function isLoggedIn(): boolean {
  return (latestAuth?.userId ?? '').startsWith('U');
}

// ───────────────────────── EBS calls ─────────────────────────

export class EbsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** fetch() your EBS with the current Twitch JWT as Bearer token. */
export async function ebsFetch<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const auth = latestAuth ?? (await firstAuth);
  const res = await fetch(EBS_URL + path, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? res.statusText;
    throw new EbsError(res.status, msg);
  }
  return data as T;
}

/**
 * Call the Twitch API directly from the frontend with the Helix JWT (only endpoints that take a user
 * token and need NO scopes, e.g. Get Users / Get Streams). Limit: 30 req/min per viewer.
 */
export async function helixFetch<T>(pathAndQuery: string): Promise<T> {
  const auth = latestAuth ?? (await firstAuth);
  const res = await fetch(`https://api.twitch.tv/helix${pathAndQuery}`, {
    headers: { 'Client-Id': auth.clientId, Authorization: `Extension ${auth.helixToken}` },
  });
  if (!res.ok) throw new EbsError(res.status, await res.text());
  return (await res.json()) as T;
}

// ───────────────────────── Context & theme ─────────────────────────
// Same single-registration fan-out for onContext. The context we keep is MERGED, because later
// callbacks may only carry what changed.

let mergedContext: Twitch.ext.Context = {};
const contextListeners: Array<(ctx: Twitch.ext.Context, changed: ReadonlyArray<keyof Twitch.ext.Context>) => void> = [];

ext.onContext((context, changed) => {
  mergedContext = { ...mergedContext, ...context };
  for (const l of contextListeners) l(mergedContext, changed);
});

export function onContextChange(
  listener: (ctx: Twitch.ext.Context, changed: ReadonlyArray<keyof Twitch.ext.Context>) => void,
): void {
  contextListeners.push(listener);
}

/** Mirror the viewer's Twitch theme onto <html data-theme="light|dark"> (CSS does the rest). */
export function syncTheme(): void {
  onContextChange((ctx) => {
    if (ctx.theme && document.documentElement.dataset.theme !== ctx.theme) {
      document.documentElement.dataset.theme = ctx.theme;
    }
  });
}

// ───────────────────────── PubSub ─────────────────────────

/** listen() with JSON parsing; returns an unsubscribe function (unlisten needs the same fn object). */
export function listenJson<T>(target: Twitch.ext.ListenTarget, onMessage: (msg: T) => void): () => void {
  const cb: Twitch.ext.PubSubCallback = (_target, _contentType, message) => {
    try {
      onMessage(JSON.parse(message) as T);
    } catch {
      console.warn('Ignoring non-JSON PubSub message', message);
    }
  };
  ext.listen(target, cb);
  return () => ext.unlisten(target, cb);
}

// ───────────────────────── Configuration service ─────────────────────────

export interface PollConfig {
  question: string;
  options: string[];
}

/** Bump when PollConfig's shape changes; also enter it in "Required Configurations" if you require config. */
export const CONFIG_VERSION = '1';

function parsePollConfig(content: string | undefined): PollConfig | null {
  if (!content) return null;
  try {
    const raw = JSON.parse(content) as Partial<PollConfig>;
    // Validate before use (policy 2.7: never inject unvalidated data). Render with textContent only.
    if (typeof raw.question !== 'string' || !Array.isArray(raw.options)) return null;
    const options = raw.options.filter((o): o is string => typeof o === 'string').slice(0, 4);
    return options.length >= 2 ? { question: raw.question.slice(0, 120), options } : null;
  } catch {
    return null;
  }
}

/** Calls back with the broadcaster's PollConfig (or null) once config arrives and on every later change. */
export function onPollConfig(cb: (cfg: PollConfig | null) => void): void {
  ext.configuration.onChanged(() => cb(parsePollConfig(ext.configuration.broadcaster?.content)));
}

/** Broadcaster-only (config / live_config views): write the broadcaster segment (max 5 KB). */
export function savePollConfig(cfg: PollConfig): void {
  const content = JSON.stringify(cfg);
  if (new TextEncoder().encode(content).length > 5 * 1024) throw new Error('Config exceeds 5 KB');
  ext.configuration.set('broadcaster', CONFIG_VERSION, content);
}

// ───────────────────────── DOM helpers ─────────────────────────

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

/** Safe text rendering — never use innerHTML with data from config, PubSub or your EBS. */
export function setText(id: string, text: string): void {
  $(id).textContent = text;
}

export interface PollState {
  type: 'poll_state';
  version: number;
  tallies: number[];
}
