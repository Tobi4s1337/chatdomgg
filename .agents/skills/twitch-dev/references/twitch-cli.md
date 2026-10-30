# Twitch CLI — verified guide (v1.1.24)

Everything marked ✅ was run on 2026-10-26 with `twitch-cli/1.1.24` and no Twitch credentials.
`token`/`api` against real Twitch were only exercised with dummy credentials (documented from
`--help` + official pages `references/official/cli*.md`). Install: `brew install twitchdev/twitch/twitch-cli`,
`scoop install twitch-cli`, or a binary from https://github.com/twitchdev/twitch-cli/releases.

## Contents
1. Command map
2. Config, env vars, and two things that will bite you
3. `twitch configure`
4. `twitch token` (app, user, DCF, refresh, validate, revoke)
5. `twitch api` (incl. pointing it at the mock API)
6. `twitch event trigger` / `verify-subscription` / `retrigger` (webhooks)
7. Mock EventSub WebSocket server
8. Mock Helix API (`mock-api`)
9. Recipes: the local test loop
10. Known limitations of 1.1.24

## 1. Command map ✅ (`twitch --help`)
```
twitch api        {get|post|put|patch|delete} <path>   call Helix with the stored token
twitch configure  [-i client_id] [-s client_secret]    store credentials
twitch event      {trigger|verify-subscription|retrigger|configure|websocket}
twitch mock-api   {generate|start}                     local fake Helix
twitch token      [-u] [-s scopes] [--dcf] [-R refresh] [-v validate] [-r revoke] ...
twitch version
global: --config <file>   (default $XDG_CONFIG_HOME/twitch-cli/.twitch-cli.env, i.e. ~/.config/twitch-cli/; ~/.twitch-cli/ if that legacy dir exists)
```

## 2. Config, env vars, gotchas
- Config file is a dotenv file; keys: `CLIENTID`, `CLIENTSECRET`, `ACCESSTOKEN`, `REFRESHTOKEN`,
  `TOKENEXPIRATION`, `FORWARDADDRESS`, `EVENTSECRET`, `LAST_UPDATE_CHECK`, …
