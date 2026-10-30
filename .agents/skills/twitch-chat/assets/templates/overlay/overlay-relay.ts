/**
 * overlay-relay.ts — tiny backend for the chat overlay: serves the overlay files over HTTP and relays
 * EventSub chat events to every connected browser source over a WebSocket at /ws. Tokens stay here.
 *
 *   npm i ws && npx tsc -p overlay/tsconfig.json
 *   node overlay/overlay-relay.ts --demo        # fake messages, no Twitch needed (great for OBS layout work)
 *
 * Wire it to the bot (chatbot.ts):
 *   const relay = await startOverlayRelay({ port: 8131 });
 *   relay.setAssets(await fetchOverlayAssets({ clientId, token, broadcasterId }));
 *   makeDispatcher(router, { onAny: (type, event) => relay.forward(type, event) });
 * and subscribe the chat.* types the overlay handles (message, message_delete, clear_user_messages, clear).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ChatEventMap, ChatSubscriptionType, HelixBadgeSet, HelixCheermote, OverlayAssets, OverlayServerMessage, ChatMessageEvent,
} from '../chat-types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FORWARDED: ReadonlySet<string> = new Set<ChatSubscriptionType>([
  'channel.chat.message', 'channel.chat.message_delete', 'channel.chat.clear_user_messages', 'channel.chat.clear',
  'channel.chat.notification',
]);

export interface OverlayRelay {
  broadcast(msg: OverlayServerMessage): void;
  /** Forward a raw EventSub notification if it's a type the overlay understands. */
  forward(subscriptionType: string, event: unknown): void;
  setAssets(a: OverlayAssets): void;
  close(): Promise<void>;
  port: number;
}

export function startOverlayRelay(opts: { port?: number; host?: string; distDir?: string; htmlFile?: string } = {}): Promise<OverlayRelay> {
  const port = opts.port ?? Number(process.env.OVERLAY_PORT ?? 8131);
  const distDir = opts.distDir ?? join(HERE, 'dist', 'overlay');
  const htmlFile = opts.htmlFile ?? join(HERE, 'chat-overlay.html');
  let assets: OverlayAssets = { badges: {}, cheermotes: [] };

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      try {
        if (path === '/' || path === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(await readFile(htmlFile));
          return;
        }
        const file = normalize(join(distDir, path));
        if (file.startsWith(distDir) && file.endsWith('.js')) { // no path traversal, JS only
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
          res.end(await readFile(file));
          return;
        }
      } catch { /* fall through to 404 */ }
      res.writeHead(404).end('not found');
    })();
  });

  const wss = new WebSocketServer({ server: http, path: '/ws' });
  const send = (ws: WebSocket, msg: OverlayServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
  wss.on('connection', (ws) => send(ws, { kind: 'assets', assets }));
  const ping = setInterval(() => wss.clients.forEach((c) => send(c, { kind: 'ping' })), 25_000);

  const relay: OverlayRelay = {
    port,
    broadcast: (msg) => wss.clients.forEach((c) => send(c, msg)),
    forward: (type, event) => {
      if (!FORWARDED.has(type)) return;
      relay.broadcast({ kind: 'event', subscriptionType: type, event } as OverlayServerMessage);
    },
    setAssets: (a) => { assets = a; relay.broadcast({ kind: 'assets', assets }); },
    close: () => new Promise<void>((res) => { clearInterval(ping); wss.close(); http.close(() => res()); }),
  };
  // Bind to localhost by default: OBS runs on the same machine. Rejects on EADDRINUSE etc.
  return new Promise((resolve, reject) => {
    http.once('error', reject);
    wss.on('error', () => { /* surfaced via http 'error' */ });
    http.listen(port, opts.host ?? '127.0.0.1', () => resolve(relay));
  });
}

/**
 * Fetch badge images + cheermotes once (and on channel.chat.notification / every few hours if you like).
 * Any app or user token works for these endpoints. Channel badges override global ones for the same
 * set_id/id (subscriber + bits badges are channel-specific).
 */
export async function fetchOverlayAssets(o: { clientId: string; token: string; broadcasterId: string; helixBase?: string }): Promise<OverlayAssets> {
  const base = o.helixBase ?? 'https://api.twitch.tv/helix';
  const get = async <T>(path: string): Promise<T> => {
    const r = await fetch(base + path, { headers: { Authorization: `Bearer ${o.token}`, 'Client-Id': o.clientId } });
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
    return ((await r.json()) as { data: T }).data;
  };
  const id = encodeURIComponent(o.broadcasterId);
  const [global, channel, cheermotes] = await Promise.all([
    get<HelixBadgeSet[]>('/chat/badges/global'),
    get<HelixBadgeSet[]>(`/chat/badges?broadcaster_id=${id}`),
    get<HelixCheermote[]>(`/bits/cheermotes?broadcaster_id=${id}`),
  ]);
  const badges: OverlayAssets['badges'] = {};
  for (const set of [...global, ...channel]) {
    for (const v of set.versions) {
      badges[`${set.set_id}/${v.id}`] = { url1x: v.image_url_1x, url2x: v.image_url_2x, url4x: v.image_url_4x, title: v.title };
    }
  }
  return { badges, cheermotes };
}

// ---- demo mode: fake traffic so you can style the overlay without Twitch --------------------------

function demoMessage(i: number): ChatEventMap['channel.chat.message'] {
  const texts: ChatMessageEvent['message']['fragments'][] = [
    [{ type: 'text', text: 'Hello chat ' }, { type: 'emote', text: 'HeyGuys', emote: { id: '30259', emote_set_id: '0', owner_id: '0', format: ['static'] } }],
    [{ type: 'text', text: 'this is <b>not</b> html & stays text' }],
    [{ type: 'mention', text: '@streamer', mention: { user_id: '1', user_login: 'streamer', user_name: 'Streamer' } }, { type: 'text', text: ' gg!' }],
  ];
  const fragments = texts[i % texts.length] ?? [];
  return {
    broadcaster_user_id: '1', broadcaster_user_login: 'streamer', broadcaster_user_name: 'Streamer',
    chatter_user_id: String(100 + (i % 5)), chatter_user_login: `viewer${i % 5}`, chatter_user_name: `Viewer${i % 5}`,
    message_id: `demo-${i}`, message: { text: fragments.map((f) => f.text).join(''), fragments },
    message_type: 'text', badges: i % 2 ? [{ set_id: 'vip', id: '1', info: '' }] : [],
    cheer: null, color: i % 3 ? '#1E90FF' : '', reply: null, channel_points_custom_reward_id: null,
    source_broadcaster_user_id: null, source_broadcaster_user_login: null, source_broadcaster_user_name: null,
    source_message_id: null, source_badges: null,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = await startOverlayRelay();
  console.log(`overlay: http://127.0.0.1:${relay.port}/   ws: ws://127.0.0.1:${relay.port}/ws`);
  if (process.argv.includes('--demo')) {
    // VIP badge URL taken from the Get Global Chat Badges example response in the official docs.
    const vip = 'https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/';
    relay.setAssets({ badges: { 'vip/1': { url1x: vip + '1', url2x: vip + '2', url4x: vip + '3', title: 'VIP' } }, cheermotes: [] });
    let i = 0;
    setInterval(() => {
      relay.forward('channel.chat.message', demoMessage(i));
      if (i % 7 === 6) relay.forward('channel.chat.message_delete', { message_id: `demo-${i - 1}` });
      i++;
    }, 1500);
  }
}
