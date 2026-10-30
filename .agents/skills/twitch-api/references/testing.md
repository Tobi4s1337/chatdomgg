# Testing Helix code without real credentials (Twitch CLI mock API)

Verified 2026-10-26 with Twitch CLI v1.1.24 (`twitch version`).

## Start the mock

```bash
# Isolate the mock DB per project (it lives in $HOME/.config/twitch-cli/eventCache.db):
export HOME=$PWD/.twitch-mock-home && mkdir -p "$HOME"
twitch mock-api generate -c 10 </dev/null   # ~25 s for 10 users; -c 25 takes minutes (slow sqlite inserts)
#   prints:  Client-ID: edb4bd86...   Secret: ab6d5ba1...
#            User ID 25966556 has all applicable units (streams, subs, and the like) and is a partner
twitch mock-api start -p 8110 </dev/null &  # "Mock server started"; kill it when done
```

- `generate` blocks waiting on stdin in some shells — redirect `</dev/null`.
- One partner user gets everything (streams, subs, followers, rewards, redemptions, clips, videos).

## Endpoints on the mock (same port)

| Real | Mock |
|---|---|
| `https://api.twitch.tv/helix/<path>` | `http://localhost:8110/mock/<path>` |
| `POST https://id.twitch.tv/oauth2/token` (client_credentials, form body) | `POST http://localhost:8110/auth/token` (form body or query) |
| `GET https://id.twitch.tv/oauth2/validate` | `GET http://localhost:8110/auth/validate` |
| user token (OAuth code flow) | `POST http://localhost:8110/auth/authorize?client_id=&client_secret=&grant_type=user_token&user_id=<id>&scope=<space-separated>` (**query string only**; form body → 400) |
| — | `GET http://localhost:8110/units/{users,clients,streams,...}` — unauthenticated dump of generated data |

```bash
B=http://localhost:8110 CID=<Client-ID> SEC=<Secret> U=<partner user id>
APP=$(curl -s -X POST $B/auth/token -d "client_id=$CID&client_secret=$SEC&grant_type=client_credentials" | jq -r .access_token)
curl -s "$B/mock/streams?first=2" -H "Client-Id: $CID" -H "Authorization: Bearer $APP"
UT=$(curl -s -X POST "$B/auth/authorize?client_id=$CID&client_secret=$SEC&grant_type=user_token&user_id=$U&scope=channel:manage:polls%20clips:edit" | jq -r .access_token)
```

With the template client: `new HelixClient({ clientId, token, baseUrl: "http://localhost:8110/mock" })` and
`new AppTokenProvider({ clientId, clientSecret, authBaseUrl: "http://localhost:8110/auth" })`.

## Smoke test

```bash
node scripts/smoke-test.ts            # MOCK_BASE (default http://localhost:8110), MOCK_CLIENT_ID/SECRET optional
```
Covers users (ids/login batch), streams + cursor paging + `paginate()`, channels get/patch, search, games,
polls, predictions (lock/resolve), custom rewards + redemptions, clips, raids, shoutouts, announcements,
followers, subscriptions, 401→refresh, error bodies, and (on a throwaway `node:http` fake at port 8111)
429 handling with `Ratelimit-*` headers. 31/31 passed on 2026-10-26.

## Mock vs. real differences (observed)

- No `Ratelimit-*` headers on the mock; never returns 429 — test rate-limit logic against a fake server.
- Scope list is older than the docs: `user:write:chat` is rejected ("Invalid scopes requested") and
  `POST /mock/chat/messages` is 404 → Send Chat Message can't be mocked; pinned chat, suspicious users,
  Get Hype Train Status, Create Clip From VOD etc. likely missing too (newer endpoints).
- Data shapes are close but not exact: e.g. `gifter_id` is `null` (real: `""`), `is_mature` in Start a
  raid is `true` (real: always `false`), `/units/users` returns internal fields (`game_id: {String, Valid}`).
- Ownership checks exist: `broadcaster_id` ≠ token user → `401 {"message":"broadcaster_id does not match token"}`.
- Create Clip returns 200 on the mock (real: 202) and the clip doesn't need polling.
- Error body format matches real Helix: `{"status":401,"error":"Unauthorized","message":"Invalid OAuth token"}`.

## Against real Twitch

- `twitch token` (app token) / `twitch token -u -s 'scope1 scope2'` (user token via localhost:3000 redirect)
  after `twitch configure` with your client ID/secret — see the twitch-dev skill.
- `twitch api get users -q login=twitchdev` — quick ad-hoc calls with the CLI's stored token.
- Real CORS (observed): Helix answers preflights with `Access-Control-Allow-Origin: *` and allows
  `Authorization, Client-Id, Content-Type`.
