// One real, read-only catalogue check through the production transport. Skipped unless asked for:
//   CHATDOM_EMOTES_LIVE=1 CHATDOM_EMOTES_LOGIN=tobi4s_ pnpm exec vitest run packages/emotes/src/server/live-read.test.ts
// Credentials come from ~/.config/chatdom/atlas.env and never leave this process; only redacted
// status and counts are written to shots/emotes/live-read-<login>.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '../deps';
import { createEmoteImageDecoder } from '../decode/index';
import { createMemoryEmoteBlobStore } from '../catalogue/blobs';
import { createCheckedEmoteTransport } from '../catalogue/checked-transport';
import { createEmoteCatalogueRefresher } from '../catalogue/refresh';
import { createThirdPartyEmoteAdapter } from '../catalogue/third-party';
import { createTwitchEmoteAdapter } from '../catalogue/twitch';
import { createNodePinnedGet, nodeResolve } from './node';

const live = process.env.CHATDOM_EMOTES_LIVE === '1';

function credentials(): { id: string; secret: string } {
  const text = readFileSync(`${homedir()}/.config/chatdom/atlas.env`, 'utf8'), read = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim().replace(/^["']|["']$/g, '');
  const id = read('TWITCH_CLIENT_ID'), secret = read('TWITCH_CLIENT_SECRET');
  if (!id || !secret) throw new Error('Twitch app credentials are missing.');
  return { id, secret };
}

describe.skipIf(!live)('Live read-only catalogue check', () => {
  it('reads a real channel through the checked transport', { timeout: 180_000 }, async () => {
    const { id, secret } = credentials();
    const token = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }) }).then(r => r.json()) as { access_token?: string };
    if (!token.access_token) throw new Error('No app token was issued.');
    const headers = { 'Client-Id': id, Authorization: `Bearer ${token.access_token}` };
    const login = process.env.CHATDOM_EMOTES_LOGIN ?? 'tobi4s_';
    const users = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, { headers }).then(r => r.json()) as { data?: { id: string }[] };
    const channelId = users.data?.[0]?.id;
    if (!channelId) throw new Error('The channel was not found.');

    const transport = createCheckedEmoteTransport({ get: createNodePinnedGet(), resolve: nodeResolve, helixHeaders: async () => headers });
    const refresher = createEmoteCatalogueRefresher({
      transport, decoder: createEmoteImageDecoder(), blobs: createMemoryEmoteBlobStore(),
      adapters: [createTwitchEmoteAdapter(transport), createThirdPartyEmoteAdapter('7tv', transport), createThirdPartyEmoteAdapter('bttv', transport), createThirdPartyEmoteAdapter('ffz', transport)],
    });
    const started = Date.now();
    const result = await refresher.refresh({ kingdomId: KingdomIdSchema.parse(channelId), channelId, reason: 'genesis', atMs: started, thirdParty: { '7tv': true, bttv: true, ffz: true }, previous: null }, new AbortController().signal);
    const summary = {
      checkedAt: new Date(started).toISOString(), login, durationMs: Date.now() - started, requests: result.requests,
      providers: Object.fromEntries(Object.entries(result.snapshot.providers).map(([provider, state]) => [provider, {
        health: state!.health, problem: state!.problem?.reason ?? null, listed: state!.entries.length, skipped: state!.skipped.length, truncated: state!.truncated,
        ready: state!.entries.filter(e => e.state === 'ready').length, animated: state!.entries.filter(e => e.animated && e.state === 'ready').length,
        renditions: state!.entries.reduce<Record<string, number>>((n, e) => ({ ...n, [e.rendition]: (n[e.rendition] ?? 0) + 1 }), {}),
        unavailable: state!.entries.filter(e => e.state === 'unavailable').map(e => e.problem?.code),
      }])),
    };
    mkdirSync('shots/emotes', { recursive: true });
    writeFileSync(`shots/emotes/live-read-${login}.json`, JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
    expect(result.snapshot.providers.twitch?.health).toBe('current');
  });
});
