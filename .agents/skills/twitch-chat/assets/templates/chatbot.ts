/**
 * chatbot.ts — zero-dependency Twitch chatbot: EventSub WebSocket (read) + Helix Send Chat Message (write).
 *
 * Run (Node >= 22.18 strips types natively; or use tsx / compile with tsc):
 *   TWITCH_CLIENT_ID=... TWITCH_BOT_USER_TOKEN=... TWITCH_CHANNEL_USER_ID=... node chatbot.ts
 *
 * Env:
 *   TWITCH_CLIENT_ID          (required) your app's client id
 *   TWITCH_BOT_USER_TOKEN     (required) USER access token of the BOT account. Scopes: user:read:chat
 *                              user:write:chat (+ user:bot if you also send with an app token). WebSocket
 *                              subscriptions can only be created with a user token.
 *   TWITCH_CHANNEL_USER_ID    (required) broadcaster id of the channel to join
 *   TWITCH_BOT_USER_ID        (optional) defaults to the user id of TWITCH_BOT_USER_TOKEN (/oauth2/validate)
 *   TWITCH_CLIENT_SECRET      (optional) enables token refresh and app-token sending
 *   TWITCH_BOT_REFRESH_TOKEN  (optional) refresh token for the bot user token
 *   TWITCH_SEND_WITH_APP_TOKEN=1  send via app access token => "Chat Bot" badge. Requires the bot user to have
 *                              authorized your app with user:write:chat + user:bot, AND the broadcaster to have
 *                              authorized channel:bot (or the bot is a moderator). Bot must not be the broadcaster.
 *   BOT_IS_PRIVILEGED=1       bot is broadcaster/moderator/VIP in the channel => 100 msgs/30s instead of 20/30s
 *   COMMAND_PREFIX            default "!"
 *   STATE_FILE                default ./bot-state.json (persisted counters)
 *   EVENTSUB_WS_URL           default wss://eventsub.wss.twitch.tv/ws (Twitch CLI mock: ws://127.0.0.1:8080/ws)
 *   HELIX_BASE                default https://api.twitch.tv/helix (CLI mock: http://127.0.0.1:8080)
 *
 * Twurple equivalent: EventSubWsListener#onChannelChatMessage(broadcaster, bot, handler) +
 * ApiClient#chat.sendChatMessage(broadcaster, text, { replyParentMessageId }) / sendChatMessageAsApp(...).
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type {
  ChatBadge, ChatMessageEvent, ChatNotificationEvent, ChatMessageDeleteEvent, EventSubWsMessage,
  SendChatMessageBody, SendChatMessageResponse, SendChatMessageResult,
} from './chat-types.js';

// =============================================================================================
// 1. Pure helpers (exported for unit tests)
// =============================================================================================

export const MAX_MESSAGE_CHARS = 500; // Send Chat Message: "limited to a maximum of 500 characters"

/** Truncate to 500 characters without splitting surrogate pairs (emoji). */
export function truncateMessage(text: string, max = MAX_MESSAGE_CHARS): string {
  const chars = Array.from(text.replace(/[\r\n]+/g, ' ').trim()); // chat messages are single-line
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
}

export interface ParsedCommand {
  name: string;   // lower-cased, without prefix
  args: string[]; // whitespace-split
  rest: string;   // everything after the command name, trimmed
}

/**
 * Parse "!cmd arg1 arg2". Handles the reply gotcha: when a user replies to a message, Twitch prepends
 * "@parentlogin " to the text, so "!cmd" arrives as "@somebot !cmd". Pass the reply parent login to strip it.
 */
