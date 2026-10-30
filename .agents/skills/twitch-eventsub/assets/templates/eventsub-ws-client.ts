// EventSub WEBSOCKET client — zero dependencies (WHATWG WebSocket: global in Node >= 22 and in browsers/OBS).
//
// Lifecycle handled here (see references/websocket.md for the why):
//   connect → session_welcome (session id) → create subscriptions via Helix within 10 s (user access token!)
//   keepalive watchdog: no frame for keepalive_timeout_seconds (+grace) → connection is dead → fresh connect + resubscribe
//   session_reconnect → open reconnect_url, keep old socket until the NEW socket's welcome, then close old.
//                       Subscriptions carry over automatically — do NOT resubscribe.
//   unexpected close (4000-4007, network) → backoff, fresh connect, resubscribe (events in the gap are lost; no replay)
//   revocation → subscription is gone (authorization_revoked / user_removed / version_removed)
//   notifications are de-duplicated by metadata.message_id and dispatched with full typing.
//
// Run against the Twitch CLI mock (no credentials needed):
//   twitch event websocket start-server -p 8121
//   EVENTSUB_WS_URL=ws://127.0.0.1:8121/ws TWITCH_HELIX_URL=http://127.0.0.1:8121 \
//   TWITCH_CLIENT_ID=x TWITCH_USER_TOKEN=x TWITCH_BROADCASTER_ID=1 TWITCH_USER_ID=1 node eventsub-ws-client.ts
//   twitch event trigger channel.follow --transport=websocket
// Real Twitch: TWITCH_USER_TOKEN = user access token of TWITCH_USER_ID with the scopes your subscriptions need.

import type {
  CreateSubscriptionBody,
  EventSubConditionMap,
  EventSubEnvelope,
  EventSubEventMap,
  EventSubSubscription,
  EventSubType,
  WsMessage,
  WsSession,
} from './types.ts';

export type SubscriptionSpec<T extends EventSubType = EventSubType> = {
  type: T;
  version: string; // see EVENTSUB_VERSIONS in types.ts (e.g. channel.follow → '2')
  condition: EventSubConditionMap[T];
};
type AnySpec = { [T in EventSubType]: SubscriptionSpec<T> }[EventSubType];

export type EventSubWsOptions = {
  clientId: string;
  /** Called before each Helix call so you can refresh expired tokens. Must be a USER access token (app tokens fail). */
  getUserToken: () => string | Promise<string>;
  subscriptions: AnySpec[];
  /** Default wss://eventsub.wss.twitch.tv/ws. CLI mock: ws://127.0.0.1:<port>/ws */
  url?: string;
  /** Base for POST {helixBase}/eventsub/subscriptions. Default https://api.twitch.tv/helix. CLI mock: http://127.0.0.1:<port> */
  helixBase?: string;
  /** 10–600; omitted → Twitch default (10). Larger = fewer keepalives but slower dead-connection detection. */
  keepaliveTimeoutSeconds?: number;
  log?: (msg: string, ...rest: unknown[]) => void;
};

type Handler<T extends EventSubType> = (event: EventSubEventMap[T], sub: EventSubSubscription<T>) => void | Promise<void>;

export class EventSubWsClient {
  private readonly opts: Required<Omit<EventSubWsOptions, 'keepaliveTimeoutSeconds'>> & { keepaliveTimeoutSeconds?: number };
  private ws: WebSocket | null = null; // the socket we currently treat as live
  /** Socket opened for a session_reconnect that hasn't received its welcome yet. */
  private pendingReconnect: WebSocket | null = null;
  private sessionId: string | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private keepaliveMs = 10_000;
  private backoffMs = 1000;
  private stopped = false;
  private readonly seen = new Map<string, number>(); // message_id → expiry (dedupe)
  private readonly handlers = new Map<string, Set<Handler<EventSubType>>>();
  private anyHandlers = new Set<(e: EventSubEnvelope) => void | Promise<void>>();
  onRevocation: (sub: EventSubSubscription) => void = (sub) => this.opts.log(`[eventsub] REVOKED ${sub.type} v${sub.version}: ${sub.status}`);
  onSessionReady: (sessionId: string) => void = () => {};

  constructor(opts: EventSubWsOptions) {
    this.opts = {
      url: 'wss://eventsub.wss.twitch.tv/ws',
      helixBase: 'https://api.twitch.tv/helix',
      log: (m, ...r) => console.log(m, ...r),
      ...opts,
    };
  }

