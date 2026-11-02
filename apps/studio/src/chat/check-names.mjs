// Checks that every invented chatter login is not a real Twitch account.
//
// Run: node --env-file=$HOME/.config/chatdom/atlas.env apps/studio/src/chat/check-names.mjs
//
// It asks Helix Get Users (app token, batches of 100 logins) about every login in the roster and
// writes `names-checked.json` next to this file: each login, whether it came back absent, and
// when it was checked. It exits with code 1 and lists the taken logins if any came back present.
// The credentials are read from the environment only and never printed, logged or written.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, URLSearchParams } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { roster } = await import(join(here, 'roster.ts'));

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

const logins = [...new Set(roster.map((p) => p.login))];
const malformed = logins.filter((l) => !/^[a-z0-9_]{4,25}$/.test(l) || l.startsWith('_'));
if (malformed.length) {
  console.error(`not valid Twitch logins: ${malformed.join(', ')}`);
  process.exit(1);
}

const present = new Map();
for (let i = 0; i < logins.length; i += 100) {
  const batch = logins.slice(i, i + 100);
  const url = 'https://api.twitch.tv/helix/users?' + batch.map((l) => `login=${encodeURIComponent(l)}`).join('&');
  const response = await fetch(url, { headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    console.error(`Get Users failed with status ${response.status}`);
    process.exit(2);
  }
  const { data } = await response.json();
  for (const user of data) present.set(user.login.toLowerCase(), user.created_at);
}

const checkedAt = new Date().toISOString();
const result = {
  method: 'Helix Get Users with an app token, batches of 100 logins; absent means no account with that login was returned',
  checkedAt,
  logins: logins.map((login) => ({ login, absent: !present.has(login), checkedAt })),
};
writeFileSync(join(here, 'names-checked.json'), JSON.stringify(result, null, 2) + '\n');

const taken = logins.filter((l) => present.has(l));
console.log(`${logins.length} logins checked, ${logins.length - taken.length} absent, ${taken.length} taken`);
if (taken.length) {
  console.log(`taken: ${taken.join(', ')}`);
  process.exit(1);
}