export function parseCommand(text: string, prefix = '!', replyParentLogin?: string | null): ParsedCommand | null {
  let t = text.trim();
  if (replyParentLogin && t.toLowerCase().startsWith('@' + replyParentLogin.toLowerCase())) {
    t = t.slice(replyParentLogin.length + 1).trim();
  }
  if (!t.startsWith(prefix) || t.length <= prefix.length) return null;
  const body = t.slice(prefix.length);
  const m = /^(\S+)\s*([\s\S]*)$/.exec(body);
  if (!m || !m[1]) return null;
  const rest = (m[2] ?? '').trim();
  return { name: m[1].toLowerCase(), args: rest ? rest.split(/\s+/) : [], rest };
}

/** Permission ladder. Higher number = more privileged. */
export const Level = { everyone: 0, subscriber: 1, vip: 2, moderator: 3, broadcaster: 4 } as const;
export type LevelName = keyof typeof Level;

/**
 * Derive a permission level from the `badges` array of channel.chat.message. Badges in `badges` are the
 * chatter's badges in the channel of the subscription (broadcaster_user_id). `founder` counts as subscriber.
 */
export function levelFromBadges(badges: ChatBadge[], chatterId?: string, broadcasterId?: string): number {
  if (chatterId && broadcasterId && chatterId === broadcasterId) return Level.broadcaster;
  const sets = new Set(badges.map((b) => b.set_id));
  if (sets.has('broadcaster')) return Level.broadcaster;
  if (sets.has('moderator')) return Level.moderator;
  if (sets.has('vip')) return Level.vip;
  if (sets.has('subscriber') || sets.has('founder')) return Level.subscriber;
  return Level.everyone;
}

/** Sliding-window limiter: at most `limit` events per `windowMs`. */
export class SlidingWindowLimiter {
  private stamps: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) { this.limit = limit; this.windowMs = windowMs; }
  /** ms to wait before the next event is allowed (0 = now). */
  waitTime(now = Date.now()): number {
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    if (this.stamps.length < this.limit) return 0;
    return this.windowMs - (now - (this.stamps[0] ?? now)) + 1;
  }
  record(now = Date.now()): void { this.stamps.push(now); }
}

// ---- Command router -------------------------------------------------------------------------

export interface CommandContext {
  event: ChatMessageEvent;
  cmd: ParsedCommand;
  level: number;
  /** Reply in thread to the triggering message. */
  reply(text: string): void;
  /** Plain message to the channel. */
  say(text: string): void;
  state: BotState;
}

export interface Command {
  name: string;
  aliases?: string[];
  /** Minimum level, default everyone. */
  minLevel?: LevelName;
  /** Per-user cooldown. Moderators+ bypass cooldowns. */
  userCooldownMs?: number;
  /** Global cooldown for this command. */
  globalCooldownMs?: number;
  run(ctx: CommandContext): void | Promise<void>;
}

export interface BotState { counters: Record<string, number> }

export interface RouterOptions {
  prefix: string;
  botUserId: string;
  /** Respond to shared-chat messages that originated in another channel? Default false. */
  handleSharedChatFromOtherChannels?: boolean;
  /** Extra user ids to ignore (other bots) — prevents bot-to-bot loops. */
  ignoreUserIds?: string[];
}

export type DispatchResult =
  | { handled: false; reason: 'own-message' | 'ignored-user' | 'not-a-command' | 'unknown-command' | 'shared-chat' | 'permission' | 'cooldown' }
  | { handled: true; command: string };

export class CommandRouter {
  private readonly commands = new Map<string, Command>();
  private readonly lastUse = new Map<string, number>(); // key: cmd or cmd:user
  private readonly opts: RouterOptions;
  private readonly out: { send(text: string, replyTo?: string): void };
  state: BotState;

  // (No TS parameter properties anywhere: keeps the file runnable with Node's native type stripping.)
  constructor(opts: RouterOptions, out: { send(text: string, replyTo?: string): void }, state: BotState = { counters: {} }) {
    this.opts = opts; this.out = out; this.state = state;
  }

  register(cmd: Command): this {
    for (const n of [cmd.name, ...(cmd.aliases ?? [])]) this.commands.set(n.toLowerCase(), cmd);
    return this;
  }

