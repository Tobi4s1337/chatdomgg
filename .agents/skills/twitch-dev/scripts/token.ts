#!/usr/bin/env node
// Twitch OAuth helper for local development. Zero dependencies, Node >= 22.18 (runs .ts directly).
//
//   node scripts/token.ts app                                   client-credentials -> app access token
//   node scripts/token.ts login  --scopes "a b" [--name bot]    authorization-code flow via http://localhost:3000
//   node scripts/token.ts device --scopes "a b" [--name bot]    device code flow (DCF): prints URL, polls
//   node scripts/token.ts validate [--name bot | --app | --token T]   GET /oauth2/validate
//   node scripts/token.ts refresh  [--name bot]                 refresh a stored user token
//   node scripts/token.ts revoke   [--name bot | --app | --token T]
//   node scripts/token.ts show                                  print the token file (secrets masked)
//   node scripts/token.ts scopes <query>                        which scopes unlock an endpoint/event/scope
//
// Config (env or flags):
//   TWITCH_CLIENT_ID      / --client-id       required
//   TWITCH_CLIENT_SECRET  / --client-secret   required for app/login/refresh of confidential clients;
//                                             omit for PUBLIC clients (device flow + refresh work without it)
//   TWITCH_TOKEN_FILE     / --file            JSON store (default ./.twitch-tokens.json). Add it to .gitignore!
//   TWITCH_AUTH_BASE      / --auth-base       default https://id.twitch.tv/oauth2 ; for the Twitch CLI mock
//                                             API use http://localhost:<port>/auth (only `app` is supported there)
//   --redirect-uri  (login)  default http://localhost:3000 - must be registered EXACTLY in the dev console
//   --dry-run                print the HTTP request that would be sent and exit (no network)
//   --force-verify  (login)  always show the consent screen (useful to switch accounts)
//
// Token file shape: { "app": Stored, "users": { "<name>": Stored } }   (name defaults to the user's login)
// Only erasable TypeScript syntax is used so `node file.ts` works without a build step.

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Stored {
	access_token: string;
	refresh_token?: string;
	scope: string[];
	expires_at: number | null; // epoch ms; null = unknown
	obtained_at: number;
	user_id?: string;
	login?: string;
	client_id: string;
	flow: 'client_credentials' | 'authorization_code' | 'device_code' | 'refresh';
}
interface TokenFile { app?: Stored; users: Record<string, Stored> }
interface TokenResponse { access_token: string; refresh_token?: string; expires_in?: number; scope?: string[] | string; token_type?: string }
interface ValidateResponse { client_id: string; login: string | null; user_id: string | null; scopes: string[] | null; expires_in: number }

// ---------- args ----------
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'help';
function opt(name: string): string | undefined {
	const i = argv.indexOf(`--${name}`);
	if (i < 0) return undefined;
	const v = argv[i + 1];
	return v === undefined || v.startsWith('--') ? '' : v;
}
const has = (name: string) => argv.includes(`--${name}`);
const positional = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(i > 0 && arr[i - 1]!.startsWith('--') && !['--dry-run', '--app', '--force-verify'].includes(arr[i - 1]!)));

const clientId = opt('client-id') ?? process.env.TWITCH_CLIENT_ID ?? '';
const clientSecret = opt('client-secret') ?? process.env.TWITCH_CLIENT_SECRET ?? '';
const file = opt('file') ?? process.env.TWITCH_TOKEN_FILE ?? '.twitch-tokens.json';
const authBase = (opt('auth-base') ?? process.env.TWITCH_AUTH_BASE ?? 'https://id.twitch.tv/oauth2').replace(/\/$/, '');
const dryRun = has('dry-run');
const scopes = (opt('scopes') ?? '').split(/[\s,]+/).filter(Boolean);

function die(msg: string, code = 1): never {
	console.error(`error: ${msg}`);
	process.exit(code);
}
function needClientId(): void {
	if (!clientId) die('set TWITCH_CLIENT_ID (or --client-id). Register an app at https://dev.twitch.tv/console/apps');
}

// ---------- storage ----------
function load(): TokenFile {
	if (!existsSync(file)) return { users: {} };
	const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<TokenFile>;
	return { app: data.app, users: data.users ?? {} };
}
function save(data: TokenFile): void {
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); // owner-only: these are passwords
	renameSync(tmp, file); // atomic replace: never leave a half-written file (refresh tokens may be single-use!)
}
function toStored(t: TokenResponse, flow: Stored['flow']): Stored {
	const now = Date.now();
	return {
		access_token: t.access_token,
		refresh_token: t.refresh_token || undefined,
		scope: Array.isArray(t.scope) ? t.scope : (t.scope ?? '').split(' ').filter(Boolean),
		expires_at: typeof t.expires_in === 'number' ? now + t.expires_in * 1000 : null,
		obtained_at: now,
		client_id: clientId,
		flow,
	};
}
const mask = (s?: string) => (s ? `${s.slice(0, 4)}…${s.slice(-3)} (${s.length} chars)` : undefined);

