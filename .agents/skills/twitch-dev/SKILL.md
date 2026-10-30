---
name: twitch-dev
description: Start here for ANY Twitch dev task in TypeScript/Node. Hub that picks the right Twitch surface and gets auth right - platform map for chat bots and !commands, stream overlays as OBS browser sources, alerts for follows, subs, raids, cheers/bits, channel points redemptions, hype trains, polls and predictions via EventSub, Helix API, Extensions (panel, overlay, component) and embeds; OAuth and tokens (app vs user token, auth code, client credentials, device code flow, refresh, hourly validate, every scope with recipes, bot plus broadcaster accounts, chatbot badge); app registration and redirect URIs; verified Twitch CLI guide (token, api, event trigger, mock EventSub WebSocket, mock-api); Twurple; architecture for overlay backends, Nuxt/Nitro, tunnels, conduits, testing, LLM chat features; deprecations (PubSub, Kraken v5, follow v1, hype train v1). Use first for any twitch bot, overlay, alert box, twitch login or hackathon project, then route to twitch-api, twitch-eventsub, twitch-chat or twitch-extensions.
---

# Twitch development hub

This skill is the **router and foundation** of a 5-skill suite. It owns: choosing a surface, app
registration, OAuth/tokens/scopes, the Twitch CLI, Twurple, cross-cutting architecture (overlays, bots,
backends), and deprecations. Deep, surface-specific material lives in the sibling skills:

| Sibling skill | Owns |
|---|---|
| **twitch-api** | Helix REST: every endpoint, conventions, rate limits, pagination, typed fetch client |
| **twitch-eventsub** | EventSub: WebSocket / webhook / conduit transports, all subscription types + payloads, templates |
| **twitch-chat** | Chat bots: EventSub chat + Send Chat Message, IRC, emotes/badges rendering, moderation, whispers, limits |
| **twitch-extensions** | Extensions: Helper JS, JWT, EBS, config service, Extension PubSub, Bits in Extensions, review |

Read this file first, then the reference it points to, then the sibling skill. Twitch changed a lot in
2023–2026; **do not trust remembered APIs** — check `references/deprecations-and-gotchas.md` and the
official snapshots under `references/official/` (fetched 2026-10-26).

## When to use
- Any new Twitch project or feature ("make a twitch bot", "stream overlay for subs", "channel points game",
  "log in with Twitch", "react to raids", "TwitchCon hackathon idea").
- Any auth question: which token, which scopes, refresh/validate, 401/403, bot vs broadcaster, chatbot badge.
- Setting up the dev loop: registering the app, getting tokens locally, Twitch CLI mocks/triggers.
- Architecture decisions: WebSocket vs webhook vs conduit, how overlays get events, Nuxt/Nitro wiring, deploys.
- Choosing/using Twurple vs raw fetch.

## Mental model

```
 Twitch ──(1) Helix REST  api.twitch.tv/helix ────────▶ read/write things (users, streams, rewards, polls, chat send…)
        ──(2) EventSub    WebSocket | webhook | conduit ▶ get pushed events (follow, sub, cheer, raid, redeem, chat…)
        ──(3) Chat        = EventSub chat types + Helix Send Chat Message   (IRC still works, legacy)
        ──(4) Extensions  iframe inside twitch.tv + your EBS (viewer-interactive UI on the channel page)
        ──(5) Embeds      player/chat iframes on *your* website
 Auth: OAuth 2 at id.twitch.tv → app access token (your app) or user access token (a user + scopes)
```
- **Read state with Helix, react to changes with EventSub, talk in chat via EventSub + Send Chat Message.**
- An **OBS overlay** is just a web page (browser source) fed by *your backend*; viewers can't click it.
  Viewer interaction = chat commands, channel points, Bits, polls/predictions — or an **Extension**.
- Every Helix request: `Authorization: Bearer <token>` + `Client-Id: <the token's client id>`.
- IDs not logins: conditions/params use numeric user IDs (resolve logins once via Get Users).
- Scopes are granted **per (client ID, user)**. The *broadcaster* must authorize broadcaster data.

## Platform map — which surface for which goal

