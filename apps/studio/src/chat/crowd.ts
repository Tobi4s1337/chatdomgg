// The seeded crowd: turns a shot's crowd beats into chat lines that read as people.
//
// How it works, in two passes:
// 1. Timing. Each beat is a rate envelope over time (a quiet plateau for trickles and greetings,
//    a reaction curve for hype, awe, the forge, raids and emote waves). Moments when someone
//    decides to write are drawn from that envelope as a Poisson process, so the gaps are uneven.
//    Time the shot leaves uncovered gets a low ambient trickle; a beat with `rate: 0` is silence.
// 2. Content, in time order. For each moment a person is chosen (the regulars talk most, nobody
//    talks twice within a few seconds, raiders arrive with the raid), then what they write: a line
//    for the mood, a reply to something they just read, an @mention, an emote spam variant. The
//    line then takes typing time to arrive (longer lines arrive later), and may come with a
//    double post, a typo and its correction, or an answer from the person greeted.
//
// Everything comes from `script.seed` through a small PRNG: no Math.random, no clock.
import type { ChatItem, CrowdBeat, CrowdScript, Fragment } from '../types';
import { emote } from './emotes';
import * as L from './lines';
import { cast, locals, raiders, PINKKITTYROSE, type Person } from './roster';
import { fragments, plainText, type Message } from './say';

type Mood = CrowdBeat['mood'];

// ---- A small seeded PRNG (xmur3 hash into mulberry32). -----------------------------------------

function xmur3(s: string): () => number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export class Rng {
  private a: number;
  constructor(seed: string) {
    this.a = xmur3(seed)();
  }
  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.a = (this.a + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('pick from an empty list');
    return item;
  }
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1];
  }
  /** Exponential waiting time for a given rate per second. */
  wait(rate: number): number {
    return -Math.log(1 - this.next()) / rate;
  }
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}

/** A stable unsigned hash of a string, for things that must not consume the PRNG. */
function hash(s: string): number {
  return xmur3(s)();
}

// ---- Rates and envelopes. -------------------------------------------------------------------------

/** Peak messages per second for each mood when the beat gives no rate (a channel of tens of viewers). */
export const DEFAULT_RATE: Readonly<Record<Mood, number>> = {
  trickle: 0.25,
  greet: 0.9,
  hype: 2.6,
  awe: 1.3,
  forge: 2.0,
  'raid-welcome': 4.0,
  'emote-wave': 3.4,
  farewell: 0.9,
};
/** Time no beat covers: about one line every five seconds. */
export const AMBIENT_RATE = 0.2;
/** The trickle that carries on under a reaction beat after its peak has passed. */
const FLOOR = 0.12;

const REACTIVE: Partial<Record<Mood, { onset: number; rise: number; hold: number; decay: (d: number) => number }>> = {
  hype: { onset: 0.35, rise: 0.5, hold: 2.4, decay: (d) => Math.max(2, d * 0.3) },
  forge: { onset: 0.5, rise: 0.7, hold: 2, decay: (d) => Math.max(2.2, d * 0.35) },
  'raid-welcome': { onset: 0.4, rise: 0.6, hold: 3.5, decay: (d) => Math.max(3, d * 0.45) },
  'emote-wave': { onset: 0.3, rise: 0.4, hold: 2.4, decay: (d) => Math.max(2, d * 0.3) },
  awe: { onset: 0.6, rise: 1.0, hold: 2.5, decay: (d) => Math.max(3, d * 0.5) },
};

/** 0..1: how intense a beat is `u` seconds after it starts. */
function envelope(mood: Mood, u: number, duration: number): number {
  const r = REACTIVE[mood];
  if (!r) {
    // Plateaus: greetings and farewells build up over a couple of seconds.
    if (mood === 'greet' || mood === 'farewell') return 0.35 + 0.65 * (1 - Math.exp(-u / 1.5));
    return 1;
  }
  if (u < r.onset) return 0;
  const rise = 1 - Math.exp(-(u - r.onset) / r.rise);
  const after = u - r.onset - r.hold;
  return after <= 0 ? rise : rise * Math.exp(-after / r.decay(duration));
}

