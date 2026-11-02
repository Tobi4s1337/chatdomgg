// Terse helpers for hero lines in shot scripts:
//   say(3.2, 'lurker', 'been lurking for 4 years. first time chatting 👋', { firstTime: true })
//   say(12, cast.forger, '!forge a chimney shaped like a sleeping dragon')
//   sub(20, 'kartoffelkiste_7')            resub notice with their months
//   raid(52, { viewers: 48 })              PinkKittyRose's raid notice
// Plain text is split into fragments the way Twitch does it: whole words that are known emote
// codes become emotes, `@login` becomes a mention, everything else stays text.
import type { ChatItem, Chatter, Fragment } from '../types';
import { emote } from './emotes';
import { cast, chatter, displayName, PINKKITTYROSE, type Person } from './roster';

export type Message = Extract<ChatItem, { kind: 'message' }>;
export type SubNotice = Extract<ChatItem, { kind: 'sub' }>;
export type GiftNotice = Extract<ChatItem, { kind: 'gift' }>;
export type RaidNotice = Extract<ChatItem, { kind: 'raid' }>;
export type Announcement = Extract<ChatItem, { kind: 'announcement' }>;

/** Cast role names a shot may use instead of a login. */
export type CastRole = 'lurker' | 'forger' | 'mod1' | 'mod2' | 'mod3' | 'vip' | 'broadcaster';
/** A chatter, a cast role name or a login. */
export type Who = Chatter | CastRole | string;

const MENTION = /^@([A-Za-z0-9_]{3,25})(.*)$/s;

/** Splits chat text into Twitch fragments. */
export function fragments(text: string): Fragment[] {
  const out: Fragment[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === 'text') out[out.length - 1] = { kind: 'text', text: last.text + t };
    else out.push({ kind: 'text', text: t });
  };
  for (const token of text.split(/(\s+)/)) {
    if (!token) continue;
    if (/^\s+$/.test(token)) { pushText(token); continue; }
    const e = emote(token);
    if (e) { out.push({ kind: 'emote', id: e.id, code: e.code }); continue; }
    const m = MENTION.exec(token);
    if (m && m[1]) {
      out.push({ kind: 'mention', login: m[1].toLowerCase() });
      pushText(m[2] ?? '');
      continue;
    }
    pushText(token);
  }
  return out;
}

/** The text a viewer reads for some fragments (emotes as their codes, mentions with @). */
export function plainText(frags: readonly Fragment[]): string {
  return frags.map((f) => (f.kind === 'text' ? f.text : f.kind === 'emote' ? f.code : `@${displayName(f.login)}`)).join('');
}

/** Resolves a chatter, a cast role or a login to a chatter. Throws on an unknown name. */
export function who(w: Who): Chatter {
  if (typeof w !== 'string') return w;
  const role = (cast as unknown as Record<string, unknown>)[w];
  if (role && typeof role === 'object' && 'login' in role && 'badges' in role) return role as Chatter;
  const found = chatter(w);
  if (!found) throw new Error(`unknown chatter: ${w}`);
  return found;
}

// A short stable hash for helper ids, so the same call always yields the same id.
function hashId(parts: readonly (string | number)[]): string {
  let h = 0x811c9dc5;
  for (const ch of parts.join('\u0001')) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

export interface SayOptions {
  id?: string;
  /** Answer an earlier message with Twitch's reply feature (the body starts with @their name, as Twitch writes it). */
  reply?: Message | { to: Who; text: string };
  /** Twitch's first-time-chatter highlight. */
  firstTime?: boolean;
}

/** A chat message. */
export function say(at: number, from: Who, text: string, opts: SayOptions = {}): Message {
  const sender = who(from);
  let frags = fragments(text);
  const base: Message = { kind: 'message', id: opts.id ?? `say-${hashId([at, sender.login, text])}`, at, from: sender, fragments: frags };
  if (opts.reply) {
    const to = 'kind' in opts.reply ? opts.reply.from : who(opts.reply.to);
    const parentText = 'kind' in opts.reply ? plainText(opts.reply.fragments) : opts.reply.text;
    const first = frags[0];
    if (!(first && first.kind === 'mention' && first.login === to.login)) frags = [{ kind: 'mention', login: to.login }, { kind: 'text', text: ' ' }, ...frags];
    return { ...base, fragments: frags, reply: { to, text: parentText }, ...(opts.firstTime ? { highlight: 'first-time' as const } : {}) };
  }
  return opts.firstTime ? { ...base, highlight: 'first-time' } : base;
}

export interface SubOptions {
  id?: string;
  /** Defaults to the chatter's months in the roster (at least 1). */
  months?: number;
  tier?: 1 | 2 | 3;
  streak?: number;
  prime?: boolean;
  /** The message attached to a resub. */
  text?: string;
}

/** A sub or resub notice. */
export function sub(at: number, from: Who, opts: SubOptions = {}): SubNotice {
  const sender = who(from);
  const months = opts.months ?? Math.max(1, (sender as Partial<Person>).months ?? 1);
  const item: SubNotice = { kind: 'sub', id: opts.id ?? `sub-${hashId([at, sender.login, months])}`, at, from: sender, tier: opts.tier ?? 1, months };
  return {
    ...item,
    ...(opts.streak !== undefined ? { streak: opts.streak } : {}),
    ...(opts.prime ? { prime: true } : {}),
    ...(opts.text ? { fragments: fragments(opts.text) } : {}),
  };
}

/** A gift-sub notice ("is gifting N Tier 1 subs to the community"). */
export function gift(at: number, from: Who, count: number, opts: { id?: string; tier?: 1 | 2 | 3 } = {}): GiftNotice {
  const sender = who(from);
  return { kind: 'gift', id: opts.id ?? `gift-${hashId([at, sender.login, count])}`, at, from: sender, count, tier: opts.tier ?? 1 };
}

/** Twitch's raid notice. Defaults to PinkKittyRose with her 48 viewers and her avatar from the media folder. */
export function raid(at: number, opts: { id?: string; viewers?: number; from?: { login: string; display: string; avatar: string } } = {}): RaidNotice {
  const from = opts.from ?? { login: PINKKITTYROSE.login, display: PINKKITTYROSE.display, avatar: PINKKITTYROSE.avatar };
  const viewers = opts.viewers ?? PINKKITTYROSE.viewers;
  return { kind: 'raid', id: opts.id ?? `raid-${hashId([at, from.login, viewers])}`, at, from, viewers };
}

/** A /announce message (mods and the broadcaster). */
export function announce(at: number, from: Who, text: string, accent: Announcement['accent'] = 'primary', id?: string): Announcement {
  const sender = who(from);
  return { kind: 'announcement', id: id ?? `ann-${hashId([at, sender.login, text])}`, at, from: sender, fragments: fragments(text), accent };
}
