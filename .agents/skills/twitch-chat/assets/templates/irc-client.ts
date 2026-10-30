/**
 * irc-client.ts — minimal Twitch IRC client over Node's global WebSocket (Node >= 22), read-mostly.
 *
 * Use IRC only when it really fits (see references/irc.md): quick read-only overlays/tools for many
 * channels without per-channel authorization, or porting legacy code. New bots: use EventSub + Helix.
 *
 *   TWITCH_IRC_TOKEN=xxxx TWITCH_IRC_LOGIN=mybot node irc-client.ts twitchdev otherchannel
 *
 * Token: USER access token with chat:read (and chat:edit if you send). Sent as `PASS oauth:<token>`.
 * Endpoint: wss://irc-ws.chat.twitch.tv:443 (non-TLS WebSocket was decommissioned 2025-08-15).
 */
import { pathToFileURL } from 'node:url';

// =============================================================================================
// Parsing (pure, exported for tests)
// =============================================================================================

export interface IrcMessage {
  raw: string;
  tags: Record<string, string>;
  /** e.g. "ronni!ronni@ronni.tmi.twitch.tv" or "tmi.twitch.tv" */
  prefix: string | null;
  /** login part of the prefix when it is a user ("ronni"), else null */
  nick: string | null;
  command: string;      // PRIVMSG, USERNOTICE, CLEARCHAT, 001, PING, ...
  params: string[];     // middle params, e.g. ["#dallas"]
  trailing: string | null; // text after " :" (the chat message), null if absent
}

/** IRCv3 tag value unescaping: \: -> ;  \s -> space  \\ -> \  \r -> CR  \n -> LF; other \x -> x; lone trailing \ dropped. */
export function unescapeTagValue(v: string): string {
  let out = '';
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c !== '\\') { out += c; continue; }
    const n = v[++i];
    if (n === undefined) break;
    out += n === ':' ? ';' : n === 's' ? ' ' : n === '\\' ? '\\' : n === 'r' ? '\r' : n === 'n' ? '\n' : n;
  }
  return out;
}

/** Parse one IRC line (without the trailing \r\n). Returns null for empty lines. */
export function parseIrcLine(line: string): IrcMessage | null {
  let rest = line.replace(/\r?\n$/, '');
  if (!rest) return null;
  const raw = rest;
  const tags: Record<string, string> = {};
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    for (const pair of rest.slice(1, sp).split(';')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      tags[key] = eq === -1 ? '' : unescapeTagValue(pair.slice(eq + 1));
    }
    rest = rest.slice(sp + 1).trimStart();
  }
  let prefix: string | null = null;
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1).trimStart();
  }
  let trailing: string | null = null;
  const ti = rest.indexOf(' :');
  if (ti !== -1) { trailing = rest.slice(ti + 2); rest = rest.slice(0, ti); }
  else if (rest.startsWith(':')) { trailing = rest.slice(1); rest = ''; }
  const parts = rest.split(' ').filter(Boolean);
  const command = parts.shift() ?? '';
  const nick = prefix && prefix.includes('!') ? prefix.slice(0, prefix.indexOf('!')) : null;
  return { raw, tags, prefix, nick, command, params: parts, trailing };
}

export interface IrcBadge { set_id: string; id: string }
/** "broadcaster/1,subscriber/12" -> [{set_id:'broadcaster',id:'1'}, ...] (same shape as EventSub badges minus info). */
export function parseBadges(tag: string | undefined): IrcBadge[] {
  if (!tag) return [];
  return tag.split(',').filter(Boolean).map((b) => {
    const i = b.indexOf('/');
    return { set_id: b.slice(0, i), id: b.slice(i + 1) };
  });
}

export interface IrcEmoteRange { id: string; start: number; end: number }
/**
 * "25:0-4,12-16/1902:6-10" -> sorted ranges (inclusive end). Positions index into the message by
 * Unicode code point — use Array.from(text) to slice, not text.slice(). Prefer EventSub fragments.
 */
