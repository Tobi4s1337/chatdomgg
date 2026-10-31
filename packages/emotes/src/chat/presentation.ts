import { CitizenChatCueSchema, type Vec3 } from '../deps';
import type { ApprovedEmoteVisual, EmoteCatalogueView, EmoteOrigin, InlineEmoteVisual } from '../types';
import { emoteChatParts, soleEmote, type EmoteChatPart, type ThirdPartyEmoteTokens } from './parts';

/**
 * Spec 24 R9–R10 tuning. A chant needs several different people inside a short window; it rains for a
 * while and then that emote rests, so a spam wave reads as one shared moment instead of a machine.
 */
export const EMOTE_CHAT_TUNING = {
  /** A chant counts the people who used one emote within this window. */
  windowMs: 6_000,
  /** Distinct visual slots needed to raise weather. A hamlet of three can share a moment. */
  minSlots: 3,
  weatherMs: 12_000,
  /** Measured from a weather's start: the same emote cannot raise weather again before this. */
  cooldownMs: 20_000,
  maxWeathers: 2,
  /** One message counts toward at most this many different emotes' chants. */
  emotesPerCue: 4,
  /** How long a popped emote stays lifted above its sender (never past the cue's own expiry). */
  popMs: 2_600,
  /** Hard ceilings on retained state, whatever chat throws at it. */
  maxBubbles: 64,
  maxPops: 16,
  maxContributions: 1_024,
  maxSeen: 4_096,
  /** Where the weather rises from: at most this many contributors' spots, sampled in slot order. */
  maxSpawnPoints: 12,
  /** A cue stamped this far ahead of caller time is refused rather than held. */
  futureSkewMs: 2_000,
  /** Weather particle budgets (Spec 24 R10); two motifs share it, so each takes half. */
  particles: { desktop: 256, phone: 64 },
  /** A small weather and how it grows per extra chanting slot, before the per-motif cap. */
  particleBase: { desktop: 72, phone: 22 },
  particlePerSlot: { desktop: 8, phone: 3 },
  /** Pop sounds in a burst: at most one per this interval; a weather's start is its own single sound. */
  popSoundMs: 280,
} as const;

export type EmoteChatDevice = 'desktop' | 'phone';

export type EmoteChatRejection = 'invalid' | 'foreign' | 'expired' | 'early' | 'duplicate' | 'absent';

/** One sound for a burst, never one per particle; the host maps it onto the shared sound port. */
export interface EmoteChatSound { readonly kind: 'pop' | 'weather'; readonly slot: number | null; readonly variant: number }

export type EmoteChatReceipt =
  | { readonly status: 'accepted'; readonly pop: boolean; readonly weather: string | null; readonly sound: EmoteChatSound | null }
  | { readonly status: 'rejected'; readonly reason: EmoteChatRejection };

/** A resolved inline part: an emote carries its verified flat image, or null to show its words. */
export type EmoteChatInline =
  | Extract<EmoteChatPart, { kind: 'text' }>
  | (Extract<EmoteChatPart, { kind: 'emote' }> & { readonly visual: InlineEmoteVisual | null });

export interface EmoteChatBubble {
  readonly cueId: string;
  readonly slot: number;
  readonly origin: EmoteOrigin;
  /** The speaker's feet, as the host supplied them this frame. */
  readonly position: Vec3;
  readonly parts: readonly EmoteChatInline[];
  readonly asOf: number;
  readonly expiresAt: number;
}

/** A message that was one emote: the emblem lifted above its sender. The body and face stay the host's. */
export interface EmoteChatGesture {
  readonly cueId: string;
  readonly slot: number;
  readonly origin: EmoteOrigin;
  readonly position: Vec3;
  readonly emote: { readonly id: string; readonly alt: string; readonly visual: InlineEmoteVisual };
  /** 0 → 1 across the pop. */
  readonly progress: number;
  /** Metres above the head the emblem has risen. */
  readonly lift: number;
  readonly scale: number;
  readonly opacity: number;
}

