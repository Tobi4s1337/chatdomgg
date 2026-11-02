// Verifies the chat vocabulary against Helix and downloads the images chat needs into the media
// folder (never into git):
//   reference/emotes/<id>.png          every emote in emotes.ts (static, dark theme, scale 2.0)
//   reference/badges/<set>-<version>.png  every badge the roster and the notices can show (2x)
//   reference/avatars/pinkkittyrose.png   the raid notice avatar
//   reference/avatars/me.png              Twitch's default avatar, for the logged-in viewer
//
// Run: node --env-file=$HOME/.config/chatdom/atlas.env apps/studio/src/chat/fetch-reference.mjs
// The credentials are read from the environment only and never printed, logged or written.
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, URLSearchParams } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { EMOTE_LIST } = await import(join(here, 'emotes.ts'));
const { badgesInUse, PINKKITTYROSE, ME_AVATAR_SOURCE } = await import(join(here, 'roster.ts'));

const MEDIA = process.env.TEASER_MEDIA ?? '/srv/chatdom/media/teaser';
const CHANNELS = { tobi4s_: 'tobi4s_', pinkkittyrose: 'pinkkittyrose', the_aggman: 'the_aggman', mashad4: 'mashad4' };

const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET (run with --env-file=$HOME/.config/chatdom/atlas.env)');
  process.exit(2);
}
const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
  method: 'POST',
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
});
if (!tokenResponse.ok) {
  console.error(`app token request failed with status ${tokenResponse.status}`);
  process.exit(2);
}
const { access_token: token } = await tokenResponse.json();
async function helix(path) {
  const response = await fetch(`https://api.twitch.tv/helix/${path}`, { headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Helix ${path.split('?')[0]} failed with status ${response.status}`);
  return response.json();
}

// The emotes Helix knows today, by owner.
const known = { global: new Map() };
for (const e of (await helix('chat/emotes/global')).data) known.global.set(e.name, e);
const users = (await helix('users?' + Object.values(CHANNELS).map((l) => `login=${l}`).join('&'))).data;
for (const owner of Object.keys(CHANNELS)) {
  const user = users.find((u) => u.login === CHANNELS[owner]);
  if (!user) throw new Error(`channel ${owner} not found`);
  known[owner] = new Map((await helix(`chat/emotes?broadcaster_id=${user.id}`)).data.map((e) => [e.name, e]));
}

const problems = [];
for (const e of EMOTE_LIST) {
  const live = known[e.owner]?.get(e.code);
  if (!live) problems.push(`${e.code} (${e.owner}) is no longer returned by Helix`);
  else if (live.id !== e.id) problems.push(`${e.code} (${e.owner}) has id ${live.id}, emotes.ts says ${e.id}`);
  else if (e.owner !== 'global' && live.emote_type !== 'subscriptions') problems.push(`${e.code} is a ${live.emote_type} emote, only usable in its own channel`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

async function download(url, file) {
  if (existsSync(file)) return false;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return true;
}

const emoteDir = join(MEDIA, 'reference/emotes');
const badgeDir = join(MEDIA, 'reference/badges');
const avatarDir = join(MEDIA, 'reference/avatars');
for (const d of [emoteDir, badgeDir, avatarDir]) mkdirSync(d, { recursive: true });

let fetched = 0;
for (const e of EMOTE_LIST) {
  if (await download(`https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/static/dark/2.0`, join(emoteDir, `${e.id}.png`))) fetched++;
}

const globalBadges = (await helix('chat/badges/global')).data;
for (const b of badgesInUse()) {
  const version = globalBadges.find((s) => s.set_id === b.set)?.versions.find((v) => v.id === b.version);
  if (!version) throw new Error(`badge ${b.set}/${b.version} is not a global badge`);
  if (await download(version.image_url_2x, join(badgeDir, `${b.set}-${b.version}.png`))) fetched++;
}

if (await download(PINKKITTYROSE.avatarSource, join(avatarDir, 'pinkkittyrose.png'))) fetched++;
if (await download(ME_AVATAR_SOURCE, join(avatarDir, 'me.png'))) fetched++;

console.log(`${EMOTE_LIST.length} emotes verified, ${badgesInUse().length} badges, ${fetched} files downloaded into ${MEDIA}/reference`);