export function parseEmotes(tag: string | undefined): IrcEmoteRange[] {
  if (!tag) return [];
  const out: IrcEmoteRange[] = [];
  for (const group of tag.split('/')) {
    const [id, ranges] = group.split(':');
    if (!id || !ranges) continue;
    for (const r of ranges.split(',')) {
      const [s, e] = r.split('-').map(Number);
      if (s !== undefined && e !== undefined && Number.isFinite(s) && Number.isFinite(e)) out.push({ id, start: s, end: e });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface IrcGif { start: number; end: number; id: string; url: string }
/**
 * `gifs` tag (added 2026-07): comma-separated "<start>-<end>|<gifID>|<gifURL>". The URL can contain &, = and
 * even commas, so split only where a new "<n>-<n>|" entry begins. Use the URL unmodified.
 */
export function parseGifs(tag: string | undefined): IrcGif[] {
  if (!tag) return [];
  const out: IrcGif[] = [];
  const re = /(\d+)-(\d+)\|([^|]*)\|(.*?)(?=,\d+-\d+\||$)/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) {
    out.push({ start: Number(m[1]), end: Number(m[2]), id: m[3] ?? '', url: m[4] ?? '' });
    if (re.lastIndex < tag.length && tag[re.lastIndex] === ',') re.lastIndex++;
  }
  return out;
}

/** /me messages arrive as "\u0001ACTION text\u0001". */
export function parseAction(text: string): { action: boolean; text: string } {
  const m = /^\u0001ACTION (.*)\u0001$/.exec(text);
  return m ? { action: true, text: m[1] ?? '' } : { action: false, text };
}

// =============================================================================================
// Client
// =============================================================================================

export interface IrcClientOptions {
  /** User access token WITHOUT the "oauth:" prefix. */
  token?: string;
  /** Lowercase login of the token's user. */
  login?: string;
  channels: string[];
  url?: string;
  onMessage?: (msg: IrcMessage) => void;
}

export class TwitchIrcClient {
  private ws: WebSocket | null = null;
  private buffer = '';
  private backoff = 1_000;
  private stopped = false;
  private readonly opts: IrcClientOptions;
  private readonly joined = new Set<string>();

  constructor(opts: IrcClientOptions) { this.opts = opts; }

  connect(): void {
    const ws = new WebSocket(this.opts.url ?? 'wss://irc-ws.chat.twitch.tv:443');
    this.ws = ws;
    ws.onopen = () => {
      // Order matters: CAP first (optional), then PASS before NICK.
      this.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      if (this.opts.token && this.opts.login) {
        this.send(`PASS oauth:${this.opts.token}`);
        this.send(`NICK ${this.opts.login.toLowerCase()}`);
      } else {
        // Anonymous read-only login. NOT documented by Twitch; widely used by overlays. May break anytime.
        this.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      }
    };
    ws.onmessage = (e: MessageEvent) => {
      // One frame can contain several CRLF-delimited lines (and, defensively, a partial one).
      this.buffer += String(e.data);
      const lines = this.buffer.split('\r\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) {
        const msg = parseIrcLine(line);
        if (msg) this.handle(msg);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.stopped) return;
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, 60_000);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  stop(): void { this.stopped = true; this.ws?.close(); }

  /** Read-only by default. Sending requires chat:edit and obeys the same chat rate limits as Helix. */
  say(channel: string, text: string, replyParentMsgId?: string): void {
    const prefix = replyParentMsgId ? `@reply-parent-msg-id=${replyParentMsgId} ` : '';
    this.send(`${prefix}PRIVMSG #${channel.toLowerCase()} :${text.replace(/[\r\n]+/g, ' ')}`);
  }

  private send(line: string): void { this.ws?.send(line + '\r\n'); }

  private async joinAll(): Promise<void> {
    // Join rate limit: 20 JOINs / 10 s per user (normal accounts). Batch and pace.
    const chans = this.opts.channels.map((c) => c.toLowerCase().replace(/^#/, ''));
    for (let i = 0; i < chans.length; i += 20) {
      const batch = chans.slice(i, i + 20);
      this.send(`JOIN ${batch.map((c) => '#' + c).join(',')}`);
      batch.forEach((c) => this.joined.add(c));
      if (i + 20 < chans.length) await new Promise((r) => setTimeout(r, 10_500));
    }
  }

  private handle(msg: IrcMessage): void {
    switch (msg.command) {
      case 'PING': this.send(`PONG :${msg.trailing ?? 'tmi.twitch.tv'}`); return; // must answer or get disconnected
      case '001': this.backoff = 1_000; void this.joinAll(); return;          // welcome => authenticated
      case 'RECONNECT': this.ws?.close(); return;                              // onclose reconnects + rejoins
      case 'NOTICE':
        if (msg.trailing?.includes('Login authentication failed') || msg.trailing?.includes('Improperly formatted auth')) {
          console.error('[irc] auth failed:', msg.trailing); this.stop();
        }
        break;
    }
    this.opts.onMessage?.(msg);
  }
}

// =============================================================================================
// CLI demo: print chat of the channels given as arguments
// =============================================================================================

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const channels = process.argv.slice(2);
  if (!channels.length) { console.error('usage: node irc-client.ts <channel> [channel...]'); process.exit(1); }
  const client = new TwitchIrcClient({
    token: process.env.TWITCH_IRC_TOKEN, login: process.env.TWITCH_IRC_LOGIN, channels,
    onMessage: (m) => {
      if (m.command === 'PRIVMSG') {
        const { action, text } = parseAction(m.trailing ?? '');
        const name = m.tags['display-name'] || m.nick;
        console.log(`${m.params[0]} ${action ? '* ' : ''}<${name}> ${text}`);
      } else if (m.command === 'USERNOTICE') {
        console.log(`${m.params[0]} [${m.tags['msg-id']}] ${m.tags['system-msg'] ?? ''} ${m.trailing ?? ''}`);
      } else if (m.command === 'CLEARMSG') {
        console.log(`${m.params[0]} [deleted ${m.tags['target-msg-id']}]`);
      } else if (m.command === 'CLEARCHAT') {
        console.log(`${m.params[0]} [clear ${m.trailing ?? 'ALL'}${m.tags['ban-duration'] ? ` timeout ${m.tags['ban-duration']}s` : ''}]`);
      }
    },
  });
  client.connect();
  process.on('SIGINT', () => { client.stop(); process.exit(0); });
}