// ---------- HTTP ----------
async function post(path: string, form: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
	const body = new URLSearchParams(form); // x-www-form-urlencoded: URL-encodes refresh tokens for us
	const url = `${authBase}/${path}`;
	if (dryRun) {
		const shown = Object.fromEntries([...body].map(([k, v]) => [k, k === 'client_secret' || k.endsWith('token') ? '<redacted>' : v]));
		console.log(JSON.stringify({ dryRun: true, method: 'POST', url, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: shown }, null, 2));
		process.exit(0);
	}
	const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
	const text = await res.text();
	let json: Record<string, unknown> = {};
	try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { json = { raw: text }; }
	return { status: res.status, json };
}
async function validate(token: string): Promise<ValidateResponse | null> {
	if (dryRun) {
		console.log(JSON.stringify({ dryRun: true, method: 'GET', url: `${authBase}/validate`, headers: { Authorization: 'OAuth <token>' } }, null, 2));
		process.exit(0);
	}
	const res = await fetch(`${authBase}/validate`, { headers: { Authorization: `OAuth ${token}` } });
	if (res.status === 401) return null;
	if (!res.ok) die(`validate failed: HTTP ${res.status} ${await res.text()}`);
	return (await res.json()) as ValidateResponse;
}
function fail(what: string, r: { status: number; json: Record<string, unknown> }): never {
	die(`${what} failed: HTTP ${r.status} ${JSON.stringify(r.json)}`);
}

// ---------- user helpers ----------
async function storeUser(t: TokenResponse, flow: Stored['flow'], nameOpt?: string): Promise<void> {
	const s = toStored(t, flow);
	const info = await validate(s.access_token);
	if (!info) die('Twitch returned a token that does not validate?!');
	s.user_id = info.user_id ?? undefined;
	s.login = info.login ?? undefined;
	const name = nameOpt || info.login || 'user';
	const data = load();
	data.users[name] = s;
	save(data);
	console.log(`saved user token "${name}" (login=${s.login} id=${s.user_id}) scopes=[${s.scope.join(' ')}] -> ${file}`);
	if (flow === 'device_code' && !clientSecret)
		console.log('note: public client - refresh tokens are SINGLE-USE and expire after 30 days unused; always persist the newest one.');
}
function pickUser(data: TokenFile): [string, Stored] {
	const name = opt('name');
	const entries = Object.entries(data.users);
	if (name) {
		const s = data.users[name];
		if (!s) die(`no user "${name}" in ${file} (have: ${entries.map((e) => e[0]).join(', ') || 'none'})`);
		return [name, s];
	}
	if (entries.length === 1) return entries[0]!;
	die(entries.length ? `several users stored - pass --name (${entries.map((e) => e[0]).join(', ')})` : `no user tokens in ${file}; run login or device first`);
}

// ---------- commands ----------
async function cmdApp(): Promise<void> {
	needClientId();
	if (!clientSecret && !dryRun) die('client credentials flow needs TWITCH_CLIENT_SECRET (public clients cannot get app tokens)');
	const r = await post('token', { client_id: clientId, client_secret: clientSecret || '<secret>', grant_type: 'client_credentials' });
	if (r.status !== 200) fail('client_credentials', r);
	const data = load();
	data.app = toStored(r.json as unknown as TokenResponse, 'client_credentials');
	save(data);
	const days = data.app.expires_at ? ((data.app.expires_at - Date.now()) / 86400000).toFixed(1) : '?';
	console.log(`saved app access token (expires in ~${days} days; app tokens cannot be refreshed - just request a new one) -> ${file}`);
}

