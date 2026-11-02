import { CitizenChatCueSchema, TokenSchema, type CitizenChatCue } from '@chatdom/shared';

/*
 * Twitch chat at the fire: each live chat line rises as a small lantern in the dark beyond the logs, with its words
 * beside it, and fades. People who only chat are lights, never bodies. Speech is transient: nothing here is kept after
 * its lantern fades, and a moderator's removal or a clear puts the lanterns out at once.
 *
 * Counts are bounded: at most `capacity` lanterns are in the air, one new one rises at most every `spacingMs`, and a
 * busy chat keeps only its newest few waiting lines.
 */

export const CHAT_LANTERNS = Object.freeze({ capacity: 12, spacingMs: 320, waiting: 4, lifeMs: 9_000, fadeMs: 1_400, outMs: 600, words: 72 });

export interface ChatLantern {
  readonly id: string;
  readonly words: string;
  /** Pool slot, stable for the lantern's life. */
  readonly slot: number;
  /** Around the hearth, radians (zero toward +Z in the clearing's frame). */
  readonly angle: number;
  /** Metres from the hearth, beyond the logs. */
  readonly reach: number;
  readonly born: number;
  /** When it is gone: its natural end, or sooner when taken down. */
  readonly ends: number;
  /** Taken down by moderation or a clear: it goes out quickly. */
  readonly out: boolean;
}

export interface ChatLanternSample extends ChatLantern {
  /** 0..1 through its life. */
  readonly age: number;
  /** 0..1 how brightly it shows now. */
  readonly glow: number;
}

/** The kingdom room's transient message, as far as chat goes. */
export type ChatTransient = { readonly type: 'chat'; readonly cue: unknown } | { readonly type: 'chat.remove'; readonly cueIds: readonly unknown[] } | { readonly type: 'chat.clear' } | { readonly type: string };

/** The words a lantern carries: text as said, emotes by their name, one line, never longer than the lantern can hold. */
export function chatWords(cue: Pick<CitizenChatCue, 'parts'>, max = CHAT_LANTERNS.words): string {
  // eslint-disable-next-line no-control-regex
  const text = cue.parts.map(part => part.kind === 'text' ? part.text : part.alt).join(' ').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1), space = cut.lastIndexOf(' ');
  return `${(space > max * .6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const hash = (text: string): number => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const smooth = (t: number): number => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

export interface ChatLanternField {
  /** One room transient. Only valid, unexpired speech of this kingdom and origin is taken. */
  receive(message: ChatTransient | null | undefined): void;
  /** Advance to `now` (local ms) and return what is in the air. The array is reused between calls. */
  sample(now: number): readonly ChatLanternSample[];
  clear(): void;
  readonly size: number;
}

export function createChatLanterns(options: { readonly kingdomId: () => string; readonly origin: () => string; readonly radius: number; readonly clock?: () => number; readonly capacity?: number }): ChatLanternField {
  const clock = options.clock ?? Date.now, capacity = options.capacity ?? CHAT_LANTERNS.capacity;
  const seen = new Set<string>(), lanterns: (ChatLantern | null)[] = Array.from({ length: capacity }, () => null);
  let waiting: { id: string; words: string }[] = [];
  let lastRise = -Infinity, risen = 0;
  // One reusable sample per slot: sampling every frame allocates nothing.
  const pool: { -readonly [K in keyof ChatLanternSample]: ChatLanternSample[K] }[] = Array.from({ length: capacity }, (_, slot) =>
    ({ id: '', words: '', slot, angle: 0, reach: 0, born: 0, ends: 0, out: false, age: 0, glow: 0 }));
  const samples: ChatLanternSample[] = [];
  const remember = (id: string) => { seen.add(id); if (seen.size > 1024) seen.delete(seen.values().next().value!); };
  const takeDown = (id: string, now: number) => {
    waiting = waiting.filter(w => w.id !== id);
    for (const [slot, lantern] of lanterns.entries()) if (lantern?.id === id && !lantern.out) lanterns[slot] = { ...lantern, out: true, ends: Math.min(lantern.ends, now + CHAT_LANTERNS.outMs) };
  };
  const field: ChatLanternField = {
    receive(message) {
      if (!message) return;
      const now = clock();
      if (message.type === 'chat.clear') { field.clear(); return; }
      if (message.type === 'chat.remove' && 'cueIds' in message && Array.isArray(message.cueIds)) {
        for (const id of message.cueIds.slice(0, 1024)) if (TokenSchema.safeParse(id).success) { remember(id as string); takeDown(id as string, now); }
        return;
      }
      if (message.type !== 'chat' || !('cue' in message)) return;
      const parsed = CitizenChatCueSchema.safeParse(message.cue);
      if (!parsed.success) return;
      const cue = parsed.data;
      if (cue.kingdomId !== options.kingdomId() || cue.origin !== options.origin() || cue.expiresAt <= now || seen.has(cue.id)) return;
      remember(cue.id);
      const words = chatWords(cue);
      if (!words) return;
      waiting.push({ id: cue.id, words });
      if (waiting.length > CHAT_LANTERNS.waiting) waiting = waiting.slice(-CHAT_LANTERNS.waiting);
    },
    sample(now) {
      for (let slot = 0; slot < capacity; slot++) { const lantern = lanterns[slot]; if (lantern && now >= lantern.ends) lanterns[slot] = null; }
      if (waiting.length && now - lastRise >= CHAT_LANTERNS.spacingMs) {
        const slot = lanterns.indexOf(null);
        if (slot >= 0) {
          const next = waiting.shift()!, jitter = hash(next.id);
          // Golden-angle steps spread consecutive lines round the ring; the jitter keeps it from reading as a pattern.
          const angle = (risen++ * 2.399963 + jitter * .6) % (Math.PI * 2);
          lanterns[slot] = { id: next.id, words: next.words, slot, angle, reach: options.radius + 1.4 + hash(`${next.id}:r`) * 2.6,
            born: now, ends: now + CHAT_LANTERNS.lifeMs, out: false };
          lastRise = now;
        }
      }
      samples.length = 0;
      for (let slot = 0; slot < capacity; slot++) {
        const lantern = lanterns[slot];
        if (!lantern) continue;
        const age = Math.max(0, Math.min(1, (now - lantern.born) / CHAT_LANTERNS.lifeMs));
        const rise = smooth((now - lantern.born) / 900), fall = lantern.out ? Math.max(0, (lantern.ends - now) / CHAT_LANTERNS.outMs) : smooth((lantern.ends - now) / CHAT_LANTERNS.fadeMs);
        const sample = Object.assign(pool[slot]!, lantern);
        sample.age = age; sample.glow = Math.max(0, Math.min(rise, fall));
        samples.push(sample);
      }
      return samples;
    },
    clear() {
      waiting = [];
      const now = clock();
      for (const lantern of lanterns) if (lantern) takeDown(lantern.id, now);
    },
    get size() { return lanterns.reduce((n, l) => n + (l ? 1 : 0), 0); },
  };
  return field;
}