/** One chant's weather: an approved effect emote, drifting up from where the chanters stand. */
export interface EmoteWeatherInstance {
  readonly id: string;
  readonly emoteId: string;
  readonly origin: EmoteOrigin;
  readonly visual: ApprovedEmoteVisual;
  readonly startedAt: number;
  readonly endsAt: number;
  /** Distinct slots in the chant when it started. */
  readonly slots: number;
  readonly particles: number;
  /** Positions it rises from (no identities, just where people stood). */
  readonly spawn: readonly Vec3[];
  readonly seed: number;
}

export interface EmoteChatFrame {
  readonly atMs: number;
  readonly bubbles: readonly EmoteChatBubble[];
  readonly gestures: readonly EmoteChatGesture[];
  readonly weather: readonly EmoteWeatherInstance[];
}

export interface EmoteChatStats {
  readonly bubbles: number;
  readonly pops: number;
  readonly contributions: number;
  readonly seen: number;
  readonly weather: number;
  readonly cooldowns: number;
}

export interface EmoteChatSource { readonly kingdomId: string; readonly epoch: string; readonly origin: EmoteOrigin }

export interface EmoteChatOptions extends EmoteChatSource {
  readonly catalogue: EmoteCatalogueView | null;
  /** Opted-in third-party names; null or empty keeps the tokenizer off. */
  readonly thirdParty?: ThirdPartyEmoteTokens | null;
  readonly device?: EmoteChatDevice;
}

/** Present slots and where they stand. A slot that is not here has no body, so it says nothing. */
export type EmoteChatPositions = ReadonlyMap<number, Vec3>;

export interface EmoteChatPresentation {
  /** Takes one sanitized cue at caller time. Only present slots of this kingdom, epoch and origin count. */
  receive(input: unknown, atMs: number, positions: EmoteChatPositions): EmoteChatReceipt;
  /** Bubbles, lifted emotes and weather at caller time, placed at this frame's positions. */
  frame(atMs: number, positions: EmoteChatPositions): EmoteChatFrame;
  /** A deleted message: its bubble, its pending pop and its uncounted chant share go. */
  removeCue(id: string): boolean;
  /** Someone left or was timed out: everything from that slot goes. */
  clearSlot(slot: number): void;
  /** Chat cleared or a new stream epoch: nothing from before survives, weather included. */
  clearEpoch(next?: Partial<EmoteChatSource>): void;
  setCatalogue(catalogue: EmoteCatalogueView | null): void;
  setThirdParty(tokens: ThirdPartyEmoteTokens | null): void;
  stats(): EmoteChatStats;
}

/** 32-bit FNV-1a; seeds are a pure function of what was said and when, never a clock or Math.random. */
export function emoteChatSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

interface HeldCue { readonly id: string; readonly slot: number; readonly asOf: number; readonly expiresAt: number; readonly parts: readonly EmoteChatPart[] }
interface Pop { readonly cueId: string; readonly slot: number; readonly startedAt: number; readonly endsAt: number; readonly emote: Extract<EmoteChatPart, { kind: 'emote' }> }
interface Contribution { readonly cueId: string; readonly slot: number; readonly emoteId: string; readonly asOf: number }