async function cmdLogin(): Promise<void> {
	needClientId();
	if (!clientSecret) die('authorization code flow needs TWITCH_CLIENT_SECRET (use `device` for public clients)');
	if (!scopes.length) console.warn('warning: no --scopes given; the token will only be able to read public data');
	const redirectUri = opt('redirect-uri') ?? 'http://localhost:3000';
	const u = new URL(redirectUri);
	const state = randomBytes(16).toString('hex');
	const authorize = new URL(`${authBase}/authorize`);
	authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: scopes.join(' '), state, ...(has('force-verify') ? { force_verify: 'true' } : {}) }).toString();
	if (dryRun) { console.log(JSON.stringify({ dryRun: true, open: authorize.toString(), listen: `${u.hostname}:${u.port || 80}${u.pathname}` }, null, 2)); return; }
	const code = await new Promise<string>((resolve, reject) => {
		const server = createServer((req, res) => {
			const q = new URL(req.url ?? '/', redirectUri).searchParams;
			if (!q.has('code') && !q.has('error')) { res.writeHead(404).end(); return; }
			const ok = q.get('state') === state && q.get('code');
			res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain' }).end(ok ? 'Twitch login complete - you can close this tab.' : `Login failed: ${q.get('error_description') ?? 'state mismatch'}`);
			server.close();
			ok ? resolve(q.get('code')!) : reject(new Error(q.get('error_description') ?? 'state mismatch (possible CSRF) - ignored'));
		});
		server.listen(Number(u.port || 80), u.hostname, () => {
			console.log(`Open this URL in a browser logged in as the account to authorize (use a private window for a 2nd account):\n\n  ${authorize}\n\nWaiting on ${redirectUri} ...`);
		});
		server.on('error', reject);
	});
	const r = await post('token', { client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
	if (r.status !== 200) fail('authorization_code exchange', r);
	await storeUser(r.json as unknown as TokenResponse, 'authorization_code', opt('name'));
}

async function cmdDevice(): Promise<void> {
	needClientId();
	if (!scopes.length) die('device flow needs --scopes "scope1 scope2"');
	// Twitch's DCF endpoint takes `scopes` (plural), unlike /authorize which takes `scope`.
	const start = await post('device', { client_id: clientId, scopes: scopes.join(' ') });
	if (start.status !== 200) fail('device authorization', start);
	const d = start.json as { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };
	console.log(`\nOpen ${d.verification_uri}\n(code: ${d.user_code}) and approve. Expires in ${Math.round(d.expires_in / 60)} min; polling every ${d.interval}s...\n`);
	let interval = Math.max(1, d.interval) * 1000;
	const deadline = Date.now() + d.expires_in * 1000;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, interval));
		const form: Record<string, string> = { client_id: clientId, scopes: scopes.join(' '), device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' };
		if (clientSecret) form.client_secret = clientSecret; // confidential clients may send it; public clients must not need it
		const r = await post('token', form);
		if (r.status === 200) return storeUser(r.json as unknown as TokenResponse, 'device_code', opt('name'));
		const msg = String(r.json.message ?? r.json.error ?? '');
		if (msg === 'authorization_pending') continue;
		if (msg === 'slow_down') { interval += 5000; continue; }
		fail('device token poll', r); // e.g. "invalid device code" (already used / expired) or access denied
	}
	die('device code expired before the user approved; run again');
}

async function cmdValidate(): Promise<void> {
	const data = load();
	let token = opt('token');
	let label = 'token';
	if (!token && has('app')) { token = data.app?.access_token; label = 'app'; }
	if (!token) { const [n, s] = pickUser(data); token = s.access_token; label = n; }
	if (!token) die('no token to validate');
	const info = await validate(token);
	if (!info) { console.log(`${label}: INVALID (401) - refresh it or re-run the auth flow`); process.exit(2); }
	console.log(JSON.stringify({ label, ...info, expires_in_h: +(info.expires_in / 3600).toFixed(2), kind: info.user_id ? 'user' : 'app' }, null, 2));
}

async function cmdRefresh(): Promise<void> {
	needClientId();
	const data = load();
	const [name, s] = pickUser(data);
	if (!s.refresh_token) die(`user "${name}" has no refresh token`);
	const form: Record<string, string> = { client_id: clientId, grant_type: 'refresh_token', refresh_token: s.refresh_token };
	if (clientSecret) form.client_secret = clientSecret; // omit for public clients
	const r = await post('token', form);
	if (r.status !== 200) {
		if (r.status === 400 || r.status === 401) die(`refresh rejected (${JSON.stringify(r.json)}). The user must re-authorize (login/device). Public-client refresh tokens are single-use + 30-day expiry.`);
		fail('refresh', r);
	}
	const fresh = toStored(r.json as unknown as TokenResponse, 'refresh');
	data.users[name] = { ...fresh, user_id: s.user_id, login: s.login, refresh_token: fresh.refresh_token ?? s.refresh_token };
	save(data); // persist IMMEDIATELY: the refresh token may have rotated
	console.log(`refreshed "${name}" scopes=[${fresh.scope.join(' ')}] expires_in=${fresh.expires_at ? Math.round((fresh.expires_at - Date.now()) / 1000) : '?'}s`);
}