- **Every key can be overridden by an env var with prefix `TWITCH_`** (viper AutomaticEnv) ✅:
  `TWITCH_CLIENTID`, `TWITCH_CLIENTSECRET`, `TWITCH_ACCESSTOKEN`, `TWITCH_TOKENEXPIRATION=0` (= "never
  expires, don't auto-refresh"), `TWITCH_BASE_URL` (Helix base for `twitch api`). Note the CLI's names
  have no underscore inside (`TWITCH_CLIENTID`), unlike the suite convention `TWITCH_CLIENT_ID`.
- Data (mock DB, event cache `eventCache.db`) lives in the same dir. **Isolate it per project/agent** with
  `XDG_CONFIG_HOME=$PWD/.twitch-cli-home twitch ...` ✅ — concurrent `mock-api` processes sharing one
  sqlite file block each other.
- ⚠️ **Sporadic `panic: index out of range` + exit code 2 after a successful command** ✅ — it's the
  GitHub update check (`version_checker.go`), not your command. Set `TWITCH_DISABLE_UPDATE_CHECKS=true`
  (or `CI=true`) in scripts/CI ✅.
- ⚠️ With no credentials configured, `twitch token`/`twitch api` open an **interactive prompt** (hangs a
  coding agent). Always run `twitch configure -i <id> -s <secret>` first or export
  `TWITCH_CLIENTID`/`TWITCH_CLIENTSECRET` ✅.

## 3. `twitch configure` ✅
```
twitch configure -i <client_id> -s <client_secret>     # non-interactive; both flags or it prompts
twitch event configure -F http://localhost:8080/eventsub -s <secret>   # defaults for event trigger/verify/retrigger
```
`event configure` writes `FORWARDADDRESS`/`EVENTSECRET` into the config ✅; later triggers use them
unless `-D/--no-config` ✅.

## 4. `twitch token`
```
twitch token                                   # app access token (client credentials) -> stored as ACCESSTOKEN
twitch token -u -s "user:read:chat user:write:chat"          # user token via browser + local server on :3000
twitch token -u -s "..." --dcf                 # device code flow: prints URL + code, polls every 5 s
twitch token -u -p 3030 --redirect-host localhost --ip 127.0.0.1  # change local callback server
twitch token -R <refresh_token>                # refresh (uses config client id/secret)
twitch token -R <rt> --client-id X --secret Y  # override creds (config is NOT updated then)
twitch token -v <access_token>                 # validate (prints client id, type, expiry, scopes)
twitch token -r <access_token>                 # revoke
```
- User-token mode needs `http://localhost:3000` (no trailing slash) as the **first** OAuth Redirect URL of
  the app (or match `-p`/`--redirect-host`); otherwise `Error! redirect_mismatch`.
- Output prints `User Access Token`, `Refresh Token`, `Expires At`, `Scopes`; the token is also saved in
  the config so `twitch api` uses it next. Whatever ran last (app or user) is what `twitch api` sends.
- `--forceverify` appears in the GitHub docs but is **not** in 1.1.24 (`unknown flag`) ✅.
- ⚠️ `twitch token -v <garbage>` in 1.1.24 printed `Token Type: App Access Token / Expires In: 0` and
  exit 0 instead of an error ✅ — don't script on it; use `node scripts/token.ts validate` or curl `/validate`.
- Chat-testing token from the official chat docs: `twitch token --user-token --scopes "user:read:chat user:write:chat"`.

## 5. `twitch api`
```
twitch api get users -q login=twitchdev                       # path with or without leading slash
twitch api get /users -q login=a -q login=b                    # repeat -q for multi-value params
twitch api get streams -q first=100 -P 3                       # autopaginate up to 3 pages (-P alone = all)
twitch api post polls -b '{"broadcaster_id":"123","title":"?","choices":[{"title":"a"},{"title":"b"}],"duration":60}'
twitch api post chat/messages -b @msg.json                     # body from file
twitch api patch channels -q broadcaster_id=123 -b '{"title":"New title"}'
twitch api delete eventsub/subscriptions -q id=<sub id>
flags: -q key=value (repeat)  -b JSON|@file  -u unformatted  -v verbose (headers)  -P [n] autopaginate (get only)
```
Exit code is non-zero for non-2xx responses (per GitHub docs). Uses `ACCESSTOKEN` + `CLIENTID` from config; if
`TOKENEXPIRATION` passed and a refresh token exists it refreshes first.

**Point `twitch api` at the mock API** ✅:
```
TWITCH_BASE_URL=http://localhost:8080/mock TWITCH_CLIENTID=<mock id> TWITCH_ACCESSTOKEN=<mock token> \
TWITCH_TOKENEXPIRATION=0 twitch api get users -q id=<mock user id>
```

## 6. Webhook testing: trigger / verify-subscription / retrigger ✅
```
twitch event trigger <type|alias> -F http://localhost:8080/eventsub -s <secret>  [flags]
twitch event verify-subscription <type> -F http://localhost:8080/eventsub -s <secret>
twitch event retrigger -i <Twitch-Eventsub-Message-Id> -F ... -s ...
```
- Without `-F` (and no configured default) the payload JSON is just printed ✅ — handy for fixtures:
  `TWITCH_DISABLE_UPDATE_CHECKS=true twitch event trigger channel.cheer -D > fixtures/cheer.json` gives pure
  `{subscription, event}` JSON ✅ (the webhook body shape; WebSocket frames wrap it in `{metadata, payload}`).
- With `-F` it POSTs to your server with real headers ✅: `Twitch-Eventsub-Message-Id`, `-Message-Retry`,
  `-Message-Signature` (`sha256=` HMAC of id+timestamp+raw body), `-Message-Timestamp`, `-Message-Type`
  (`notification` | `webhook_callback_verification` | `revocation`), `-Subscription-Type`, `-Subscription-Version`.
- `-s` must be **10–100 chars** ✅ (else "Invalid secret provided").
- `verify-subscription` sends `webhook_callback_verification`; the CLI checks you answered **200, `Content-Type: text/plain`,
  body = challenge** and prints ✔/✗ for each ✅.
- `retrigger -i` takes the **message id** (set your own with `-I my-id` on trigger) and resends the same
  payload with the **same message id** and a new timestamp ✅ → perfect for testing dedupe.
  (Passing the subscription id gives `sql: no rows in result set` ✅.)
- `-r <status>` sets `subscription.status`; `-r authorization_revoked` makes the CLI send a
  `revocation` message ✅.
- `--timestamp <RFC3339Nano>` sets payload+header time, but ✅ the resulting signature did **not** verify
  against the header-based HMAC in our test — use it only for display logic, not replay-protection tests.

**Triggerable types in 1.1.24** ✅ (from `twitch event trigger --help`):
```
channel.ad_break.begin channel.ban channel.channel_points_custom_reward.add
channel.channel_points_custom_reward.remove channel.channel_points_custom_reward.update
channel.channel_points_custom_reward_redemption.add channel.channel_points_custom_reward_redemption.update
channel.charity_campaign.donate channel.charity_campaign.progress channel.charity_campaign.start
channel.charity_campaign.stop channel.cheer channel.follow channel.goal.begin channel.goal.end
channel.goal.progress channel.hype_train.begin channel.hype_train.end channel.hype_train.progress
channel.moderator.add channel.moderator.remove channel.poll.begin channel.poll.end channel.poll.progress
channel.prediction.begin channel.prediction.end channel.prediction.lock channel.prediction.progress
channel.raid channel.shield_mode.begin channel.shield_mode.end channel.shoutout.create
channel.shoutout.receive channel.subscribe channel.subscription.end channel.subscription.gift
channel.subscription.message channel.unban channel.unban_request.create channel.unban_request.resolve
channel.update drop.entitlement.grant extension.bits_transaction.create stream.offline stream.online
user.authorization.grant user.authorization.revoke user.update
```
Aliases still work (`follow`, `subscribe`, `gift`, `cheer`, `raid`, `streamup`, `streamdown`, `add-redemption`,
`poll-begin`, `hype-train-begin`, … see `references/official/cli_event-command.md`) ✅.
**Not triggerable** (hand-write fixtures from the payload examples in the twitch-eventsub / twitch-chat skills):
`channel.chat.*` (message, notification, clear, message_delete…) → "Invalid event" ✅, `channel.bits.use`,
`channel.custom_power_up_redemption.add`, `channel.channel_points_automatic_reward_redemption.add`,
`channel.moderate`, `channel.vip.*`, `channel.warning.*`, `automod.*`, `channel.suspicious_user.*`,
`channel.shared_chat.*`, `user.whisper.message`, `conduit.shard.disabled`.
⚠️ Versions: `channel.follow` only `-v 2` ✅; **`channel.hype_train.*` only v1 payloads** ✅
("Valid version(s): 1") — v1 is decommissioned in production since 2025-12-04, so the CLI hype-train
payload does **not** match the v2 shape you must subscribe to. Write v2 fixtures by hand.

Useful trigger flags ✅: `-f/--from-user <id>` `-t/--to-user <id>` (usually broadcaster) `-C/--cost <n>`
(bits / points / gift count) `-c/--count <n>` (fire n events) `-n/--item-name` (reward title, game name)
`-i/--item-id` `-S/--event-status fulfilled` (redemption.update) `--tier 1000|2000|3000` `-a` (anonymous
cheer/gift) `-g/--gift-user` `-G/--game-id` `-d/--description` (title) `--ban-start/--ban-end`
`--charity-current-value/--charity-target-value` `-I/--event-id` (message id) `-u/--subscription-id`
`-r/--subscription-status` `-v/--version` `-T/--transport webhook|websocket` `--session <ws session>`.

## 7. Mock EventSub WebSocket server ✅
```
twitch event websocket start-server -p 8080 [--ip 127.0.0.1] [-S] [--ssl] [--debug]
  -> ws://127.0.0.1:8080/ws         (connect your client here instead of wss://eventsub.wss.twitch.tv/ws)
  -> http://127.0.0.1:8080/eventsub/subscriptions   mock Create/Get/Delete EventSub Subscription
twitch event trigger <type> -T websocket [--session <id>]        # send to all clients or one session
twitch event websocket reconnect                                  # start reconnect test
twitch event websocket close --session=<id> --reason=<4000-4007>  # force a close code
twitch event websocket subscription --subscription=<sub id> --status=<status> [--session=<id>]
twitch event websocket keepalive --session=<id> --enabled=false   # stop keepalives for one client
```
Observed behaviour:
- On connect: `session_welcome` (`keepalive_timeout_seconds: 10`, session id like `f5c02079_39540b10`),
  then `session_keepalive` every ~10 s ✅.
- Trigger with `-T websocket` delivers `notification` frames (default to every connected client) ✅;
  the payload's `transport.session_id` says `WebSocket-Server-Will-Set` in the CLI echo.
- Mock subscription endpoint ✅: needs `Client-Id` + `Authorization` headers (any values; 401 without),
  POST body like real Twitch (`transport: {method:"websocket", session_id}`), returns
  `{data:[…], total, total_cost, max_total_cost: 10}`; GET lists, DELETE `?id=` → 204.
  Quirks: it **rejects `channel.chat.message`** ("combination of values in the type and version fields is
  not valid") and returns **409 for a second subscription of the same type+version** even with a
  different condition (real Twitch only conflicts on identical type+version+condition).
- `-S/--require-subscription`: events are only forwarded for subscribed types, and a client that doesn't
  subscribe within 10 s is closed with **4003 "connection unused"** ✅.
- `reconnect` ✅: every client gets `session_reconnect` with `reconnect_url`
  (`ws://127.0.0.1:8080/ws?reconnect_id=…`); connect there, receive a new `session_welcome` (new session id),
  **subscriptions carry over** (GET shows them on the new session id), then close the old socket. Clients
  still on the old server are dropped after 30 s. While reconnect testing is active (~30 s) `close` and
  `subscription` commands are refused ("Cannot activate this command while reconnect testing is active").
- `close --reason=4006` → client sees close code 4006 "network error"; `--reason=4001` → "sent inbound traffic" ✅.
- `subscription --status=…` only changes the status shown by GET; it does **not** push a `revocation`
  message ✅. Valid statuses: `enabled revoked moderator_removed user_removed version_removed
  websocket_disconnected websocket_failed_ping_pong websocket_received_inbound_traffic
  websocket_connection_unused websocket_internal_error network_timeout websocket_network_error`
  (note `revoked`, **not** `authorization_revoked`) ✅.
- ⚠️ **One mock WebSocket server per machine for triggers**: `trigger -T websocket`, `reconnect`, `close`,
  `subscription`, `keepalive` talk to the server over a fixed RPC port **44747** ✅. A second server (any
  `-p`) can't own it, so triggers go to whichever server started first. Run one at a time, or give each
  developer/CI job its own machine/container.
- Clients that dispatch by subscription id (Twurple, or your own map of `subscription.id → handler`) ignore
  triggers with the CLI's random id: pass **`-u <subscription id>`** (the id returned by the mock
  `POST /eventsub/subscriptions`) ✅.
- Twurple: set `TWURPLE_MOCK_API_PORT=<port>` → `EventSubWsListener` connects to `ws://127.0.0.1:<port>/ws`
  and creates subscriptions at `http://localhost:<port>/eventsub/subscriptions` ✅ (see `twurple.md`).

## 8. Mock Helix API ✅
```
XDG_CONFIG_HOME=$PWD/.twitch-cli-home twitch mock-api generate -c 4   # ~8 s; default -c 25 took minutes here
XDG_CONFIG_HOME=$PWD/.twitch-cli-home twitch mock-api start -p 8080   # "Mock server started"
curl -s localhost:8080/units/clients     # -> [{ID, Secret, Name:"Mock API Client"}]  (no auth needed)
curl -s localhost:8080/units/users       # also /units/{categories,streams,subscriptions,tags,teams,videos}
# app token (query params!):
curl -X POST "localhost:8080/auth/token?client_id=$ID&client_secret=$SECRET&grant_type=client_credentials"
# user token for a mock user (scopes must be ones the mock knows):
curl -X POST "localhost:8080/auth/authorize?client_id=$ID&client_secret=$SECRET&grant_type=user_token&user_id=$UID&scope=channel:manage:polls%20moderator:read:followers"
curl "localhost:8080/mock/users?id=$UID" -H "Client-Id: $ID" -H "Authorization: Bearer $TOKEN"
curl "localhost:8080/auth/validate" -H "Authorization: OAuth $TOKEN"   # works ✅
```
- Base URL swap: `https://api.twitch.tv/helix/...` → `http://localhost:<port>/mock/...`; auth:
  `https://id.twitch.tv/oauth2/...` → `http://localhost:<port>/auth/...` ✅. `generate` prints the partner
  user id "that has all applicable units".
- Tokens last 24 h, no refresh tokens, no OIDC ✅/docs. No `Ratelimit-*` headers ✅.
- Worked ✅: Get Users, Get Channel Followers, Get Streams, Create Poll, Get Custom Reward, validate.
- Missing/unsupported ✅: `POST /mock/chat/messages` (Send Chat Message) → 404; scopes `user:read:chat`,
  `user:write:chat`, `user:bot`, `channel:bot` → "Invalid scopes requested". Docs: no Extensions,
  code entitlements or EventSub endpoints. Newer endpoints (pinned chat, power-ups, …) are absent.
  → Mock-API is good for classic Helix reads/writes; test chat sending against real Twitch or a fake.

## 9. Recipes — the local test loop
**Webhook handler** (no HTTPS needed locally):
```
export TWITCH_DISABLE_UPDATE_CHECKS=true
node server.ts &                                        # listens on :8080/eventsub, secret from env
twitch event verify-subscription channel.follow -F http://localhost:8080/eventsub -s "$TWITCH_EVENTSUB_SECRET"
twitch event trigger channel.follow -F http://localhost:8080/eventsub -s "$TWITCH_EVENTSUB_SECRET"
twitch event trigger channel.channel_points_custom_reward_redemption.add -n "Hydrate" -C 500 -F ... -s ...
twitch event trigger channel.cheer -C 1000 -a -F ... -s ...           # anonymous 1000-bit cheer
twitch event trigger channel.subscription.gift -C 5 --tier 2000 -F ... -s ...
twitch event trigger channel.raid -f 1234 -t 5678 -F ... -s ...        # raid from 1234 into 5678
twitch event trigger channel.follow -s wrongsecret123 -F ...           # must be rejected (403/401) by your HMAC check
twitch event trigger channel.follow -I dup-1 -F ... -s ...; twitch event retrigger -i dup-1 -F ... -s ...   # dedupe
twitch event trigger channel.follow -r authorization_revoked -F ... -s ...   # revocation handling
```
**WebSocket client**:
```
twitch event websocket start-server -p 8080 &      # one per machine (RPC port 44747)
EVENTSUB_WS_URL=ws://127.0.0.1:8080/ws node bot.ts  # make the URL + Helix subscription URL configurable!
twitch event trigger channel.follow -T websocket
twitch event websocket reconnect                    # client must follow reconnect_url
twitch event websocket close --session=<id> --reason=4007   # client must reconnect + resubscribe
```
In your client make both the WS URL **and** the subscriptions URL configurable
(`https://api.twitch.tv/helix/eventsub/subscriptions` → `http://127.0.0.1:8080/eventsub/subscriptions`).

## 10. Known limitations (1.1.24)
- No `channel.chat.*`, Bits-use, Power-ups, moderate/warnings/automod triggers; hype train only v1.
- Mock WS subscription endpoint rejects chat types; 409 per type+version.
- One mock WS server per machine (RPC 44747); mock-api sqlite contention across processes → isolate with `XDG_CONFIG_HOME`.
- Update check can panic → `TWITCH_DISABLE_UPDATE_CHECKS=true`.
- `token -v` doesn't flag invalid tokens clearly.
