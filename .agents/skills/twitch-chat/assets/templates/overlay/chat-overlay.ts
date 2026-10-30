/**
 * chat-overlay.ts — browser-source chat overlay (OBS / Streamlabs / any browser).
 *
 * Connects to YOUR backend over a plain WebSocket (see overlay-relay.ts) which forwards EventSub chat
 * events as JSON (protocol: OverlayServerMessage in ../chat-types.ts). Never put Twitch tokens in an
 * overlay: the URL of a browser source is easy to leak on stream.
 *
 * Query params (all optional):
 *   ws=ws://localhost:8131/ws  backend WebSocket URL (default: same host, path /ws)
 *   max=30                    max messages kept on screen
 *   fade=0                    seconds before a message fades out (0 = never)
 *   theme=dark|light          emote theme_mode (match your background)
 *   scale=1.0|2.0|3.0         emote scale requested from the CDN (rendered at CSS size)
 *   hideCommands=1            hide messages starting with "!"
 *   hide=<id>,<id>            user ids to hide (e.g. your bot)
 *   highlight=<login>         highlight @mentions of this login
 *
 * SECURITY: every piece of user-controlled text goes through textContent / setAttribute — never
 * innerHTML. URLs are https-checked, colors regex-checked (see render-model.ts).
 */
import type { ChatMessageEvent, OverlayAssets, OverlayServerMessage } from '../chat-types.js';
import { buildMessageNodes, shouldDisplay, type EmoteScale, type EmoteTheme, type RenderNode } from './render-model.js';

const params = new URLSearchParams(location.search);
const cfg = {
  wsUrl: params.get('ws') ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  max: Number(params.get('max') ?? 30),
  fadeSec: Number(params.get('fade') ?? 0),
  theme: (params.get('theme') === 'light' ? 'light' : 'dark') as EmoteTheme,
  scale: (['1.0', '2.0', '3.0'].includes(params.get('scale') ?? '') ? params.get('scale') : '2.0') as EmoteScale,
  hideCommands: params.get('hideCommands') === '1',
  hideUserIds: (params.get('hide') ?? '').split(',').filter(Boolean),
  highlight: params.get('highlight')?.toLowerCase(),
};

let assets: OverlayAssets = { badges: {}, cheermotes: [] };
const root = document.getElementById('chat') as HTMLElement;

/** Render nodes into DOM elements using only safe APIs. */
export function toElement(nodes: RenderNode[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const n of nodes) {
    switch (n.kind) {
      case 'badge': {
        const img = document.createElement('img');
        img.className = 'badge'; img.src = n.url; img.alt = n.title; img.title = n.title;
        frag.append(img);
        break;
      }
      case 'name': {
        const s = document.createElement('span');
        s.className = 'name'; s.textContent = n.text; s.style.color = n.color; // color validated upstream
        frag.append(s, document.createTextNode(': '));
        break;
      }
      case 'text': frag.append(document.createTextNode(n.text)); break;
      case 'mention': {
        const s = document.createElement('span');
        s.className = n.highlight ? 'mention highlight' : 'mention'; s.textContent = n.text;
        frag.append(s);
        break;
      }
      case 'emote': case 'gif': {
        const img = document.createElement('img');
        img.className = n.kind; img.src = n.url; img.alt = n.alt; img.title = n.alt;
        img.decoding = 'async';
        img.onerror = () => img.replaceWith(document.createTextNode(n.alt)); // fallback to text
        frag.append(img);
        break;
      }
      case 'cheer': {
        if (n.url) {
          const img = document.createElement('img');
          img.className = 'emote'; img.src = n.url; img.alt = n.alt;
          frag.append(img);
        }
        const s = document.createElement('span');
        s.className = 'cheer'; s.textContent = String(n.bits); s.style.color = /^#[0-9a-f]{6}$/i.test(n.color) ? n.color : '';
        frag.append(s);
        break;
      }
    }
  }
  return frag;
}

function addMessage(ev: ChatMessageEvent): void {
  if (!shouldDisplay(ev, { hideCommands: cfg.hideCommands, hideUserIds: cfg.hideUserIds })) return;
  const row = document.createElement('div');
  row.className = 'msg';
  row.dataset.msgId = ev.message_id;
  row.dataset.userId = ev.chatter_user_id;
  if (ev.message_type === 'channel_points_highlighted') row.classList.add('highlighted');
  row.append(toElement(buildMessageNodes(ev, assets, {
    theme: cfg.theme, scale: cfg.scale, preferAnimated: true, highlightLogin: cfg.highlight,
  })));
  root.append(row);
  while (root.children.length > cfg.max) root.firstElementChild?.remove();
  if (cfg.fadeSec > 0) {
    setTimeout(() => { row.classList.add('out'); setTimeout(() => row.remove(), 600); }, cfg.fadeSec * 1000);
  }
}

function removeWhere(pred: (el: HTMLElement) => boolean): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.msg'))) if (pred(el)) el.remove();
}

function handle(msg: OverlayServerMessage): void {
  if (msg.kind === 'assets') { assets = msg.assets; return; }
  if (msg.kind !== 'event') return;
  switch (msg.subscriptionType) {
    case 'channel.chat.message': addMessage(msg.event); break;
    // Moderation MUST be reflected on stream, or deleted/banned content stays visible:
    case 'channel.chat.message_delete': removeWhere((el) => el.dataset.msgId === msg.event.message_id); break;
    case 'channel.chat.clear_user_messages': removeWhere((el) => el.dataset.userId === msg.event.target_user_id); break;
    case 'channel.chat.clear': root.replaceChildren(); break;
    default: break; // notifications etc.: render alerts elsewhere
  }
}

function connect(delay = 1000): void {
  const ws = new WebSocket(cfg.wsUrl);
  ws.onopen = () => { delay = 1000; };
  ws.onmessage = (e) => {
    try { handle(JSON.parse(String(e.data)) as OverlayServerMessage); } catch (err) { console.error('bad frame', err); }
  };
  ws.onclose = () => setTimeout(() => connect(Math.min(delay * 2, 30_000)), delay);
}

connect();