async function cmdRevoke(): Promise<void> {
	needClientId();
	const data = load();
	let token = opt('token');
	let drop: (() => void) | undefined;
	if (!token && has('app')) { token = data.app?.access_token; drop = () => { delete data.app; }; }
	if (!token) { const [n, s] = pickUser(data); token = s.access_token; drop = () => { delete data.users[n]; }; }
	const r = await post('revoke', { client_id: clientId, token: token! });
	if (r.status !== 200) fail('revoke', r);
	drop?.();
	save(data);
	console.log('revoked');
}

function cmdShow(): void {
	const data = load();
	const view = (s?: Stored) => s && { ...s, access_token: mask(s.access_token), refresh_token: mask(s.refresh_token), expires_at: s.expires_at ? new Date(s.expires_at).toISOString() : null };
	console.log(JSON.stringify({ file, app: view(data.app), users: Object.fromEntries(Object.entries(data.users).map(([k, v]) => [k, view(v)])) }, null, 2));
}

function cmdScopes(): void {
	const q = positional.join(' ').toLowerCase();
	if (!q) die('usage: node scripts/token.ts scopes <scope | endpoint name | eventsub type>  e.g. scopes "send chat message"');
	// scopes.json ships with the twitch-dev skill; when this script was copied into a project, look in the
	// installed skill location (~/.agents/skills) or $TWITCH_SCOPES_JSON.
	const here = dirname(fileURLToPath(import.meta.url));
	const home = process.env.HOME ?? '';
	const candidates = [process.env.TWITCH_SCOPES_JSON, join(here, '../references/scopes.json'),
		join(home, '.agents/skills/twitch-dev/references/scopes.json')];
	const path = candidates.find((p): p is string => !!p && existsSync(p));
	if (!path) die(`scopes.json not found (tried: ${candidates.filter(Boolean).join(', ')}) - set TWITCH_SCOPES_JSON or run the copy inside the twitch-dev skill`);
	type L = { name: string; anchor: string; note?: string };
	const all = JSON.parse(readFileSync(path, 'utf8')) as Array<{ scope: string; description: string; api: L[]; eventsub: L[] }>;
	const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ''); // "channel.follow" ~ "Channel Follow" ~ #channelfollow
	const hit = (l: L) => norm(l.name).includes(norm(q)) || norm(l.anchor).includes(norm(q));
	const rows = all.filter((s) => s.scope.includes(q) || s.api.some(hit) || s.eventsub.some(hit));
	if (!rows.length) { console.log(`no scope mentions "${q}" - the endpoint/event may need no scope (app token or public data). Check the twitch-api / twitch-eventsub skills.`); return; }
	for (const s of rows) {
		console.log(`${s.scope}\n  ${s.description}`);
		const a = s.api.filter((l) => s.scope.includes(q) || hit(l)).map((l) => l.name + (l.note ? ` (${l.note})` : ''));
		const e = s.eventsub.filter((l) => s.scope.includes(q) || hit(l)).map((l) => l.name);
		if (a.length) console.log(`  API: ${a.join(', ')}`);
		if (e.length) console.log(`  EventSub: ${e.join(', ')}`);
	}
}

const help = `usage: node scripts/token.ts <app|login|device|validate|refresh|revoke|show|scopes> [flags]
  app                                      client credentials -> app token (needs secret)
  login  --scopes "s1 s2" [--name N] [--redirect-uri http://localhost:3000] [--force-verify]
  device --scopes "s1 s2" [--name N]       device code flow (works for public clients)
  validate [--name N | --app | --token T]  (do this at startup + hourly in real apps)
  refresh  [--name N]
  revoke   [--name N | --app | --token T]
  show                                     list stored tokens (masked)
  scopes <query>                           e.g. scopes "channel.chat.message"
common: --file PATH (TWITCH_TOKEN_FILE)  --client-id/--client-secret (TWITCH_CLIENT_ID/SECRET)
        --auth-base URL (TWITCH_AUTH_BASE)  --dry-run`;

const commands: Record<string, () => Promise<void> | void> = {
	app: cmdApp, login: cmdLogin, device: cmdDevice, validate: cmdValidate, refresh: cmdRefresh,
	revoke: cmdRevoke, show: cmdShow, scopes: cmdScopes, help: () => console.log(help),
};
const run = commands[cmd];
if (!run) { console.error(help); process.exit(1); }
try {
	await run();
} catch (e) {
	die(e instanceof Error ? e.message : String(e));
}