// ---- Who is in chat tonight. ----------------------------------------------------------------------

const NAMED: ReadonlySet<string> = new Set([cast.forger, cast.mod1, cast.mod2, cast.mod3, cast.vip, ...cast.regulars].map((p) => p.login));

/**
 * The same people are in chat in every shot (a fixed seed, not the shot's), so the regulars carry
 * across the cuts. Tens of viewers: the named people plus about forty others who say something.
 */
const TONIGHT: readonly Person[] = (() => {
  const r = new Rng('tobi4s_ teaser night');
  const others = r.shuffle(locals.filter((p) => p.chattiness > 0 && !NAMED.has(p.login))).slice(0, 40);
  return [...locals.filter((p) => NAMED.has(p.login)), ...others];
})();
const MODS: ReadonlySet<string> = new Set([cast.mod1.login, cast.mod2.login, cast.mod3.login]);

/** How fast someone types, in characters per second (a property of the person, not the seed). */
function typingSpeed(p: { login: string }): number {
  return 4.2 + (hash(p.login) % 1000) / 1000 * 4.3;
}

// ---- The model. ---------------------------------------------------------------------------------

interface Slot {
  t: number;
  mood: Mood;
  topic?: string;
  emote?: string;
  /** Set for follow-ups: this person, this text, arriving at exactly `t`. */
  fixed?: { who: Person; text: string; reply?: Message };
  /** A welcome for someone's first message. */
  welcome?: Message;
  /** A resub notice instead of a message. */
  sub?: true;
  seq: number;
}

interface Silence { from: number; to: number }

const isMessage = (i: ChatItem): i is Message => i.kind === 'message';
const GREETINGS: ReadonlySet<string> = new Set(L.GREET.map((l) => l.replace(/^de: /, '')));
const emoteOnly = (f: readonly Fragment[]) => f.length > 0 && f.every((x) => x.kind === 'emote' || (x.kind === 'text' && !x.text.trim()));

