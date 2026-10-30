// Demo / smoke run for eventsub-ws-client.ts (kept separate so the client works with a trimmed types.ts).
// Needs a USER token with moderator:read:followers + user:read:chat + bits:read for the subscriptions below.
//   TWITCH_CLIENT_ID=… TWITCH_USER_TOKEN=… TWITCH_BROADCASTER_ID=… node eventsub-ws-demo.ts
//   CLI mock: EVENTSUB_WS_URL=ws://127.0.0.1:8080/ws TWITCH_HELIX_URL=http://127.0.0.1:8080 node eventsub-ws-demo.ts
import { EventSubWsClient } from './eventsub-ws-client.ts';

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) { console.error(`missing env ${k}`); process.exit(1); }
  return v;
};
const broadcaster = env('TWITCH_BROADCASTER_ID');
const me = env('TWITCH_USER_ID', broadcaster); // the token's user (moderator / bot)
const client = new EventSubWsClient({
  clientId: env('TWITCH_CLIENT_ID'),
  getUserToken: () => env('TWITCH_USER_TOKEN'),
  url: process.env.EVENTSUB_WS_URL,
  helixBase: process.env.TWITCH_HELIX_URL,
  subscriptions: [
    { type: 'channel.follow', version: '2', condition: { broadcaster_user_id: broadcaster, moderator_user_id: me } },
    { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: broadcaster, user_id: me } },
    { type: 'channel.cheer', version: '1', condition: { broadcaster_user_id: broadcaster } },
    { type: 'stream.online', version: '1', condition: { broadcaster_user_id: broadcaster } },
  ],
});
client.on('channel.follow', (e) => console.log(`[follow] ${e.user_name} → ${e.broadcaster_user_name}`));
client.on('channel.chat.message', (e) => {
  if (e.chatter_user_id === me) return; // ignore our own bot's messages (they are delivered too)
  console.log(`[chat] ${e.chatter_user_name}: ${e.message.text}`);
});
client.onAny((e) => {
  switch (e.type) {
    case 'channel.cheer':
      console.log(`[cheer] ${e.event.bits} bits from ${e.event.user_name ?? 'anonymous'}`);
      break;
    case 'stream.online':
      console.log(`[online] type=${e.event.type}`);
      break;
    default:
      console.log(`[any] ${e.type} v${e.version}`);
  }
});
client.start();
process.on('SIGINT', () => { client.stop(); process.exit(0); });
