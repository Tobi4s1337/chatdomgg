/**
 * render-model.ts — PURE (no DOM) conversion of a channel.chat.message event into a list of render
 * nodes. Shared by chat-overlay.ts (browser) and unit tests (Node). No value imports => runs under
 * Node's native type stripping and compiles to plain browser ESM.
 */
import type { ChatBadge, ChatMessageEvent, HelixCheermote, OverlayAssets } from '../chat-types.js';

export type EmoteTheme = 'light' | 'dark';
export type EmoteScale = '1.0' | '2.0' | '3.0';

export interface RenderOptions {
  theme: EmoteTheme;      // emote theme_mode: pick the one matching your overlay background
  scale: EmoteScale;      // 1.0 = 28px, 2.0 = 56px, 3.0 = 112px
  preferAnimated: boolean;
  /** Lower-cased login of the viewer to highlight mentions of (e.g. the broadcaster). */
  highlightLogin?: string;
}

export type RenderNode =
  | { kind: 'badge'; url: string; title: string }
  | { kind: 'name'; text: string; color: string }
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; highlight: boolean }
  | { kind: 'emote'; url: string; alt: string }
  | { kind: 'cheer'; url: string | null; alt: string; color: string; bits: number }
  | { kind: 'gif'; url: string; alt: string };

/** Official template from Get Global/Channel Emotes: https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}} */
export const EMOTE_TEMPLATE = 'https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}}';

export function emoteUrl(id: string, format: 'static' | 'animated', theme: EmoteTheme, scale: EmoteScale, template = EMOTE_TEMPLATE): string {
  return template
    .replace('{{id}}', encodeURIComponent(id))
    .replace('{{format}}', format)
    .replace('{{theme_mode}}', theme)
    .replace('{{scale}}', scale);
}

/** Twitch's named default chat colors (Update User Chat Color list) as CSS hex. Used when `color` is "". */
export const DEFAULT_NAME_COLORS = [
  '#0000FF', '#8A2BE2', '#5F9EA0', '#D2691E', '#FF7F50', '#1E90FF', '#B22222', '#DAA520',
  '#008000', '#FF69B4', '#FF4500', '#FF0000', '#2E8B57', '#00FF7F', '#9ACD32',
];

/** Validated "#RRGGBB" or a deterministic fallback derived from the user id. Never returns arbitrary CSS. */
export function nameColor(color: string | null | undefined, userId: string): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DEFAULT_NAME_COLORS[h % DEFAULT_NAME_COLORS.length] ?? '#9146FF';
}

/** Only allow https URLs into src attributes (defense in depth; Twitch gives https CDN URLs). */
export function safeHttpsUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try { return new URL(u).protocol === 'https:' ? u : null; } catch { return null; }
}

export function badgeNodes(badges: ChatBadge[], assets: OverlayAssets): RenderNode[] {
  const out: RenderNode[] = [];
  for (const b of badges) {
    const img = assets.badges[`${b.set_id}/${b.id}`];
    const url = safeHttpsUrl(img?.url2x);
    if (img && url) out.push({ kind: 'badge', url, title: img.title });
  }
  return out;
}

/** Pick the cheermote tier image: highest tier whose min_bits <= bits. */
export function cheerImage(cheermotes: HelixCheermote[], prefix: string, bits: number, theme: EmoteTheme, animated: boolean):
  { url: string | null; color: string } {
  const cm = cheermotes.find((c) => c.prefix.toLowerCase() === prefix.toLowerCase());
  if (!cm) return { url: null, color: '#9146FF' };
  const tier = [...cm.tiers].sort((a, b) => b.min_bits - a.min_bits).find((t) => t.min_bits <= bits) ?? cm.tiers[0];
  if (!tier) return { url: null, color: '#9146FF' };
  const url = tier.images[theme]?.[animated ? 'animated' : 'static']?.['2'] ?? null;
  return { url: safeHttpsUrl(url), color: tier.color };
}

export function buildMessageNodes(ev: ChatMessageEvent, assets: OverlayAssets, opts: RenderOptions): RenderNode[] {
  const nodes: RenderNode[] = [...badgeNodes(ev.badges, assets)];
  nodes.push({ kind: 'name', text: ev.chatter_user_name || ev.chatter_user_login, color: nameColor(ev.color, ev.chatter_user_id) });

  let fragments = ev.message.fragments;
  // Replies start with an auto-inserted "@parent " mention; most overlays drop it and show a reply hint instead.
  if (ev.reply && fragments[0]?.type === 'mention' && fragments[0].mention.user_id === ev.reply.parent_user_id) {
    fragments = fragments.slice(1);
    if (fragments[0]?.type === 'text') fragments = [{ ...fragments[0], text: fragments[0].text.replace(/^\s+/, '') }, ...fragments.slice(1)];
  }

  for (const f of fragments) {
    switch (f.type) {
      case 'emote': {
        const fmt = opts.preferAnimated && f.emote.format.includes('animated') ? 'animated' : 'static';
        nodes.push({ kind: 'emote', url: emoteUrl(f.emote.id, fmt, opts.theme, opts.scale), alt: f.text });
        break;
      }
      case 'cheermote': {
        const img = cheerImage(assets.cheermotes, f.cheermote.prefix, f.cheermote.bits, opts.theme, opts.preferAnimated);
        nodes.push({ kind: 'cheer', url: img.url, alt: f.text, color: img.color, bits: f.cheermote.bits });
        break;
      }
      case 'mention':
        nodes.push({ kind: 'mention', text: f.text, highlight: !!opts.highlightLogin && f.mention.user_login.toLowerCase() === opts.highlightLogin });
        break;
      case 'gif': {
        // Use the URL exactly as provided (docs: must not be modified) — only check it's https.
        const url = safeHttpsUrl(f.gif?.url);
        nodes.push(url ? { kind: 'gif', url, alt: f.text } : { kind: 'text', text: f.text });
        break;
      }
      default:
        // 'text' and any future fragment type: render the literal text (always present).
        nodes.push({ kind: 'text', text: (f as { text: string }).text });
    }
  }
  return nodes;
}

/** Overlays usually hide bot commands and the bot's own replies. */
export function shouldDisplay(ev: ChatMessageEvent, o: { hideCommands: boolean; hideUserIds: string[] }): boolean {
  if (o.hideUserIds.includes(ev.chatter_user_id)) return false;
  if (o.hideCommands && ev.message.text.trimStart().startsWith('!')) return false;
  return true;
}
