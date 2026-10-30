#!/usr/bin/env node
// Smoke-test assets/templates/helix-client.ts against the Twitch CLI mock API.
//
//   twitch mock-api generate -c 10        # prints Client-ID / Secret and a partner user id
//   twitch mock-api start -p 8110 &
//   MOCK_CLIENT_ID=... MOCK_CLIENT_SECRET=... node scripts/smoke-test.ts
//
// Env: MOCK_BASE (default http://localhost:8110), MOCK_CLIENT_ID, MOCK_CLIENT_SECRET.
// If the id/secret are not set, they're read from the mock's /units/clients listing.
import {
  AppTokenProvider,
  HelixClient,
  HelixError,
  staticToken,
  validateToken,
  type Stream,
  type User,
} from "../assets/templates/helix-client.ts";

const BASE = process.env.MOCK_BASE ?? "http://localhost:8110";
let failures = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

async function units<T>(name: string): Promise<T[]> {
  // Mock-only, unauthenticated listing of generated data.
  return ((await (await fetch(`${BASE}/units/${name}`)).json()) as { data: T[] }).data;
}

let clientId = process.env.MOCK_CLIENT_ID;
let clientSecret = process.env.MOCK_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  const c = (await units<{ ID: string; Secret: string; IsExtension: boolean }>("clients")).find((x) => !x.IsExtension)!;
  clientId = c.ID;
  clientSecret = c.Secret;
}

// --- App token via client credentials (mock: POST /auth/token, same form body as id.twitch.tv) ---
const appTokens = new AppTokenProvider({ clientId, clientSecret, authBaseUrl: `${BASE}/auth` });
const app = new HelixClient({ clientId, token: appTokens, baseUrl: `${BASE}/mock` });

const all = await units<User>("users");
const partner = all.find((u) => u.broadcaster_type === "partner") ?? all[0]!;

// Users
const users = await app.getUsers({ id: all.slice(0, 3).map((u) => u.id) });
ok(users.length === 3 && users.every((u) => typeof u.id === "string"), `getUsers(id x3) -> ${users.length} users, string ids`);
const byLogin = await app.getUserByLogin(partner.login.toUpperCase());
ok(byLogin?.id === partner.id, `getUserByLogin(${partner.login}) -> ${byLogin?.id}`);

// Streams + manual pagination
const page1 = await app.getStreams({ first: 2 });
const cursor = typeof page1.pagination === "object" ? page1.pagination.cursor : undefined;
ok(page1.data.length === 2 && !!cursor, `getStreams(first=2) -> ${page1.data.length} streams, cursor=${cursor}`);
const page2 = await app.getStreams({ first: 2, after: cursor });
ok(page2.data.length > 0 && page2.data[0]!.id !== page1.data[0]!.id, `getStreams(after=cursor) -> next page differs`);

// Async-iterator pagination over all streams with page size 2 vs. one big page
const viaIterator: Stream[] = [];
for await (const s of app.paginate<Stream>("/streams", {}, { pageSize: 2 })) viaIterator.push(s);
const onePage = await app.getStreams({ first: 100 });
ok(
  viaIterator.length === onePage.data.length && new Set(viaIterator.map((s) => s.id)).size === viaIterator.length,
  `paginate('/streams', pageSize 2) -> ${viaIterator.length} unique streams == single page of ${onePage.data.length}`,
);
const limited = await app.getAll<Stream>("/streams", {}, { pageSize: 2, limit: 3 });
ok(limited.length === Math.min(3, onePage.data.length), `getAll(limit 3) -> ${limited.length}`);

// Channels / games / search (app token)
const ch = await app.getChannels([partner.id]);
ok(ch[0]?.broadcaster_id === partner.id, `getChannels -> title "${ch[0]?.title}"`);
const cats = await app.searchCategories("dev");
ok(Array.isArray(cats.data), `searchCategories("dev") -> ${cats.data.length} results`);

