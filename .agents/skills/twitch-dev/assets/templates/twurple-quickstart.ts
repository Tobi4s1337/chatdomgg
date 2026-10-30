// Twurple quick-start: broadcaster + bot account, EventSub over WebSocket, replies via Helix.
// Typechecked against @twurple/* 8.2.0 (Oct 2026).
//
//   npm i @twurple/auth @twurple/api @twurple/eventsub-ws
//   # get tokens once (stores .twitch-tokens.json, see twitch-dev/scripts/token.ts):
//   node scripts/token.ts login  --name broadcaster --scopes "moderator:read:followers channel:read:redemptions channel:manage:redemptions bits:read channel:read:subscriptions channel:read:hype_train channel:bot"
//   node scripts/token.ts device --name bot --scopes "user:read:chat user:write:chat user:bot"
//   TWITCH_CLIENT_ID=... TWITCH_CLIENT_SECRET=... node twurple-quickstart.ts
//
// WHY this shape:
// - RefreshingAuthProvider refreshes user tokens on 401/expiry; onRefresh MUST persist the new pair
//   (refresh tokens can rotate; public-client refresh tokens are single-use).
// - EventSub WebSocket needs USER tokens (Twurple picks the right user per subscription condition).
// - Twurple does NOT do Twitch's required hourly /validate for you - we do it below.
// - Bot replies use the Helix Send Chat Message endpoint (not IRC). Sending with an APP token
//   (sendChatMessageAsApp) is what earns the "Chat Bot" badge; it needs the bot's user:bot + user:write:chat
//   grant and the broadcaster's channel:bot grant (or the bot being a mod).

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { RefreshingAuthProvider, getTokenInfo, type AccessToken } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';

const clientId = process.env.TWITCH_CLIENT_ID ?? '';
const clientSecret = process.env.TWITCH_CLIENT_SECRET; // omit for a PUBLIC client (device-flow tokens)
const TOKEN_FILE = process.env.TWITCH_TOKEN_FILE ?? '.twitch-tokens.json';
if (!clientId) throw new Error('TWITCH_CLIENT_ID missing');