  async dispatch(ev: ChatMessageEvent, now = Date.now()): Promise<DispatchResult> {
    // 1) NEVER react to your own messages: EventSub delivers the bot's own messages too (IRC didn't).
    if (ev.chatter_user_id === this.opts.botUserId) return { handled: false, reason: 'own-message' };
    if (this.opts.ignoreUserIds?.includes(ev.chatter_user_id)) return { handled: false, reason: 'ignored-user' };
    // 2) Shared chat: messages from the other channels in the session are mirrored into this channel.
    if (!this.opts.handleSharedChatFromOtherChannels && ev.source_broadcaster_user_id
        && ev.source_broadcaster_user_id !== ev.broadcaster_user_id) {
      return { handled: false, reason: 'shared-chat' };
    }
    const cmd = parseCommand(ev.message.text, this.opts.prefix, ev.reply?.parent_user_login);
    if (!cmd) return { handled: false, reason: 'not-a-command' };
    const def = this.commands.get(cmd.name);
    if (!def) return { handled: false, reason: 'unknown-command' };

    const level = levelFromBadges(ev.badges, ev.chatter_user_id, ev.broadcaster_user_id);
    if (level < Level[def.minLevel ?? 'everyone']) return { handled: false, reason: 'permission' };

    if (level < Level.moderator) {
      const gKey = def.name, uKey = `${def.name}:${ev.chatter_user_id}`;
      if (def.globalCooldownMs && now - (this.lastUse.get(gKey) ?? -Infinity) < def.globalCooldownMs) return { handled: false, reason: 'cooldown' };
      if (def.userCooldownMs && now - (this.lastUse.get(uKey) ?? -Infinity) < def.userCooldownMs) return { handled: false, reason: 'cooldown' };
      this.lastUse.set(gKey, now); this.lastUse.set(uKey, now);
    }

    await def.run({
      event: ev, cmd, level, state: this.state,
      reply: (t) => this.out.send(t, ev.message_id),
      say: (t) => this.out.send(t),
    });
    return { handled: true, command: def.name };
  }
}

/** Example commands. Replace with your own. */
export function defaultCommands(): Command[] {
  return [
    { name: 'ping', userCooldownMs: 5_000, run: (c) => c.reply('pong') },
    { name: 'hello', aliases: ['hi'], userCooldownMs: 10_000, run: (c) => c.say(`Hey @${c.event.chatter_user_name} HeyGuys`) },
    {
      name: 'dice', globalCooldownMs: 3_000,
      run: (c) => {
        const sides = Math.min(Math.max(Number.parseInt(c.cmd.args[0] ?? '6', 10) || 6, 2), 1000);
        c.reply(`🎲 ${1 + Math.floor(Math.random() * sides)} (d${sides})`);
      },
    },
    {
      name: 'count', minLevel: 'moderator',
      run: (c) => {
        const n = (c.state.counters['count'] ?? 0) + 1;
        c.state.counters['count'] = n;
        c.say(`Count is now ${n}`);
      },
    },
  ];
}

// =============================================================================================
// 2. Auth + Helix
// =============================================================================================

export interface BotConfig {
  clientId: string;
  clientSecret?: string;
  userToken: string;
  refreshToken?: string;
  botUserId: string;
  channelId: string;
  sendWithAppToken: boolean;
  privileged: boolean;
  prefix: string;
  stateFile: string;
  wsUrl: string;
  helixBase: string;
}

export class TwitchAuth {
  private appToken: string | null = null;
  private readonly cfg: BotConfig;
  constructor(cfg: BotConfig) { this.cfg = cfg; }

  get user(): string { return this.cfg.userToken; }