| Goal | Surface | Token(s) | Go to |
|---|---|---|---|
| Bot answering `!commands`, greeting, games in chat | EventSub `channel.chat.message` + Helix Send Chat Message | bot account (user:read:chat, user:write:chat, user:bot) + broadcaster `channel:bot`; app token to send for the badge | **twitch-chat** (+ `scopes.md` §1.1) |
| Alerts overlay (follow, sub, gift, cheer/bits, raid, redemption, hype train, goal, poll, prediction, power-ups) | EventSub → your backend → SSE/WS → OBS browser source | broadcaster user token (WS) or app token (webhook) + broadcaster scopes | **twitch-eventsub** + `architecture.md` §3–5 |
| On-screen chat box | `channel.chat.message` (+ `channel.chat.message_delete`, `.clear`) → overlay | user token w/ `user:read:chat` | **twitch-chat** (rendering emotes/badges) |
| Channel-points game / economy | Helix Create Custom Reward + `…redemption.add` + Update Redemption Status | broadcaster `channel:manage:redemptions` (affiliate/partner only) | **twitch-api** + **twitch-eventsub** |
| Run/read polls & predictions | Helix Create Poll/Prediction + `channel.poll.*` / `channel.prediction.*` | broadcaster `channel:manage:polls/predictions` | **twitch-api** |
| Change title/category, markers, clips, raids, shoutouts, ads | Helix | broadcaster (or mod) user token / app token w/ prior auth | **twitch-api** |
| Moderation tool / AutoMod queue / AI mod | Helix moderation + `channel.moderate` v2, `automod.message.hold` v2 | moderator token w/ `moderator:*` scopes | **twitch-chat** (moderation) + **twitch-api** |
| "Log in with Twitch" on a website | OAuth authorization code (+ OIDC) | user token; no scopes needed for identity | `auth.md` §3, §7 |
| Is channel live? viewer count? | Helix Get Streams; `stream.online/offline` | app token | **twitch-api** / **twitch-eventsub** |
| Interactive UI **on twitch.tv** (panel below stream, clickable video overlay, component, mobile) | **Extension** + EBS | Extension JWT (Helper), app token for EBS Helix calls | **twitch-extensions** |
| Show a stream / chat on your site | Embed iframes (`parent=` required) | none | `embed-and-insights.md` |
| Many channels / SaaS | EventSub webhooks or **conduit** | app token | `architecture.md` §10 + **twitch-eventsub** |
| Game/Extension analytics | Get Extension/Game Analytics, CSV | `analytics:read:*` | `embed-and-insights.md` |