// Errors: bad token -> HelixError 401 with Twitch error body
const bad = new HelixClient({ clientId, token: staticToken("not-a-token"), baseUrl: `${BASE}/mock` });
try {
  await bad.getUsers({ login: ["x"] });
  ok(false, "bad token should throw");
} catch (e) {
  ok(e instanceof HelixError && e.status === 401, `bad token -> HelixError ${(e as HelixError).status} "${(e as HelixError).error}"`);
}

// 401 -> refresh hook: give the client a stale token first; AppTokenProvider.refresh() fixes it
let refreshes = 0;
const flaky = new HelixClient({
  clientId,
  baseUrl: `${BASE}/mock`,
  token: {
    stale: true,
    async getAccessToken() {
      return this.stale ? "stale-token" : appTokens.getAccessToken();
    },
    async refresh() {
      refreshes++;
      this.stale = false;
      return appTokens.refresh();
    },
  } as { stale: boolean; getAccessToken(): Promise<string>; refresh(): Promise<string> },
});
const u2 = await flaky.getUsers({ id: [partner.id] });
ok(u2.length === 1 && refreshes === 1, `401 -> refresh() once -> retried OK (refreshes=${refreshes})`);

// --- User token (mock-only grant: POST /auth/authorize?grant_type=user_token&user_id=&scope=) ---
const scopes = [
  "channel:manage:polls", "channel:manage:predictions", "channel:manage:redemptions", "clips:edit", "moderator:read:followers",
  "channel:manage:broadcast", "channel:manage:raids", "moderator:manage:shoutouts", "moderator:manage:announcements",
  "channel:read:subscriptions",
];
const ut = (await (
  await fetch(
    `${BASE}/auth/authorize?` +
      new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "user_token", user_id: partner.id, scope: scopes.join(" ") }),
    { method: "POST" },
  )
).json()) as { access_token: string };
const v = await validateToken(ut.access_token, `${BASE}/auth`);
ok(v?.user_id === partner.id, `validateToken -> user_id ${v?.user_id}, ${v?.scopes?.length} scopes`);

const user = new HelixClient({ clientId, token: staticToken(ut.access_token), baseUrl: `${BASE}/mock` });
const me = await user.getUsers();
ok(me[0]?.id === partner.id, `getUsers() with user token -> token owner ${me[0]?.login}`);
await user.updateChannel(partner.id, { title: "smoke test title" });
ok((await app.getChannels([partner.id]))[0]?.title === "smoke test title", "updateChannel (204) -> title changed");
const poll = await user.createPoll({ broadcaster_id: partner.id, title: "Smoke?", choices: [{ title: "yes" }, { title: "no" }], duration: 60 });
ok(poll.status === "ACTIVE" && poll.choices.length === 2, `createPoll -> ${poll.id} ${poll.status}`);
const reward = await user.createCustomReward(partner.id, { title: `smoke ${Date.now() % 100000}`, cost: 100 });
ok(typeof reward.id === "string" && reward.cost === 100, `createCustomReward -> ${reward.id}`);
const ended = await user.endPoll(partner.id, poll.id, "TERMINATED");
ok(ended.status === "TERMINATED", `endPoll -> ${ended.status}`);
const pred = await user.createPrediction({ broadcaster_id: partner.id, title: "Win?", outcomes: [{ title: "yes" }, { title: "no" }], prediction_window: 60 });
ok(pred.outcomes.length === 2, `createPrediction -> ${pred.id} ${pred.status}`);
const locked = await user.endPrediction(partner.id, pred.id, "LOCKED");
const resolved = await user.endPrediction(partner.id, pred.id, "RESOLVED", pred.outcomes[0]!.id);
ok(locked.status === "LOCKED" && resolved.winning_outcome_id === pred.outcomes[0]!.id, `endPrediction LOCKED -> RESOLVED (${resolved.status})`);
const upd = await user.updateCustomReward(partner.id, reward.id, { cost: 250, is_paused: true });
ok(upd.cost === 250, `updateCustomReward -> cost ${upd.cost}, paused ${upd.is_paused}`);
const rewards = await user.getCustomRewards(partner.id, { only_manageable_rewards: true });
let redemptions = 0;
for (const rw of rewards) for await (const _r of user.getRedemptions(partner.id, rw.id)) redemptions++;
ok(rewards.some((r) => r.id === reward.id), `getCustomRewards(only_manageable) -> ${rewards.length}, UNFULFILLED redemptions ${redemptions}`);
const other = all.find((u) => u.id !== partner.id)!;
const raid = await user.startRaid(partner.id, other.id);
ok(typeof raid.created_at === "string", `startRaid -> created_at ${raid.created_at}`);
await user.cancelRaid(partner.id).then(() => ok(true, "cancelRaid -> 204"), (e: unknown) => ok(e instanceof HelixError, `cancelRaid -> ${(e as Error).message}`));
await user.sendShoutout(partner.id, other.id, partner.id);
ok(true, "sendShoutout -> 204");
await user.sendAnnouncement(partner.id, partner.id, "smoke test", "purple");
ok(true, "sendAnnouncement -> 204");
const subs = await user.getSubscriptions(partner.id, { first: 2 });
ok(typeof subs.total === "number" && subs.data.every((x) => /^[123]000$/.test(x.tier)), `getSubscriptions -> total ${subs.total}, points ${subs.points}`);
const followers = await user.getChannelFollowers(partner.id, { first: 2 });
ok(typeof followers.total === "number", `getChannelFollowers -> total ${followers.total}`);
const clip = await user.createClip(partner.id);
ok(typeof clip.id === "string" && clip.edit_url.length > 0, `createClip -> ${clip.id}`);
try {
  await user.createPoll({ broadcaster_id: all.find((u) => u.id !== partner.id)!.id, title: "x", choices: [{ title: "a" }, { title: "b" }], duration: 60 });
  ok(false, "poll for other broadcaster should fail");
} catch (e) {
  ok(e instanceof HelixError, `poll for another broadcaster -> ${(e as HelixError).status} ${(e as Error).message}`);
}