  async validate(): Promise<{ user_id: string; login: string; scopes: string[] }> {
    const r = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${this.cfg.userToken}` } });
    if (r.status === 401 && (await this.refreshUser())) return this.validate();
    if (!r.ok) throw new Error(`token invalid: ${r.status} ${await r.text()}`);
    return (await r.json()) as { user_id: string; login: string; scopes: string[] };
  }

  /** Refresh the user token (needs client secret + refresh token). Persist new tokens in real apps! */
  async refreshUser(): Promise<boolean> {
    if (!this.cfg.clientSecret || !this.cfg.refreshToken) return false;
    const r = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: this.cfg.refreshToken,
        client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret,
      }),
    });
    if (!r.ok) { console.error('[auth] refresh failed', r.status, await r.text()); return false; }
    const j = (await r.json()) as { access_token: string; refresh_token: string };
    this.cfg.userToken = j.access_token;
    this.cfg.refreshToken = j.refresh_token; // refresh tokens rotate — store the new one
    console.log('[auth] user token refreshed');
    return true;
  }

  async app(force = false): Promise<string> {
    if (this.appToken && !force) return this.appToken;
    if (!this.cfg.clientSecret) throw new Error('TWITCH_CLIENT_SECRET required for app access token');
    const r = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
    });
    if (!r.ok) throw new Error(`app token failed: ${r.status} ${await r.text()}`);
    this.appToken = ((await r.json()) as { access_token: string }).access_token;
    return this.appToken;
  }
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

async function helix<T>(cfg: BotConfig, auth: TwitchAuth, method: string, path: string,
  body: unknown, tokenKind: 'user' | 'app' = 'user', retried = false): Promise<{ status: number; data: T | null }> {
  const token = tokenKind === 'app' ? await auth.app() : auth.user;
  const r = await fetch(`${cfg.helixBase}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': cfg.clientId, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401 && !retried) {
    const ok = tokenKind === 'app' ? Boolean(await auth.app(true)) : await auth.refreshUser();
    if (ok) return helix<T>(cfg, auth, method, path, body, tokenKind, true);
  }
  if (r.status === 429 && !retried) {
    // Ratelimit-Reset is a unix epoch (seconds) when the bucket refills.
    const reset = Number(r.headers.get('Ratelimit-Reset') ?? '0') * 1000;
    await sleep(Math.max(1000, reset - Date.now()));
    return helix<T>(cfg, auth, method, path, body, tokenKind, true);
  }
  const text = await r.text();
  if (!r.ok) console.error(`[helix] ${method} ${path} -> ${r.status} ${text}`);
  let data: T | null = null;
  try { data = text ? (JSON.parse(text) as T) : null; } catch { /* non-JSON error body */ }
  return { status: r.status, data };
}

// =============================================================================================
// 3. Rate-limited send queue
// =============================================================================================

export class SendQueue {
  private queue: Array<{ text: string; replyTo?: string }> = [];
  private running = false;
  private readonly global: SlidingWindowLimiter;
  private readonly perChannel: SlidingWindowLimiter | null;
  private lastSent = '';
  private lastSentAt = 0;
  private readonly deliver: (text: string, replyTo?: string) => Promise<SendChatMessageResult | null>;
  private readonly maxQueue: number;

  /**
   * Chat limits (docs: Chat & Chatbots > Rate Limits), per bot USER across all channels:
   *   20 msgs / 30 s normally; 100 / 30 s where the bot is broadcaster, moderator or VIP;
   *   plus 1 msg / s per channel when the bot is NOT broadcaster/mod/VIP.
   * Exceeding them can get the bot's messages ignored for 1 hour, so stay well under.
   */
  constructor(privileged: boolean, deliver: (text: string, replyTo?: string) => Promise<SendChatMessageResult | null>, maxQueue = 50) {
    this.deliver = deliver; this.maxQueue = maxQueue;
    this.global = new SlidingWindowLimiter(privileged ? 90 : 18, 30_000); // keep ~10% headroom
    this.perChannel = privileged ? null : new SlidingWindowLimiter(1, 1_100);
  }

