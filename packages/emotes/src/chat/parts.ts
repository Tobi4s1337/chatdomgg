import type { CitizenChatCue } from '../deps';
import { emoteKey } from '../catalogue/policy';

/** One piece of a bubble as every surface draws it: words stay words; an emote names its catalogue key. */
export type EmoteChatPart =
  | { readonly kind: 'text'; readonly text: string }
  | {
    readonly kind: 'emote';
    /** Provider-qualified catalogue key (`twitch.<id>`, `7tv.<id>`, …). */
    readonly id: string;
    /** What chat typed. Shown as plain words whenever the image is unknown, unavailable or retired. */
    readonly alt: string;
    /** `fragment`: Twitch marked it in the message. `token`: an opted-in third-party name matched exactly. */
    readonly from: 'fragment' | 'token';
  };

/**
 * Exact names of third-party emotes the monarch opted in, each to its catalogue key. Absent or empty
 * means the tokenizer is off: no third-party name is ever matched.
 */
export type ThirdPartyEmoteTokens = ReadonlyMap<string, string>;

/** A run of whitespace or a run of anything else; whitespace is kept so the words read as typed. */
const WORDS = /\s+|\S+/g;

/**
 * Splits plain text on whitespace and replaces a whole word only when it equals an opted-in name
 * exactly, case and all. A name inside a longer word, a URL, punctuation or another emote's fragment
 * never matches; Twitch emotes are never guessed from text at all (they come only from fragments).
 */
function tokenize(text: string, tokens: ThirdPartyEmoteTokens | null | undefined, out: EmoteChatPart[]): void {
  if (!tokens || tokens.size === 0) { out.push({ kind: 'text', text }); return; }
  let pending = '';
  for (const word of text.match(WORDS) ?? []) {
    const id = /\s/.test(word[0]!) ? undefined : tokens.get(word);
    if (id === undefined || word.length > 32) { pending += word; continue; }
    if (pending) { out.push({ kind: 'text', text: pending }); pending = ''; }
    out.push({ kind: 'emote', id, alt: word, from: 'token' });
  }
  if (pending) out.push({ kind: 'text', text: pending });
}

/**
 * The cue's ordered parts as inline parts. Twitch emote fragments become their catalogue key; text
 * stays text (never markup) and only passes through the explicitly enabled third-party tokenizer.
 */
export function emoteChatParts(parts: CitizenChatCue['parts'], thirdParty?: ThirdPartyEmoteTokens | null): EmoteChatPart[] {
  const out: EmoteChatPart[] = [];
  for (const part of parts) {
    if (part.kind === 'emote') out.push({ kind: 'emote', id: emoteKey('twitch', part.id), alt: part.alt, from: 'fragment' });
    else tokenize(part.text, thirdParty, out);
  }
  return out;
}

/** The single emote of a message that is that emote and nothing but optional whitespace, else null. */
export function soleEmote(parts: readonly EmoteChatPart[]): Extract<EmoteChatPart, { kind: 'emote' }> | null {
  let found: Extract<EmoteChatPart, { kind: 'emote' }> | null = null;
  for (const part of parts) {
    if (part.kind === 'text') { if (part.text.trim()) return null; continue; }
    if (found) return null;
    found = part;
  }
  return found;
}