// --- Rate limiting: the CLI mock sends no Ratelimit-* headers, so use a tiny local fake on 8111 ---
const { createServer } = await import("node:http");
let hits = 0;
const fake = createServer((req, res) => {
  hits++;
  const reset = Math.ceil(Date.now() / 1000) + 1;
  if (req.url?.startsWith("/bucket") && hits === 1) {
    res.writeHead(429, { "Ratelimit-Limit": "800", "Ratelimit-Remaining": "0", "Ratelimit-Reset": String(reset), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too Many Requests", status: 429, message: "bucket empty" }));
  } else if (req.url?.startsWith("/cooldown")) {
    // endpoint-specific 429 (e.g. shoutout cooldown): bucket still has points
    res.writeHead(429, { "Ratelimit-Limit": "800", "Ratelimit-Remaining": "790", "Ratelimit-Reset": String(reset), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too Many Requests", status: 429, message: "cooldown" }));
  } else {
    res.writeHead(200, { "Ratelimit-Limit": "800", "Ratelimit-Remaining": "799", "Ratelimit-Reset": String(reset), "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ ok: true }] }));
  }
});
await new Promise<void>((r) => fake.listen(8111, r));
const rl = new HelixClient({ clientId: "x", token: staticToken("y"), baseUrl: "http://localhost:8111" });
const t0 = Date.now();
const r1 = await rl.get<{ data: unknown[] }>("/bucket");
ok(r1.data.length === 1 && hits === 2 && Date.now() - t0 >= 500, `429 bucket-empty -> waited ${Date.now() - t0}ms for Ratelimit-Reset, retried OK`);
ok(rl.rateLimit.remaining === 799 && rl.rateLimit.limit === 800, `rateLimit state tracked (remaining=${rl.rateLimit.remaining})`);
hits = 0;
try {
  await rl.get("/cooldown");
  ok(false, "endpoint 429 should throw");
} catch (e) {
  ok(e instanceof HelixError && e.status === 429 && hits === 1, `429 with points left -> thrown without retry (hits=${hits})`);
}
fake.close();

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