  push(text: string, replyTo?: string): void {
    const msg = truncateMessage(text);
    if (!msg) return;
    if (this.queue.length >= this.maxQueue) this.queue.shift(); // drop oldest instead of growing unbounded
    this.queue.push({ text: msg, replyTo });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const wait = Math.max(this.global.waitTime(), this.perChannel?.waitTime() ?? 0);
        if (wait > 0) { await sleep(wait); continue; }
        const item = this.queue.shift()!;
        // Chat rejects a message identical to your previous one within 30 s (IRC NOTICE msg_duplicate).
        // Common workaround: append an invisible tag character to make it differ.
        if (item.text === this.lastSent && Date.now() - this.lastSentAt < 30_000) {
          item.text = truncateMessage(item.text, MAX_MESSAGE_CHARS - 2) + ' \u{E0000}';
        }
        this.global.record(); this.perChannel?.record();
        const res = await this.deliver(item.text, item.replyTo).catch((e: unknown) => { console.error('[send]', e); return null; });
        this.lastSent = item.text; this.lastSentAt = Date.now();
        if (res && !res.is_sent) console.warn(`[send] dropped: ${res.drop_reason?.code} — ${res.drop_reason?.message}`);
      }
    } finally { this.running = false; }
  }
}

// =============================================================================================
// 4. State persistence (tiny JSON file; swap for SQLite/Redis in production)
// =============================================================================================

export function loadState(file: string): BotState {
  try { return JSON.parse(readFileSync(file, 'utf8')) as BotState; } catch { return { counters: {} }; }
}
export function saveState(file: string, state: BotState): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file); // atomic replace
}

// =============================================================================================
// 5. EventSub WebSocket client
// =============================================================================================

export type ChatHandlers = {
  onMessage?: (ev: ChatMessageEvent) => void;
  onNotification?: (ev: ChatNotificationEvent) => void;
  onDelete?: (ev: ChatMessageDeleteEvent) => void;
  /** Raw passthrough of every notification, e.g. to forward to an overlay relay. */
  onAny?: (subscriptionType: string, event: unknown) => void;
};

/** Handle one parsed EventSub WebSocket frame. Exported so tests can feed fixtures. */
export function makeDispatcher(router: CommandRouter, handlers: ChatHandlers = {}) {
  const seen = new Set<string>(); // EventSub may redeliver: dedupe on metadata.message_id
  return async (msg: EventSubWsMessage): Promise<DispatchResult | null> => {
    if (msg.metadata.message_type !== 'notification') return null;
    if (seen.has(msg.metadata.message_id)) return null;
    seen.add(msg.metadata.message_id);
    if (seen.size > 5000) seen.delete(seen.values().next().value as string);
    const type = msg.metadata.subscription_type ?? msg.payload.subscription?.type ?? '';
    const event = msg.payload.event;
    handlers.onAny?.(type, event);
    switch (type) {
      case 'channel.chat.message': {
        const ev = event as ChatMessageEvent;
        handlers.onMessage?.(ev);
        return router.dispatch(ev);
      }
      case 'channel.chat.notification': handlers.onNotification?.(event as ChatNotificationEvent); return null;
      case 'channel.chat.message_delete': handlers.onDelete?.(event as ChatMessageDeleteEvent); return null;
      default: return null;
    }
  };
}

const CHAT_SUBSCRIPTIONS = [
  'channel.chat.message',
  'channel.chat.notification',
  'channel.chat.message_delete',
  'channel.chat.clear_user_messages',
  'channel.chat.clear',
] as const;

export class EventSubChatClient {
  private ws: WebSocket | null = null;
  private pending: WebSocket | null = null; // session_reconnect socket still waiting for its welcome
  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveMs = 15_000;
  private backoff = 1_000;
  private stopped = false;
  private readonly cfg: BotConfig;
  private readonly auth: TwitchAuth;
  private readonly onFrame: (msg: EventSubWsMessage) => void;