  /** Typed per-type handler: client.on('channel.follow', (e) => e.user_name). Returns an unsubscribe fn. */
  on<T extends EventSubType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as unknown as Handler<EventSubType>);
    return () => set.delete(handler as unknown as Handler<EventSubType>);
  }
  /** Catch-all handler with a discriminated union: switch (e.type) narrows e.event. */
  onAny(handler: (e: EventSubEnvelope) => void | Promise<void>): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  start(): void {
    this.stopped = false;
    this.open(this.withKeepalive(this.opts.url), false);
  }

  stop(): void {
    this.stopped = true;
    this.clearWatchdog();
    this.ws?.close(1000, 'client stop');
    this.pendingReconnect?.close(1000, 'client stop');
    this.ws = null;
    this.pendingReconnect = null;
  }

  // ------------------------------------------------------------------ connection handling
  private withKeepalive(url: string): string {
    if (!this.opts.keepaliveTimeoutSeconds) return url;
    const u = new URL(url);
    u.searchParams.set('keepalive_timeout_seconds', String(this.opts.keepaliveTimeoutSeconds));
    return u.toString();
  }

  /** @param isReconnect true when following a session_reconnect (subscriptions carry over). */
  private open(url: string, isReconnect: boolean): void {
    const ws = new WebSocket(url);
    const previous = this.ws;
    if (!isReconnect) this.ws = ws; // for a reconnect, `ws` becomes current only after its welcome
    else this.pendingReconnect = ws;

    ws.onmessage = (ev: MessageEvent) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(String(ev.data)) as WsMessage;
      } catch {
        return;
      }
      void this.handleMessage(ws, msg, isReconnect ? previous : null);
    };
    ws.onclose = (ev: { code: number; reason: string }) => this.handleClose(ws, ev.code, ev.reason);
    ws.onerror = () => { /* a close event always follows; handled there */ };
  }

  private async handleMessage(ws: WebSocket, msg: WsMessage, replacing: WebSocket | null): Promise<void> {
    if (ws === this.ws) this.resetWatchdog(); // any frame proves the connection is alive

    switch (msg.metadata.message_type) {
      case 'session_welcome': {
        const session = (msg.payload as { session: WsSession }).session;
        this.keepaliveMs = (session.keepalive_timeout_seconds ?? 10) * 1000;
        this.sessionId = session.id;
        this.backoffMs = 1000;
        if (replacing) {
          // Reconnect flow: the new socket is live → promote it, then close the old one. Do NOT resubscribe.
          this.ws = ws;
          this.pendingReconnect = null;
          replacing.onclose = null; // it may already be closed; either way it's no longer ours
          replacing.close(1000, 'reconnected');
          this.opts.log(`[eventsub] reconnected, session ${session.id} (subscriptions carried over)`);
        } else {
          this.opts.log(`[eventsub] connected, session ${session.id}; subscribing…`);
          await this.subscribeAll(session.id); // must create ≥1 subscription within 10 s or Twitch closes with 4003
        }
        this.resetWatchdog();
        this.onSessionReady(session.id);
        return;
      }
      case 'session_keepalive':
        return;
      case 'session_reconnect': {
        const url = (msg.payload as { session: WsSession }).session.reconnect_url;
        this.opts.log('[eventsub] server asked us to reconnect');
        if (url) this.open(url, true); // use the URL as-is; keep this socket open until the new welcome
        return;
      }
      case 'revocation': {
        this.onRevocation((msg.payload as { subscription: EventSubSubscription }).subscription);
        return;
      }
      case 'notification': {
        if (this.isDuplicate(msg.metadata.message_id)) return;
        const n = msg.payload as { subscription: EventSubSubscription; event?: unknown };
        if (n.event === undefined) {
          // Defensive: the Twitch CLI mock (v1.1.24, `trigger -r authorization_revoked --transport=websocket`)
          // sends revocations framed as message_type "notification" without an event.
          this.onRevocation(n.subscription);
          return;
        }
        const e = { type: n.subscription.type, version: n.subscription.version, event: n.event, subscription: n.subscription } as EventSubEnvelope;
        await this.dispatch(e);
        return;
      }
    }
  }

  private handleClose(ws: WebSocket, code: number, reason: string): void {
    if (ws === this.pendingReconnect) {
      // The reconnect socket died before its welcome. If the old socket is gone too, start over below.
      this.pendingReconnect = null;
      if (this.ws) return;
    } else if (ws !== this.ws) {
      return; // an old socket already replaced during the reconnect flow
    } else {
      this.clearWatchdog();
      this.ws = null;
      this.sessionId = null;
      // Old socket closed while a reconnect is in flight (Twitch closes it ~30 s after session_reconnect):
      // let the pending socket's welcome take over instead of opening a second, duplicate session.
      if (this.pendingReconnect) return;
    }
    if (this.stopped) return;
    const hint: Record<number, string> = {
      4000: 'internal server error', 4001: 'client sent inbound traffic (never send messages!)',
      4002: 'failed ping-pong', 4003: 'connection unused (no subscription within 10 s — check token/scopes)',
      4004: 'reconnect grace time expired', 4005: 'network timeout', 4006: 'network error', 4007: 'invalid reconnect url',
    };
    this.opts.log(`[eventsub] closed ${code} ${hint[code] ?? reason}; reconnecting in ${this.backoffMs} ms (fresh session → resubscribe)`);
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    setTimeout(() => !this.stopped && this.open(this.withKeepalive(this.opts.url), false), delay);
  }

  private resetWatchdog(): void {
    this.clearWatchdog();
    // Twitch: if nothing (notification or keepalive) arrives within keepalive_timeout_seconds, assume the connection is lost.
    this.watchdog = setTimeout(() => {
      this.opts.log('[eventsub] keepalive timeout — connection presumed dead');
      const ws = this.ws;
      if (ws) {
        ws.onclose = null;
        ws.close(); // client-side close; we restart ourselves below
        this.handleClose(ws, 0, 'keepalive timeout');
      }
    }, this.keepaliveMs + 2000);
  }
  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private isDuplicate(id: string): boolean {
    const now = Date.now();
    if (this.seen.size > 5000) for (const [k, exp] of this.seen) if (exp < now) this.seen.delete(k);
    if ((this.seen.get(id) ?? 0) > now) return true;
    this.seen.set(id, now + 10 * 60_000);
    return false;
  }

  private async dispatch(e: EventSubEnvelope): Promise<void> {
    const run = async (f: () => void | Promise<void>) => {
      try { await f(); } catch (err) { this.opts.log(`[eventsub] handler for ${e.type} threw`, err); }
    };
    for (const h of this.handlers.get(e.type) ?? []) await run(() => h(e.event, e.subscription as EventSubSubscription<EventSubType>));
    for (const h of this.anyHandlers) await run(() => h(e));
  }

  // ------------------------------------------------------------------ Helix
  private async subscribeAll(sessionId: string): Promise<void> {
    const results = await Promise.allSettled(this.opts.subscriptions.map((s) => this.createSubscription(s, sessionId)));
    results.forEach((r, i) => {
      const s = this.opts.subscriptions[i]!;
      if (r.status === 'rejected') this.opts.log(`[eventsub] subscribe ${s.type} v${s.version} FAILED: ${String(r.reason)}`);
    });
  }

  private async createSubscription(spec: AnySpec, sessionId: string): Promise<EventSubSubscription> {
    const body: CreateSubscriptionBody = { ...spec, transport: { method: 'websocket', session_id: sessionId } } as CreateSubscriptionBody;
    const res = await fetch(`${this.opts.helixBase}/eventsub/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.opts.getUserToken()}`,
        'Client-Id': this.opts.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    // 202 = created. 409 = same type+condition already exists (on THIS or an older session). 403 = missing scope.
    // 401 = bad/expired token or app token used. 429 = too many subs / cost limit (WebSocket: max_total_cost 10 for unauthorized types).
    if (res.status !== 202) throw new Error(`HTTP ${res.status} ${text}`);
    const sub = (JSON.parse(text) as { data: EventSubSubscription[] }).data[0]!;
    this.opts.log(`[eventsub] subscribed ${sub.type} v${sub.version} (cost ${sub.cost})`);
    return sub;
  }

  /** Test hook: push a `{ subscription, event }` payload (e.g. assets/fixtures/*.json) through dedupe + typed dispatch. */
  async injectNotification(payload: { subscription: EventSubSubscription; event: unknown }, messageId: string = crypto.randomUUID()): Promise<void> {
    if (this.isDuplicate(messageId)) return;
    const n = payload;
    await this.dispatch({ type: n.subscription.type, version: n.subscription.version, event: n.event, subscription: n.subscription } as EventSubEnvelope);
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }
}