const easeOutBack = (x: number): number => { const c = 1.70158; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
const clamp01 = (x: number): number => x < 0 ? 0 : x > 1 ? 1 : x;

/**
 * Chat's emotes in the world (Spec 24 R9–R10). Pure and three-free: it validates the shared cue,
 * keeps only what the cue window needs (no names, no archive), resolves inline parts against the
 * approved catalogue, lifts sole emotes above present slots and turns a chant of distinct people
 * into bounded, seeded weather. Every time is caller time.
 */
export function createEmoteChatPresentation(options: EmoteChatOptions): EmoteChatPresentation {
  const T = EMOTE_CHAT_TUNING;
  const device: EmoteChatDevice = options.device ?? 'desktop';
  let source: EmoteChatSource = { kingdomId: options.kingdomId, epoch: options.epoch, origin: options.origin };
  let catalogue = options.catalogue;
  let thirdParty = options.thirdParty ?? null;
  /** Newest bubble per slot. */
  const bubbles = new Map<number, HeldCue>();
  /** Newest pop per slot. */
  const pops = new Map<number, Pop>();
  /** `${emoteId}|${slot}` → that slot's newest uncounted use of the emote: one voice per person per chant. */
  const contributions = new Map<string, Contribution>();
  /** Cue ID → its expiry, so a redelivered or deleted cue cannot come back while it could still show. */
  const seen = new Map<string, number>();
  const weather: EmoteWeatherInstance[] = [];
  /** Emote ID → when it may raise weather again. */
  const cooldowns = new Map<string, number>();
  let lastPopSound = -Infinity, sounds = 0;
  /** Resolutions are cached per catalogue view, so a frame never copies image bytes. */
  let resolved = new Map<string, InlineEmoteVisual | null>();

  const inline = (id: string): InlineEmoteVisual | null => {
    if (!catalogue) return null;
    if (resolved.has(id)) return resolved.get(id)!;
    const visual = catalogue.resolveInlineEmote(id);
    if (resolved.size >= 512) resolved.delete(resolved.keys().next().value!);
    resolved.set(id, visual);
    return visual;
  };
  const effect = (id: string): ApprovedEmoteVisual | null => catalogue?.resolveApprovedEmote(id, 'effect') ?? null;

  /** The latest caller time seen; a deletion is remembered for one cue life past it. */
  let lastAtMs = -Infinity;
  /**
   * Entries go in roughly in time order, so pruning walks from the oldest and stops at the first live
   * one: constant work per cue under a burst. A straggler out of order waits behind it, still capped.
   */
  const prune = (atMs: number): void => {
    lastAtMs = Math.max(lastAtMs, atMs);
    for (const [id, expiresAt] of seen) { if (expiresAt > atMs) break; seen.delete(id); }
    for (const [key, contribution] of contributions) { if (contribution.asOf > atMs - T.windowMs) break; contributions.delete(key); }
    for (const [slot, cue] of bubbles) if (cue.expiresAt <= atMs) bubbles.delete(slot);
    for (const [slot, pop] of pops) if (pop.endsAt <= atMs) pops.delete(slot);
    for (let i = weather.length - 1; i >= 0; i--) if (weather[i]!.endsAt <= atMs) weather.splice(i, 1);
    for (const [id, until] of cooldowns) if (until <= atMs) cooldowns.delete(id);
  };
  /** Maps keep insertion order; re-inserting moves an entry to the back, so the front is the oldest. */
  const cap = <K, V>(map: Map<K, V>, limit: number): void => { while (map.size > limit) map.delete(map.keys().next().value as K); };

  /** Raises weather for `emoteId` if enough different people used it in the window and it may rain. */
  const chant = (emoteId: string, asOf: number, positions: EmoteChatPositions): EmoteWeatherInstance | null => {
    if (weather.length >= T.maxWeathers || cooldowns.has(emoteId) || weather.some(w => w.emoteId === emoteId)) return null;
    // Only an approved carved effect can rain; checking it first keeps unapproved spam cheap.
    const visual = effect(emoteId);
    if (!visual) return null;
    // A chant is one window that contains the triggering message: either ending at it, or ending at the
    // newest voice less than a window after it (a late, out-of-order message). Never both sides at once,
    // so a straggler cannot borrow later messages into an earlier chant or stretch it past the window.
    const around = [...contributions.values()].filter(c => c.emoteId === emoteId && Math.abs(c.asOf - asOf) < T.windowMs && positions.has(c.slot));
    const within = (end: number) => around.filter(c => c.asOf <= end && c.asOf > end - T.windowMs);
    let start = asOf, voices = within(asOf);
    if (voices.length < T.minSlots) {
      const newest = around.reduce((max, c) => Math.max(max, c.asOf), asOf);
      if (newest > asOf) { start = newest; voices = within(newest); }
    }
    if (voices.length < T.minSlots) return null;
    const slots = voices.map(v => v.slot).sort((a, b) => a - b);
    const step = Math.max(1, Math.ceil(slots.length / T.maxSpawnPoints));
    const spawn = slots.filter((_, i) => i % step === 0).slice(0, T.maxSpawnPoints).map(slot => positions.get(slot)!);
    const budget = T.particles[device] / T.maxWeathers;
    const particles = Math.min(budget, T.particleBase[device] + T.particlePerSlot[device] * (slots.length - T.minSlots));
    const id = `weather.${emoteId}.${start}`;
    const instance: EmoteWeatherInstance = {
      id, emoteId, origin: source.origin, visual, startedAt: start, endsAt: start + T.weatherMs,
      slots: slots.length, particles, spawn, seed: emoteChatSeed(`${id}|${visual.revision}`),
    };
    weather.push(instance);
    cooldowns.set(emoteId, start + T.cooldownMs);
    // The chant is spent: its voices start counting toward the next one only after the rest.
    for (const voice of voices) contributions.delete(`${voice.emoteId}|${voice.slot}`);
    return instance;
  };

  const presentation: EmoteChatPresentation = {
    receive(input, atMs, positions) {
      const parsed = CitizenChatCueSchema.safeParse(input);
      if (!parsed.success || !Number.isFinite(atMs)) return { status: 'rejected', reason: 'invalid' };
      const cue = parsed.data;
      if (cue.kingdomId !== source.kingdomId || cue.epoch !== source.epoch || cue.origin !== source.origin) return { status: 'rejected', reason: 'foreign' };
      prune(atMs);
      if (cue.expiresAt <= atMs) return { status: 'rejected', reason: 'expired' };
      if (cue.asOf > atMs + T.futureSkewMs) return { status: 'rejected', reason: 'early' };
      if (seen.has(cue.id)) return { status: 'rejected', reason: 'duplicate' };
      // No body, no voice: a slot the host does not show as present never becomes a person here.
      if (!positions.has(cue.slot)) return { status: 'rejected', reason: 'absent' };
      seen.set(cue.id, cue.expiresAt); cap(seen, T.maxSeen);

      const parts = emoteChatParts(cue.parts, thirdParty);
      const sole = soleEmote(parts);
      const held: HeldCue = { id: cue.id, slot: cue.slot, asOf: cue.asOf, expiresAt: cue.expiresAt, parts };
      const shownSince = Math.max(bubbles.get(cue.slot)?.asOf ?? -Infinity, pops.get(cue.slot)?.startedAt ?? -Infinity);
      const newest = cue.asOf > shownSince;
      let pop = false;
      if (newest) {
        // The newest message from a slot replaces what was over that head; a sole emote pops instead of a bubble.
        bubbles.delete(cue.slot); pops.delete(cue.slot);
        if (sole && inline(sole.id)) {
          pops.set(cue.slot, { cueId: cue.id, slot: cue.slot, startedAt: cue.asOf, endsAt: Math.min(cue.asOf + T.popMs, cue.expiresAt), emote: sole });
          cap(pops, T.maxPops); pop = true;
        } else { bubbles.set(cue.slot, held); cap(bubbles, T.maxBubbles); }
      }

      // Each message is one voice per emote, for at most a few emotes; each person counts once per chant.
      const emotes = [...new Set(parts.flatMap(p => p.kind === 'emote' ? [p.id] : []))].slice(0, T.emotesPerCue);
      let raised: EmoteWeatherInstance | null = null;
      for (const emoteId of emotes) {
        if (cue.asOf <= atMs - T.windowMs) break;
        const key = `${emoteId}|${cue.slot}`, previous = contributions.get(key);
        if (previous && previous.asOf >= cue.asOf) continue;
        contributions.delete(key);
        contributions.set(key, { cueId: cue.id, slot: cue.slot, emoteId, asOf: cue.asOf });
        cap(contributions, T.maxContributions);
        const started = chant(emoteId, cue.asOf, positions);
        raised ??= started;
      }

      let sound: EmoteChatSound | null = null;
      if (raised) sound = { kind: 'weather', slot: null, variant: sounds++ % 4 };
      else if (pop && atMs - lastPopSound >= T.popSoundMs) { lastPopSound = atMs; sound = { kind: 'pop', slot: cue.slot, variant: sounds++ % 4 }; }
      return { status: 'accepted', pop, weather: raised?.id ?? null, sound };
    },

    frame(atMs, positions) {
      prune(atMs);
      const shownBubbles: EmoteChatBubble[] = [];
      for (const cue of bubbles.values()) {
        const position = positions.get(cue.slot);
        if (!position || cue.asOf > atMs) continue;
        shownBubbles.push({
          cueId: cue.id, slot: cue.slot, origin: source.origin, position, asOf: cue.asOf, expiresAt: cue.expiresAt,
          parts: cue.parts.map(part => part.kind === 'text' ? part : { ...part, visual: inline(part.id) }),
        });
      }
      const gestures: EmoteChatGesture[] = [];
      for (const pop of pops.values()) {
        const position = positions.get(pop.slot), visual = inline(pop.emote.id);
        if (!position || !visual || pop.startedAt > atMs) continue;
        const elapsed = atMs - pop.startedAt, length = pop.endsAt - pop.startedAt, progress = clamp01(elapsed / length);
        // In with a little overshoot, a slow lift, then a soft fade over the last third.
        const grow = elapsed < 320 ? easeOutBack(clamp01(elapsed / 320)) : 1;
        gestures.push({
          cueId: pop.cueId, slot: pop.slot, origin: source.origin, position, progress,
          emote: { id: pop.emote.id, alt: pop.emote.alt, visual },
          lift: .25 + .55 * (1 - (1 - progress) ** 2), scale: grow, opacity: progress < .66 ? 1 : clamp01((1 - progress) / .34),
        });
      }
      // Retired or replaced since it started: confirmed removal stops the weather at once.
      for (let i = weather.length - 1; i >= 0; i--) if (effect(weather[i]!.emoteId)?.revision !== weather[i]!.visual.revision) weather.splice(i, 1);
      return { atMs, bubbles: shownBubbles.sort((a, b) => a.slot - b.slot), gestures: gestures.sort((a, b) => a.slot - b.slot), weather: weather.filter(w => w.startedAt <= atMs) };
    },

    removeCue(id) {
      let removed = false;
      for (const [slot, cue] of bubbles) if (cue.id === id) { bubbles.delete(slot); removed = true; }
      for (const [slot, pop] of pops) if (pop.cueId === id) { pops.delete(slot); removed = true; }
      for (const [key, contribution] of contributions) if (contribution.cueId === id) { contributions.delete(key); removed = true; }
      // Remember the deletion while the cue could still be redelivered.
      if (!seen.has(id)) { seen.set(id, Number.isFinite(lastAtMs) ? lastAtMs + 10_000 : Number.POSITIVE_INFINITY); cap(seen, T.maxSeen); }
      return removed;
    },

    clearSlot(slot) {
      bubbles.delete(slot); pops.delete(slot);
      for (const [key, contribution] of contributions) if (contribution.slot === slot) contributions.delete(key);
    },

    clearEpoch(next) {
      source = { ...source, ...next };
      bubbles.clear(); pops.clear(); contributions.clear(); seen.clear(); weather.length = 0; cooldowns.clear();
      lastPopSound = -Infinity; lastAtMs = -Infinity;
    },

    setCatalogue(next) { catalogue = next; resolved = new Map(); },
    setThirdParty(tokens) { thirdParty = tokens && tokens.size ? tokens : null; },
    stats: () => ({ bubbles: bubbles.size, pops: pops.size, contributions: contributions.size, seen: seen.size, weather: weather.length, cooldowns: cooldowns.size }),
  };
  return presentation;
}