  constructor(cfg: BotConfig, auth: TwitchAuth, onFrame: (msg: EventSubWsMessage) => void) {
    this.cfg = cfg; this.auth = auth; this.onFrame = onFrame;
  }

  start(url = this.cfg.wsUrl, isReconnect = false): void {
    const ws = new WebSocket(url);
    ws.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(String(e.data)) as EventSubWsMessage;
      switch (msg.metadata.message_type) {
        case 'session_welcome': {
          const s = msg.payload.session!;
          this.keepaliveMs = ((s.keepalive_timeout_seconds ?? 10) + 5) * 1000;
          const old = this.ws;
          this.ws = ws;
          this.backoff = 1_000;
          if (isReconnect) {
            // session_reconnect: subscriptions carry over; close the old socket only AFTER the new welcome.
            this.pending = null;
            if (old && old !== ws) { old.onclose = null; old.close(1000); }
          } else {
            // Fresh session: you have ~10 s to subscribe or Twitch closes the socket (4003).
            void this.subscribeAll(s.id);
          }
          console.log(`[eventsub] session ${s.id} (${isReconnect ? 'reconnected' : 'new'})`);
          break;
        }
        case 'session_reconnect':
          this.start(msg.payload.session!.reconnect_url!, true);
          break;
        case 'revocation':
          console.warn('[eventsub] revoked:', msg.payload.subscription?.type, msg.payload.subscription?.status);
          break;
        default:
          this.onFrame(msg);
      }
      if (ws === this.ws) this.armKeepalive(); // ANY message on the live socket counts as liveness
    };
    ws.onclose = (e: { code: number; reason: string }) => {
      if (ws === this.pending) {
        this.pending = null; // reconnect socket died before its welcome
        if (this.ws) return; // old socket still alive → keep using it
      } else if (ws !== this.ws) {
        return; // old socket after a reconnect handover
      } else if (this.pending) {
        // Twitch closes the old socket ~30 s after session_reconnect; the pending socket's welcome takes
        // over. Starting a fresh session here would create duplicate subscriptions (double replies).
        this.ws = null;
        return;
      }
      console.warn(`[eventsub] closed ${e.code} ${e.reason}`);
      if (!this.stopped) this.reconnectFresh();
    };
    ws.onerror = () => { /* onclose follows */ };
    if (isReconnect) this.pending = ws;
    else this.ws = ws;
  }

  stop(): void {
    this.stopped = true;
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.ws?.close(1000);
    this.pending?.close(1000);
  }

  private armKeepalive(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = setTimeout(() => {
      console.warn('[eventsub] keepalive timeout — reconnecting');
      const dead = this.ws;
      this.ws = null; // so its onclose doesn't trigger a second reconnect
      dead?.close(4000);
      this.reconnectFresh();
    }, this.keepaliveMs);
  }

  private reconnectFresh(): void {
    // A dropped (non-reconnect) WebSocket loses all its subscriptions: start a new session + resubscribe.
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 60_000);
    this.ws = null;
    setTimeout(() => { if (!this.stopped) this.start(this.cfg.wsUrl, false); }, delay);
  }

  private async subscribeAll(sessionId: string): Promise<void> {
    for (const type of CHAT_SUBSCRIPTIONS) {
      // Retry transient failures (network, 429, 5xx) a few times — a bot that is connected but never
      // subscribed is silently deaf. Twitch closes the socket (4003) if nothing is subscribed within 10 s.
      for (let attempt = 1; ; attempt++) {
        let status = 0;
        try {
          ({ status } = await helix(this.cfg, this.auth, 'POST', '/eventsub/subscriptions', {
            type, version: '1',
            condition: { broadcaster_user_id: this.cfg.channelId, user_id: this.cfg.botUserId },
            transport: { method: 'websocket', session_id: sessionId },
          }, 'user'));
        } catch (err) {
          console.warn(`[eventsub] subscribe ${type} network error:`, err);
        }
        // 202 = created, 409 = already exists on this session. 403 "subscription missing proper authorization"
        // = banned/timed out, missing scope, or concurrent join limit (100 channels for non-mod,
        // non-channel:bot joins) reached — not retryable, fix the token/scopes.
        const transient = status === 0 || status === 429 || status >= 500;
        if (!transient || attempt >= 3) {
          const log = status === 202 || status === 409 ? console.log : console.error;
          log(`[eventsub] subscribe ${type} -> ${status || 'network error'}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
}

// =============================================================================================
// 6. Wiring
// =============================================================================================

export function configFromEnv(env = process.env): BotConfig {
  const need = (k: string) => { const v = env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
  return {
    clientId: need('TWITCH_CLIENT_ID'),
    clientSecret: env.TWITCH_CLIENT_SECRET,
    userToken: need('TWITCH_BOT_USER_TOKEN'),
    refreshToken: env.TWITCH_BOT_REFRESH_TOKEN,
    botUserId: env.TWITCH_BOT_USER_ID ?? '',
    channelId: need('TWITCH_CHANNEL_USER_ID'),
    sendWithAppToken: env.TWITCH_SEND_WITH_APP_TOKEN === '1',
    privileged: env.BOT_IS_PRIVILEGED === '1',
    prefix: env.COMMAND_PREFIX ?? '!',
    stateFile: env.STATE_FILE ?? './bot-state.json',
    wsUrl: env.EVENTSUB_WS_URL ?? 'wss://eventsub.wss.twitch.tv/ws',
    helixBase: env.HELIX_BASE ?? 'https://api.twitch.tv/helix',
  };
}

export async function main(): Promise<void> {
  const cfg = configFromEnv();
  const auth = new TwitchAuth(cfg);
  const me = await auth.validate();
  cfg.botUserId ||= me.user_id;
  for (const s of ['user:read:chat', 'user:write:chat']) if (!me.scopes.includes(s)) console.warn(`[auth] token lacks ${s}`);
  if (cfg.botUserId === cfg.channelId) console.warn('[auth] bot == broadcaster: works, but never gets the Chat Bot badge');

  const deliver = async (text: string, replyTo?: string): Promise<SendChatMessageResult | null> => {
    const body: SendChatMessageBody = { broadcaster_id: cfg.channelId, sender_id: cfg.botUserId, message: text };
    if (replyTo) body.reply_parent_message_id = replyTo;
    const { data } = await helix<SendChatMessageResponse>(cfg, auth, 'POST', '/chat/messages', body,
      cfg.sendWithAppToken ? 'app' : 'user');
    return data?.data?.[0] ?? null;
  };
  const queue = new SendQueue(cfg.privileged, deliver);
  const state = loadState(cfg.stateFile);
  const router = new CommandRouter({ prefix: cfg.prefix, botUserId: cfg.botUserId },
    { send: (t, r) => queue.push(t, r) }, state);
  for (const c of defaultCommands()) router.register(c);

  let dirty = false;
  setInterval(() => { if (dirty) { saveState(cfg.stateFile, router.state); dirty = false; } }, 5_000).unref();

  const dispatch = makeDispatcher(router, {
    onMessage: (ev) => console.log(`#${ev.broadcaster_user_login} <${ev.chatter_user_login}> ${ev.message.text}`),
    onNotification: (ev) => console.log(`[notice:${ev.notice_type}] ${ev.system_message}`),
  });
  const client = new EventSubChatClient(cfg, auth, (msg) => {
    void dispatch(msg).then((r) => { if (r?.handled) dirty = true; });
  });
  client.start();

  const shutdown = () => { client.stop(); saveState(cfg.stateFile, router.state); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => { console.error(e); process.exit(1); });
}