Not possible via API (don't promise it): following a channel for a user, reading other channels' private
data without their consent, getting viewer identities of a stream, clicking in an OBS overlay.

## Token cheat-sheet

| Need | Token |
|---|---|
| Public data (users, streams, games, clips, emotes, badges) | **app** token (client credentials) — or any user token |
| EventSub over **WebSocket** | **user** token of the user the condition refers to (fails with app token) |
| EventSub over **webhook** or **conduit** | **app** token (fails with user token); users must have authorized the needed scopes earlier |
| Read chat (`channel.chat.message`) | WS: bot/broadcaster user token w/ `user:read:chat`. Webhook/conduit: app token + reader's `user:read:chat`+`user:bot` + broadcaster `channel:bot` (or reader is mod) |
| Send chat (Helix Send Chat Message) | user token w/ `user:write:chat` (no badge) **or app token** + sender's `user:write:chat`+`user:bot` + broadcaster `channel:bot` (or sender is mod) → **Chat Bot badge** |
| Broadcaster actions (rewards, polls, predictions, title, raids, subs list) | broadcaster's **user** token with the scope |
| Moderator actions | moderator's user token, or app token where that mod previously granted the scope (GA 2026-05) |
| Extension frontend → your EBS | Extension JWT from `Twitch.ext.onAuthorized` (not OAuth) |

Lifetimes: user access ≈ 4 h (read `expires_in`), refreshable; app token ≈ 2 months, **not** refreshable
(just fetch a new one); confidential-client refresh tokens don't expire, public-client ones are single-use and
die after 30 days. **Validate every token at startup and hourly** (`GET https://id.twitch.tv/oauth2/validate`)
— Twitch policy, audited. Full detail: `references/auth.md`.

## Critical gotchas (cause most bugs)
1. **Token type ↔ EventSub transport mismatch** (WebSocket=user, webhook/conduit=app). Most "401/403 on
   Create EventSub Subscription" errors are this.
2. **Missing broadcaster consent**: a bot's token can't read the broadcaster's subs/redemptions/follows;
   the broadcaster must authorize your client ID. `channel.follow` v2 also needs `moderator_user_id`.
3. **Outdated knowledge**: PubSub is shut down (2025-04-14), Kraken v5 gone, `/helix/users/follows` gone,
   `channel.follow` v1 gone, hype train v1 gone (2025-12-04), IRC `/ban` etc. gone, non-TLS IRC WebSocket gone.
4. **Affiliate/partner-only** features (channel points, polls, predictions, ads, subs) → 403 on plain accounts.
5. **Rewards are owned by the client ID that created them**: you can only fulfil/refund redemptions of rewards
   your app created via the API.
6. **Webhook HMAC must use the raw body**; answer the challenge as `text/plain`; respond within seconds;
   dedupe by `message_id` (at-least-once delivery).
7. **EventSub WebSocket**: subscribe within 10 s of welcome, follow reconnect URLs, missed events are not
   replayed; 3 sockets / 300 subs per user token.
8. **Send Chat Message can return 200 with `is_sent:false`** (AutoMod/dup/slow mode) — check `drop_reason`;
   ignore your own bot's messages to avoid loops.
9. **Secrets never reach browsers/overlays**: overlays authenticate to *your* backend with a secret URL key.
10. **Redirect URI must match exactly** (scheme, host, port, path, trailing slash); 2FA required to register.
11. **Twitch CLI ≠ production**: no chat/bits.use/v2-hype-train triggers; mock API lacks chat endpoints; set
    `TWITCH_DISABLE_UPDATE_CHECKS=true` (its update check can panic with exit 2). See `twitch-cli.md`.
More: `references/deprecations-and-gotchas.md` §3.

## Quick-start (TypeScript project, local dev)

```bash
# 0. Node >= 22.18 (runs .ts directly), "type": "module" in package.json
# 1. Register an app (Confidential; redirect http://localhost:3000 first) -> references/app-registration.md
cat >> .env <<'EOF'
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
TWITCH_EVENTSUB_SECRET=   # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TWITCH_TOKEN_FILE=.twitch-tokens.json
EOF
echo -e ".env\n.twitch-tokens.json" >> .gitignore
mkdir -p scripts && cp <this-skill>/scripts/token.ts scripts/   # zero-dependency OAuth helper
set -a; . ./.env; set +a
# 2. Tokens (stored in .twitch-tokens.json, mode 0600)
node scripts/token.ts app                                                     # app access token
node scripts/token.ts login  --name broadcaster --scopes "channel:bot moderator:read:followers channel:read:subscriptions bits:read channel:read:redemptions"
node scripts/token.ts device --name bot --scopes "user:read:chat user:write:chat user:bot"   # log in as the BOT account
node scripts/token.ts validate --name bot
node <this-skill>/scripts/token.ts scopes "channel.follow"                     # which scope does X need? (run from the skill)
# 3. Build: raw EventSub WebSocket client -> twitch-eventsub skill templates;  Twurple -> assets/templates/twurple-quickstart.ts
# 4. Test without touching production (see references/twitch-cli.md):
export TWITCH_DISABLE_UPDATE_CHECKS=true
twitch event websocket start-server -p 8080 &                 # point your client at ws://127.0.0.1:8080/ws
twitch event trigger channel.follow -T websocket
twitch event trigger channel.cheer -F http://localhost:3000/api/eventsub -s "$TWITCH_EVENTSUB_SECRET"   # webhook path
```

Minimal Helix call (both headers are mandatory):
```ts
const res = await fetch('https://api.twitch.tv/helix/users?login=twitchdev', {
  headers: { Authorization: `Bearer ${token}`, 'Client-Id': process.env.TWITCH_CLIENT_ID! },
});
if (res.status === 401) { /* refresh (user) or re-mint (app) once, then retry */ }
const { data } = (await res.json()) as { data: Array<{ id: string; login: string; display_name: string }> };
```
Alternatively with the Twitch CLI: `twitch configure -i $TWITCH_CLIENT_ID -s $TWITCH_CLIENT_SECRET`,
`twitch token -u -s "user:read:chat user:write:chat"` (or `--dcf`), `twitch api get users -q login=twitchdev`.

Hackathon defaults that work: one Confidential app; streamer + separate bot account; EventSub **WebSocket**
in dev (no tunnel), webhooks when deployed if you need durability; backend owns all tokens; overlays are
1920×1080 transparent pages subscribed to the backend via SSE; make the bot a moderator of the channel.

## Reference map

| File | Read/use when |
|---|---|
| `references/auth.md` | Implementing any OAuth flow (code, client credentials, DCF public/confidential, implicit, OIDC), refresh/validate/revoke, token storage, multi-user (bot + broadcaster), "which token for which surface", auth errors |
| `references/scopes.md` | Choosing scopes: recipes (chatbot, alerts overlay, mod tool, channel-points game, polls/predictions) + exhaustive generated table scope → endpoints → EventSub types |
| `references/scopes.json` | Machine-readable scope table (used by `token.ts scopes`) |
| `references/app-registration.md` | Registering the app, client types, redirect URIs, secrets, 2FA, categories, chatbot badge vs verified bot |
| `references/twitch-cli.md` | Any Twitch CLI usage: verified commands, event triggers (+ list), mock WebSocket server (reconnect/close/subscription), mock-api, token/api, env vars, known bugs |
| `references/twurple.md` | Using @twurple/* 8.2: auth providers + persistence, ApiClient, EventSubWsListener, EventSubMiddleware/HttpListener, conduit support, ChatClient/easy-bot, when raw fetch is better |
| `references/architecture.md` | Designing the system: diagrams, transport choice, EventSub ingest + fan-out, OBS overlays, SSE/WS + overlay auth, dual tokens, Nuxt/Nitro (raw body, SSE, WS), tunnels/hosting, secrets, scaling, testing, observability, LLM-on-chat guardrails |
| `references/deprecations-and-gotchas.md` | Before trusting any remembered API/tutorial; dead → replacement table; 2024–2026 changelog digest; top gotchas |
| `references/embed-and-insights.md` | Embedding player/chat/clips on a website (`parent`), Extension/game analytics |
| `references/official/*.md` | Official dev.twitch.tv snapshots (auth pages, scopes, CLI pages, embeds, insights, change-log, product-lifecycle); `FETCHED_ON` has the date |
| `scripts/token.ts` | `node scripts/token.ts <cmd>` (app, login, device, validate, refresh, revoke, show, scopes) — local OAuth helper, JSON token store, `--dry-run`, `--auth-base` for mocks |
| `scripts/gen-scopes.ts` | Regenerates the table in `scopes.md` + `scopes.json` from the official pages (`--check` for CI) |
| `scripts/refresh-docs.sh` | Re-downloads official docs for **all 5** twitch-* skills and re-runs the table generators (scopes, EventSub types, Helix endpoints, extension endpoints); `TWITCH_SKILLS_DIR=/tmp/x` to dry-run elsewhere |
| `scripts/h2md.py` | HTML→markdown converter used by refresh-docs.sh (needs `bs4`) |
| `assets/templates/twurple-quickstart.ts` | Copy-in Twurple bot/overlay backend: RefreshingAuthProvider fed by token.ts store, hourly validate, EventSubWsListener (chat, follow, redemption, cheer, sub, raid, hype train v2), reply via Send Chat Message |

## Looking up details
The official pages are plain markdown with heading anchors — grep them instead of guessing:
```bash
cd <this-skill>
grep -n "^## " references/official/authentication_getting-tokens-oauth.md          # list sections
grep -n -A12 "^## Device code grant flow" references/official/authentication_getting-tokens-oauth.md
grep -n "channel:bot\|user:bot" references/official/authentication_scopes.md
grep -n "^| 2026" references/official/change-log.md | cut -c1-200                      # recent changes
grep -n -i "decommission\|deprecated" references/official/product-lifecycle.md
grep -n -A30 "^## Testing Reconnect" references/official/cli_websocket-event-command.md
node scripts/token.ts scopes "send chat message"                                     # scope lookup
```
Endpoint and EventSub details are in the sibling skills' `references/official/` (e.g. in twitch-api:
`grep -n "^## Create Poll" references/official/api_reference.md`). After `scripts/refresh-docs.sh`, read the top
of `references/official/change-log.md` for anything newer than this guide.