/** Generates the crowd around a shot's scripted lines: scripted plus generated items, sorted by `at`. */
export function crowd(script: CrowdScript): ChatItem[] {
  const rng = new Rng(`crowd:${script.seed}`);
  const tag = 'c' + hash(script.seed).toString(36).slice(0, 5);
  const beats = [...script.beats].sort((a, b) => a.at - b.at);
  const silences: Silence[] = beats.filter((b) => b.rate === 0).map((b) => ({ from: b.at, to: b.at + b.duration }));
  const silent = (t: number) => silences.some((s) => t >= s.from && t < s.to);

  // When the raid happens: the first raid-welcome beat or a scripted raid notice, whichever is first.
  const raidTimes = [...beats.filter((b) => b.mood === 'raid-welcome').map((b) => b.at), ...script.scripted.filter((i) => i.kind === 'raid').map((i) => i.at)];
  const raidAt = raidTimes.length ? Math.min(...raidTimes) : Infinity;

  // ---- Pass 1: when people decide to write. ----
  const slots: Slot[] = [];
  let seq = 0;
  const addSlot = (s: Omit<Slot, 'seq'>) => slots.push({ ...s, seq: seq++ });

  // When people decide to write: a renewal process run in "operational time" (the integral of the
  // rate), so the envelope sets the shape while the gaps between people stay uneven. Gaps are
  // Erlang-k waits (k exponential waits added up): k = 2 for reactions, which clump, and k = 3 for
  // quiet stretches, which keeps the long dead silences of a pure Poisson trickle away. It also
  // makes a burst dependable from seed to seed. The first wait starts part-way in, as if the
  // stretch had already been going.
  const renewal = (from: number, to: number, rate: (t: number) => number, k: number, mood: Mood, extra: Partial<Slot> = {}) => {
    const gap = () => { let g = 0; for (let i = 0; i < k; i++) g += rng.wait(k); return g; };
    const dt = 0.02;
    let need = gap() * rng.next();
    for (let t = from; t < to; t += dt) {
      need -= rate(t + dt / 2) * dt;
      while (need <= 0) {
        addSlot({ t: t + dt * (1 + need / Math.max(1e-9, rate(t + dt / 2) * dt)), mood, ...extra });
        need += gap();
      }
    }
  };

  for (const b of beats) {
    if (b.rate === 0) continue;
    const peak = b.rate ?? DEFAULT_RATE[b.mood];
    const floor = REACTIVE[b.mood] ? FLOOR : 0;
    const extra: Partial<Slot> = { ...(b.topic ? { topic: b.topic } : {}), ...(b.emote ? { emote: b.emote } : {}) };
    renewal(b.at, b.at + b.duration, (t) => floor + peak * envelope(b.mood, t - b.at, b.duration), REACTIVE[b.mood] ? 2 : 3, b.mood, extra);
    // A resub now and then: in a big moment, or over a long quiet stretch.
    if (b.mood === 'hype' && b.duration >= 4 && rng.chance(0.35)) addSlot({ t: b.at + rng.range(2, b.duration * 0.6), mood: b.mood, sub: true });
    if (b.mood === 'trickle' && b.duration >= 30 && rng.chance(Math.min(0.8, b.duration / 60))) addSlot({ t: b.at + rng.range(0.2, 0.9) * b.duration, mood: b.mood, sub: true });
  }

  // Ambient trickle wherever no beat is running.
  const covered = beats.map((b) => [b.at, b.at + b.duration] as const).sort((a, b) => a[0] - b[0]);
  let cursor = script.start;
  const gaps: [number, number][] = [];
  for (const [a, z] of covered) {
    if (a > cursor) gaps.push([cursor, Math.min(a, script.end)]);
    cursor = Math.max(cursor, z);
  }
  if (cursor < script.end) gaps.push([cursor, script.end]);
  for (const [a, z] of gaps) {
    if (z <= a) continue;
    renewal(a, z, () => AMBIENT_RATE, 3, 'trickle');
    if (z - a >= 40 && rng.chance(0.5)) addSlot({ t: rng.range(a, z), mood: 'trickle', sub: true });
  }

  // Someone writes for the first time: a few people welcome them.
  for (const m of script.scripted) {
    if (!isMessage(m) || m.highlight !== 'first-time') continue;
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) addSlot({ t: m.at + rng.range(0.8, 4.5), mood: 'greet', welcome: m });
  }

  // ---- Pass 2: who writes what, in time order. ----
  const posted: Message[] = script.scripted.filter(isMessage).slice().sort((a, b) => a.at - b.at);
  const lastSpoke = new Map<string, number>();
  for (const m of posted) lastSpoke.set(m.from.login, m.at);
  const firstSeen = new Set<string>(posted.map((m) => m.from.login));
  const subbed = new Set<string>();
  const modWelcomed = new Set<string>();
  const decks = new Map<string, string[]>();
  const out: ChatItem[] = [];
  let n = 0;
  const nextId = () => `${tag}-${(n++).toString().padStart(4, '0')}`;

  // A forge command in the script names the forger; otherwise the cast's forger.
  const forgeLine = posted.find((m) => plainText(m.fragments).startsWith('!forge'));
  const forger = forgeLine?.from ?? cast.forger;

  // A pending queue of slots, always taken in time order.
  const queue = slots.sort((a, b) => a.t - b.t || a.seq - b.seq);
  const enqueue = (s: Omit<Slot, 'seq'>) => {
    const slot = { ...s, seq: seq++ };
    let i = queue.length;
    while (i > 0 && (queue[i - 1] as Slot).t > slot.t) i--;
    queue.splice(i, 0, slot);
  };

  const seenBy = (t: number) => posted.filter((m) => m.at <= t && m.at > t - 14);

  const chooseSpeaker = (t: number, mood: Mood): Person | undefined => {
    const raidOn = t >= raidAt - 0.5;
    let pool: readonly Person[] = TONIGHT;
    if (mood === 'raid-welcome') pool = rng.chance(0.6) ? raiders : TONIGHT;
    else if (raidOn && rng.chance(0.3)) pool = raiders;
    return rng.weighted(pool, (p) => {
      if (p.chattiness <= 0) return 0;
      const since = t - (lastSpoke.get(p.login) ?? -Infinity);
      if (since < 3) return 0;
      return p.chattiness * (since < 12 ? 0.3 : 1);
    });
  };

  /** Draws a line from a pool without replacement (reshuffling when it runs out) that this person can say. */
  const draw = (key: string, pool: readonly string[], p: Person, ctx: Ctx): Drawn | undefined => {
    let deck = decks.get(key);
    for (let attempt = 0; attempt < pool.length * 2; attempt++) {
      if (!deck || deck.length === 0) {
        deck = rng.shuffle(pool);
        decks.set(key, deck);
      }
      // With a topic, look a little ahead for a line about it.
      let index = deck.length - 1;
      if (ctx.topic && rng.chance(0.6)) {
        const words = ctx.topic.toLowerCase().split(/\s+/).map((w) => w.replace(/s$/, ''));
        for (let i = deck.length - 1; i >= Math.max(0, deck.length - 8); i--) {
          const line = (deck[i] as string).toLowerCase();
          if (line.includes('{topic}') || words.some((w) => w.length > 2 && line.includes(w))) { index = i; break; }
        }
      }
      const raw = deck[index] as string;
      deck.splice(index, 1);
      const text = fill(raw, p, ctx);
      if (text !== undefined) return { text, raw: raw.replace(/^(de|sub): /, '') };
    }
    return undefined;
  };

  interface Ctx { t: number; topic?: string; emote?: string; to?: { login: string } }
  interface Drawn { text: string; raw: string }
  const fill = (raw: string, p: Person, ctx: Ctx): string | undefined => {
    let line = raw;
    if (line.startsWith('de: ')) { if (p.lang !== 'de') return undefined; line = line.slice(4); }
    if (line.startsWith('sub: ')) { if (p.months <= 0) return undefined; line = line.slice(5); }
    if (line.includes('{topic}') && !ctx.topic) return undefined;
    if (line.includes('{prev}')) {
      const others = seenBy(ctx.t).filter((m) => m.from.login !== p.login && m.from.login !== cast.broadcaster.login);
      const last = others[others.length - 1];
      if (!last) return undefined;
      line = line.replace('{prev}', `@${last.from.display}`);
    }
    if (line.includes('{forger}') && forger.login === p.login) return undefined;
    if (line.includes('{to}')) { if (!ctx.to) return undefined; line = line.replace('{to}', `@${ctx.to.login}`); }
    // Channel emotes stay with their people: tobi4s_'s for his subs, PinkKittyRose's for her raiders.
    for (const word of line.split(/\s+/)) {
      const e = emote(word);
      if (e?.owner === 'tobi4s_' && p.months <= 0) return undefined;
      if (e?.owner === 'pinkkittyrose' && p.crew !== 'raider') return undefined;
    }
    return line
      .replace('{b}', `@${cast.broadcaster.display}`)
      .replace('{forger}', `@${forger.display}`)
      .replace('{pk}', `@${PINKKITTYROSE.display}`)
      .replace('{topic}', ctx.topic ?? '')
      .replace('{e}', ctx.emote ?? '');
  };

  const waveLine = (code: string, p: Person): string => {
    const e = emote(code);
    if (!e) throw new Error(`crowd: unknown emote code in an emote wave: ${code}`);
    // Someone who cannot use the channel emote joins in with what they have.
    const usable = !((e.owner === 'pinkkittyrose' && p.crew !== 'raider') || (e.owner === 'tobi4s_' && p.months <= 0));
    if (!usable) return rng.pick(['<3 <3', 'twitchRaid', 'LUL', 'the spam LUL', 'HeyGuys']);
    if (rng.chance(0.12)) return rng.pick(['the spam LUL', 'chat LUL', `${code} <3`, `omg ${code}`, `${code} chat`]);
    const count = rng.weighted([1, 2, 3, 4, 5, 6], (k) => [0.24, 0.24, 0.24, 0.12, 0.09, 0.07][k - 1] ?? 0) ?? 1;
    return Array.from({ length: count }, () => code).join(' ');
  };

  const shout = (text: string): string =>
    text.split(/(\s+)/).map((w) => (emote(w) || w.startsWith('@') ? w : w.toUpperCase())).join('');

  /** Makes one rare typo; returns the typo'd text and the word it should have been. */
  const typo = (text: string): { text: string; word: string } | undefined => {
    const words = text.split(' ');
    const candidates = words.map((w, i) => [w, i] as const).filter(([w]) => /^[a-z]{4,}$/.test(w));
    if (!candidates.length) return undefined;
    const [w, i] = rng.pick(candidates);
    const k = rng.int(1, w.length - 2);
    const kind = rng.int(0, 2);
    const bad = kind === 0 ? w.slice(0, k) + w[k + 1] + w[k] + w.slice(k + 2) : kind === 1 ? w.slice(0, k) + w.slice(k + 1) : w.slice(0, k) + w[k] + w.slice(k);
    if (bad === w) return undefined;
    words[i] = bad;
    return { text: words.join(' '), word: w };
  };

  const replyPool = (mood: Mood): readonly string[] =>
    mood === 'awe' ? L.REPLY.awe : mood === 'forge' ? L.REPLY.forge : mood === 'hype' || mood === 'emote-wave' ? L.REPLY.hype : mood === 'raid-welcome' ? L.REPLY.raid : mood === 'farewell' ? L.REPLY.farewell : L.REPLY.calm;

  const moodPool = (mood: Mood, p: Person): [string, readonly string[]] => {
    switch (mood) {
      case 'greet': return ['greet', L.GREET];
      case 'hype': return ['hype', L.HYPE];
      case 'awe': return ['awe', L.AWE];
      case 'forge': return ['forge', L.FORGE];
      case 'emote-wave': return ['wave-filler', L.WAVE_FILLER];
      case 'farewell': return p.crew === 'raider' && rng.chance(0.6) ? ['farewell-raider', L.FAREWELL_RAIDER] : ['farewell', L.FAREWELL];
      case 'raid-welcome':
        if (p.crew === 'raider') return ['raid-raider', L.RAID_RAIDER];
        return ['raid-local', L.RAID_WELCOME_LOCAL];
      default:
        if (p.crew === 'raider') return ['raid-raider-after', L.RAID_RAIDER.filter((l) => !/raid/i.test(l))];
        return ['trickle', L.TRICKLE];
    }
  };

  // Which line each message was drawn from, so an answer can fit what it answers.
  const source = new Map<string, string>();
  for (const m of posted) source.set(m.id, plainText(m.fragments).toLowerCase());
  const answered = new Map<string, number>();
  /** Greetings, welcomes and lines aimed at someone: nobody answers these with a generic reply. */
  const noReply = new Set<string>();
  /** The mood each generated line was written in: a generic answer only fits a line of the same mood. */
  const moodOf = new Map<string, Mood>();
  const isQuestion = (m: Message) => {
    const text = plainText(m.fragments).trim().toLowerCase();
    return /\?$/.test(text) || /^(what|how|is|whose|did|which|where|who|why|can|does|anyone|wait is)\b/.test(text);
  };
  /** Lines aimed at tobi4s_: he answers those on stream, chat leaves them be. */
  const toBroadcaster = (m: Message) => m.fragments.some((f) => f.kind === 'mention' && f.login === cast.broadcaster.login) || /\btobi\b/i.test(plainText(m.fragments));

  const post = (p: Person, text: string, decidedAt: number, slot: Slot, opts: { reply?: Message; exact?: boolean; raw?: string; correct?: string; pasted?: boolean } = {}): Message | undefined => {
    const frags = fragments(text);
    if (!frags.length) return undefined;
    let at = decidedAt;
    if (!opts.exact) {
      // Typing time: emote spam is a quick repeat; otherwise characters at the person's speed,
      // with emotes and names typed by tab-completion.
      const chars = frags.reduce((s, f) => s + (f.kind === 'text' ? f.text.length : f.kind === 'emote' ? 3 : 4), 0);
      const spam = emoteOnly(frags) && new Set(frags.filter((f) => f.kind === 'emote').map((f) => (f as { code: string }).code)).size === 1;
      // A pasted line (a raid message) is as quick as spam.
      at += spam || opts.pasted ? rng.range(0.3, 1.0) : Math.min(6.5, Math.max(0.35, chars / typingSpeed(p))) * rng.range(0.85, 1.2);
    }
    let body = frags;
    let reply: Message['reply'];
    if (opts.reply) {
      // Twitch starts a reply with @their name; a name already in the line is not repeated.
      const to = opts.reply.from.login;
      reply = { to: opts.reply.from, text: plainText(opts.reply.fragments) };
      const rest = fragments(plainText(frags.filter((f) => !(f.kind === 'mention' && f.login === to))).replace(/\s+/g, ' ').trim());
      body = [{ kind: 'mention', login: to }, { kind: 'text', text: ' ' }, ...rest];
    }
    // Raiders chatting here for the first time get Twitch's first-time highlight, some of them.
    const firstTime = p.crew === 'raider' && !firstSeen.has(p.login) && rng.chance(0.3);
    firstSeen.add(p.login);
    const msg: Message = {
      kind: 'message', id: nextId(), at, from: p, fragments: body,
      ...(reply ? { reply } : {}),
      ...(firstTime ? { highlight: 'first-time' as const } : {}),
    };
    out.push(msg);
    if (opts.raw) source.set(msg.id, opts.raw);
    moodOf.set(msg.id, slot.mood);
    if (slot.mood === 'greet' || slot.welcome || opts.reply || (opts.raw !== undefined && GREETINGS.has(opts.raw))) noReply.add(msg.id);
    lastSpoke.set(p.login, at);
    let i = posted.length;
    while (i > 0 && (posted[i - 1] as Message).at > at) i--;
    posted.splice(i, 0, msg);

    // A second line right after, now and then.
    if (!opts.exact && rng.chance(slot.mood === 'emote-wave' ? 0.2 : slot.mood === 'hype' || slot.mood === 'raid-welcome' ? 0.1 : 0.07)) {
      const [key, pool] = moodPool(slot.mood, p);
      const followUps = slot.mood === 'emote-wave' && slot.emote ? [waveLine(slot.emote, p)] : slot.mood === 'trickle' ? L.FOLLOW_UP.calm : slot.mood === 'greet' || slot.mood === 'raid-welcome' || slot.mood === 'farewell' ? L.FOLLOW_UP.warm : L.FOLLOW_UP.excited;
      const again = rng.chance(0.5) ? rng.pick(followUps) : draw(key, pool, p, { t: at, ...(slot.topic ? { topic: slot.topic } : {}) })?.text;
      if (again) enqueue({ t: at + rng.range(0.9, 2.4), mood: slot.mood, fixed: { who: p, text: again } });
    }
    // The correction of a typo comes a moment after the line with the typo.
    if (opts.correct) enqueue({ t: at + rng.range(1.1, 2.6), mood: slot.mood, fixed: { who: p, text: `*${opts.correct}` } });
    return msg;
  };

  /** Picks something recent worth answering, preferring questions and lines that invite an answer. */
  const replyTarget = (recent: readonly Message[], p: Person, mood: Mood): Message | undefined => {
    let pool = recent.filter((m) => !emoteOnly(m.fragments) && m.from.login !== cast.broadcaster.login && (answered.get(m.id) ?? 0) < 2 && !m.reply && !noReply.has(m.id) && m.fragments[0]?.kind !== 'mention' && m.highlight !== 'first-time' && !toBroadcaster(m));
    // Locals welcoming a raid answer the raiders. Raiders have just arrived: they answer no one
    // during the welcome, and later only each other.
    const raider = (m: Message) => (m.from as Partial<Person>).crew === 'raider';
    if (mood === 'raid-welcome') pool = p.crew === 'local' ? pool.filter(raider) : [];
    else if (p.crew === 'raider') pool = pool.filter(raider);
    const sameMood = (m: Message) => !moodOf.has(m.id) || moodOf.get(m.id) === mood;
    return rng.weighted(pool.slice(-6), (m) => (L.ANSWERS[source.get(m.id) ?? ''] ? 4 : !sameMood(m) ? 0 : isQuestion(m) ? 3 : 1));
  };

  const given = new Map<string, Set<string>>();
  const answerFor = (target: Message, mood: Mood, p: Person): string => {
    const specific = L.ANSWERS[source.get(target.id) ?? ''];
    const pool = specific ?? (isQuestion(target) ? L.REPLY_QUESTION : mood === 'raid-welcome' && p.crew === 'local' ? L.REPLY.raid : replyPool(mood));
    // Two people do not send the same answer to the same line.
    const used = given.get(target.id) ?? new Set<string>();
    const fresh = pool.filter((a) => !used.has(a));
    const answer = rng.pick(fresh.length ? fresh : pool);
    used.add(answer);
    given.set(target.id, used);
    return answer;
  };

  while (queue.length) {
    const slot = queue.shift() as Slot;
    const t = slot.t;

    if (slot.fixed) {
      post(slot.fixed.who, slot.fixed.text, t, slot, { exact: true, ...(slot.fixed.reply ? { reply: slot.fixed.reply } : {}) });
      continue;
    }

    if (slot.sub) {
      const subs = TONIGHT.filter((p) => p.months > 0 && !subbed.has(p.login) && t - (lastSpoke.get(p.login) ?? -Infinity) > 5);
      const p = subs.length ? rng.pick(subs) : undefined;
      if (!p) continue;
      subbed.add(p.login);
      const prime = p.badges.some((b) => b.set === 'premium') && rng.chance(0.6);
      const streak = p.months >= 2 && rng.chance(0.5) ? rng.int(2, p.months) : undefined;
      const text = rng.chance(0.6) ? fill(rng.pick(L.SUB_MESSAGES), p, { t }) : undefined;
      out.push({
        kind: 'sub', id: nextId(), at: t, from: p, tier: 1, months: p.months,
        ...(streak !== undefined ? { streak } : {}),
        ...(prime ? { prime: true } : {}),
        ...(text ? { fragments: fragments(text) } : {}),
      });
      lastSpoke.set(p.login, t);
      continue;
    }

    if (slot.welcome) {
      const target = slot.welcome;
      const p = rng.weighted(TONIGHT.filter((q) => NAMED.has(q.login) && q.login !== target.from.login), (q) => (t - (lastSpoke.get(q.login) ?? -Infinity) < 3 ? 0 : q.chattiness));
      if (!p) continue;
      const drawn = draw('first-time', L.FIRST_TIME_WELCOME, p, { t, to: target.from });
      if (drawn) post(p, drawn.text, t, slot, rng.chance(0.4) ? { reply: target } : {});
      continue;
    }

    const p = chooseSpeaker(t, slot.mood);
    if (!p) continue;
    const ctx: Ctx = { t, ...(slot.topic ? { topic: slot.topic } : {}), ...(slot.emote ? { emote: slot.emote } : {}) };
    const recent = seenBy(t).filter((m) => m.from.login !== p.login);

    // Emote waves: most people post the emote; a few say something else.
    if (slot.mood === 'emote-wave' && slot.emote && rng.chance(0.85)) {
      post(p, waveLine(slot.emote, p), t, slot);
      continue;
    }

    // Raids: raiders paste the raid message; each mod welcomes everyone once.
    if (slot.mood === 'raid-welcome') {
      if (p.crew === 'raider' && rng.chance(0.4)) {
        const v = rng.next();
        post(p, v < 0.7 ? L.RAID_MESSAGE : v < 0.85 ? L.RAID_MESSAGE.replace(/ pkroseHeart$/, '') : `${L.RAID_MESSAGE} pkroseHeart`, t, slot, { pasted: true });
        continue;
      }
      if (MODS.has(p.login) && !modWelcomed.has(p.login)) {
        modWelcomed.add(p.login);
        const drawn = draw('raid-mod', L.RAID_WELCOME_MOD, p, ctx);
        if (drawn) { post(p, drawn.text, t, slot, { raw: drawn.raw }); continue; }
      }
    }

    // Greetings aimed at a regular, who often greets back.
    if (slot.mood === 'greet' && p.crew === 'local' && rng.chance(0.25)) {
      const friend = [...recent].reverse().find((m) => NAMED.has(m.from.login));
      if (friend) {
        const drawn = draw('greet-someone', L.GREET_SOMEONE, p, { ...ctx, to: friend.from });
        if (drawn) {
          const greeting = post(p, drawn.text, t, slot);
          const friendPerson = TONIGHT.find((q) => q.login === friend.from.login);
          if (greeting && friendPerson && rng.chance(0.6)) {
            // They read it, then type their answer.
            const back = draw('greet-back', L.GREET_BACK, friendPerson, { t, to: p });
            if (back) enqueue({ t: greeting.at + rng.range(1.5, 3.5) + back.text.length / typingSpeed(friendPerson), mood: 'greet', fixed: { who: friendPerson, text: back.text } });
          }
          continue;
        }
      }
    }

    // Replies to something just read: Twitch's reply, or an inline @mention.
    const replyChance = { trickle: 0.22, greet: 0.08, hype: 0.08, awe: 0.16, forge: 0.15, 'raid-welcome': 0.2, 'emote-wave': 0.05, farewell: 0.1 }[slot.mood];
    if (rng.chance(replyChance)) {
      const target = replyTarget(recent, p, slot.mood);
      if (target) {
        answered.set(target.id, (answered.get(target.id) ?? 0) + 1);
        const answer = answerFor(target, slot.mood, p);
        if (rng.chance(0.55)) post(p, answer, t, slot, { reply: target });
        else post(p, `@${target.from.display} ${answer}`, t, slot);
        continue;
      }
    }

    // One-word reactions now and then (not a raider's hello).
    const reactChance = (slot.mood === 'raid-welcome' && p.crew === 'raider') || slot.mood === 'greet' || slot.mood === 'farewell' || slot.mood === 'emote-wave' ? 0 : slot.mood === 'trickle' ? 0.05 : 0.1;
    if (rng.chance(reactChance)) {
      post(p, rng.pick(L.REACT), t, slot);
      continue;
    }

    const [key, pool] = moodPool(slot.mood, p);
    let drawn = draw(key, pool, p, ctx);
    // The backlog before the shot starts is part greetings: people arrived earlier in the night.
    if (slot.mood === 'trickle' && t < 0 && rng.chance(0.3)) drawn = draw('greet', L.GREET, p, ctx) ?? drawn;
    if (!drawn) continue;
    let text = drawn.text;

    // Caps when hyped.
    const capsChance: number = ({ hype: 0.3, 'raid-welcome': 0.15, forge: 0.12, 'emote-wave': 0.1 } as Partial<Record<Mood, number>>)[slot.mood] ?? 0;
    if (rng.chance(capsChance)) text = shout(text);

    // A rare typo, sometimes corrected a moment later.
    let correct: string | undefined;
    if (rng.chance(0.035)) {
      const ty = typo(text);
      if (ty) {
        text = ty.text;
        if (rng.chance(0.5)) correct = ty.word;
      }
    }
    post(p, text, t, slot, { raw: drawn.raw, ...(correct ? { correct } : {}) });
  }

  // ---- Final touches: the frame, silences and room around hero lines. ----
  const heroTimes = script.scripted.map((i) => i.at);
  const kept: ChatItem[] = [];
  for (const item of out) {
    let at = item.at;
    // Leave the scripted lines a little room so a hero line never lands in the same instant as a crowd line.
    for (const h of heroTimes) if (Math.abs(at - h) < 0.3) at = h + 0.3 + (hash(item.id) % 100) / 400;
    if (at < script.start || at > script.end || silent(at)) continue;
    kept.push(at === item.at ? item : { ...item, at });
  }

  const order = new Map<ChatItem, number>();
  const all = [...script.scripted, ...kept];
  all.forEach((item, i) => order.set(item, i));
  return all.sort((a, b) => a.at - b.at || (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** The chat that has arrived by time t (what the page shows at t). */
export function chatAt(items: readonly ChatItem[], t: number): ChatItem[] {
  return items.filter((i) => i.at <= t);
}