// ---- token persistence (same file format as scripts/token.ts) ----
interface Stored { access_token: string; refresh_token?: string; scope: string[]; expires_at: number | null; obtained_at: number; user_id?: string; login?: string }
interface TokenFile { app?: Stored; users: Record<string, Stored> }
const readStore = (): TokenFile => (existsSync(TOKEN_FILE) ? (JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as TokenFile) : { users: {} });
function writeStore(data: TokenFile): void {
	writeFileSync(`${TOKEN_FILE}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
	renameSync(`${TOKEN_FILE}.tmp`, TOKEN_FILE); // atomic: a crash mid-write must not lose a single-use refresh token
}
const toTwurple = (s: Stored): AccessToken => ({
	accessToken: s.access_token,
	refreshToken: s.refresh_token ?? null,
	scope: s.scope,
	expiresIn: s.expires_at ? Math.round((s.expires_at - s.obtained_at) / 1000) : 0,
	obtainmentTimestamp: s.obtained_at,
});
const fromTwurple = (t: AccessToken, prev: Stored): Stored => ({
	...prev,
	access_token: t.accessToken,
	refresh_token: t.refreshToken ?? prev.refresh_token,
	scope: t.scope,
	obtained_at: t.obtainmentTimestamp,
	expires_at: t.expiresIn ? t.obtainmentTimestamp + t.expiresIn * 1000 : null,
});

const store = readStore();
const broadcaster = store.users.broadcaster;
const bot = store.users.bot;
if (!broadcaster?.user_id || !bot?.user_id) throw new Error(`need users "broadcaster" and "bot" in ${TOKEN_FILE} (run scripts/token.ts)`);
const nameByUserId = new Map([[broadcaster.user_id, 'broadcaster'], [bot.user_id, 'bot']]);

const authProvider = new RefreshingAuthProvider({ clientId, clientSecret });
authProvider.onRefresh((userId, token) => {
	const data = readStore();
	const name = nameByUserId.get(userId);
	if (!name || !data.users[name]) return;
	data.users[name] = fromTwurple(token, data.users[name]);
	writeStore(data);
});
authProvider.onRefreshFailure((userId, err) => {
	// Refresh token dead (user disconnected the app, password change, 30-day public-client expiry...).
	console.error(`refresh failed for ${nameByUserId.get(userId) ?? userId}: ${err.message} -> re-run the login/device flow`);
});
authProvider.addUser(broadcaster.user_id, toTwurple(broadcaster));
authProvider.addUser(bot.user_id, toTwurple(bot), ['chat']); // intent "chat" = "use the bot for chat things"

const api = new ApiClient({ authProvider });

// ---- Twitch requirement: validate tokens at startup and hourly; end sessions whose token died ----
async function validateAll(): Promise<void> {
	for (const [userId, name] of nameByUserId) {
		try {
			const token = await authProvider.getAccessTokenForUser(userId);
			if (!token) continue;
			const info = await getTokenInfo(token.accessToken, clientId);
			if (info.userId !== userId) console.warn(`${name}: token belongs to ${info.userName}?`);
		} catch (e) {
			// InvalidTokenError (401): try one refresh; if that fails onRefreshFailure fires.
			console.warn(`${name}: token invalid (${(e as Error).message}); refreshing`);
			await authProvider.refreshAccessTokenForUser(userId).catch(() => undefined);
		}
	}
}
await validateAll();
setInterval(() => void validateAll(), 60 * 60 * 1000).unref();

// ---- helpers ----
async function say(text: string, replyTo?: string): Promise<void> {
	// Use sendChatMessageAsApp(bot.user_id!, broadcaster.user_id!, text) for the Chat Bot badge
	// (requires clientSecret so Twurple can mint an app token).
	const res = clientSecret
		? await api.chat.sendChatMessageAsApp(bot!.user_id!, broadcaster!.user_id!, text, { replyParentMessageId: replyTo })
		: await api.asUser(bot!.user_id!, (ctx) => ctx.chat.sendChatMessage(broadcaster!.user_id!, text, { replyParentMessageId: replyTo }));
	if (!res.isSent) console.warn(`message dropped: ${res.dropReasonMessage ?? res.dropReasonCode ?? 'unknown'}`);
}

// ---- EventSub over WebSocket (no public URL needed) ----
// For local testing against `twitch event websocket start-server -p 8080`, set TWURPLE_MOCK_API_PORT=8080.
const listener = new EventSubWsListener({ apiClient: api });
const B = broadcaster.user_id;

listener.onChannelChatMessage(B, bot.user_id, async (e) => {
	if (e.chatterId === bot.user_id) return; // never react to yourself (loops!)
	if (e.messageText.trim().toLowerCase() === '!hello') await say(`Hi @${e.chatterDisplayName}!`, e.messageId);
});
listener.onChannelFollow(B, B, (e) => console.log(`follow: ${e.userDisplayName}`)); // moderator = broadcaster
listener.onChannelRedemptionAdd(B, async (e) => {
	console.log(`redeem: ${e.userDisplayName} -> ${e.rewardTitle} (${e.rewardCost}) "${e.input}"`);
	// Only rewards created by THIS client id can be fulfilled/refunded: await e.updateStatus('FULFILLED');
});
listener.onChannelCheer(B, (e) => console.log(`cheer: ${e.isAnonymous ? 'anon' : e.userDisplayName} ${e.bits} bits`));
listener.onChannelSubscription(B, (e) => console.log(`sub: ${e.userDisplayName} tier ${e.tier} gift=${e.isGift}`));
listener.onChannelRaidTo(B, (e) => console.log(`raid from ${e.raidingBroadcasterDisplayName} with ${e.viewers}`));
listener.onChannelHypeTrainBeginV2(B, (e) => console.log(`hype train lvl ${e.level} (${e.type})`)); // V1 is decommissioned

listener.onSubscriptionCreateFailure((sub, err) => console.error(`subscribe failed ${sub.id}: ${err.message}`));
listener.onRevoke((sub, status) => console.error(`subscription revoked ${sub.id}: ${status}`));
listener.start();

const shutdown = () => { listener.stop(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log(`listening for ${broadcaster.login} with bot ${bot.login}`);
