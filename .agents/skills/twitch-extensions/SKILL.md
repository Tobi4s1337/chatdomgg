---
name: twitch-extensions
description: Build Twitch Extensions in TypeScript/Node - interactive panel, video overlay, video component and mobile extensions inside twitch.tv, their config/live_config views and the Extension Backend Service (EBS). Use for anything touching window.Twitch.ext / the Extension Helper (onAuthorized, onContext, listen/send, configuration, bits, viewer, actions), extension JWTs (verify viewer tokens, sign role external tokens, base64 secret, opaque user IDs, identity linking), Extension PubSub, the Configuration Service (broadcaster/developer/global segments), Bits in Extensions (useBits, products, SKUs, transaction receipts, extension.bits_transaction.create), Send Extension Chat Message, CSP/allowlist errors, Vite builds, zip upload, Local Test, Hosted Test, review and release. Trigger on extension, panel, overlay extension, component, EBS, ext-twitch.tv, twitch-ext.min.js, hosted test, bits products, viewer polls/voting/minigames on stream. Not for OBS browser-source overlays (see twitch-dev).
---

# Twitch Extensions

A Twitch Extension is a **static web app that Twitch hosts and iframes into the channel page**
(and the creator dashboard / mobile app). It talks to Twitch through the **Extension Helper**
(`window.Twitch.ext`) and, optionally, to **your own backend (EBS)** using a JWT that Twitch hands it.
Everything here is TypeScript/Node 22+, zero-dependency except `jose` on the EBS.

## When an Extension is the right choice

| You want… | Use | Why |
|---|---|---|
| **Viewers** click/vote/play *on twitch.tv*, per-viewer UI, Bits-powered actions | **Extension** | Only Extensions render inside twitch.tv for every viewer and know who is clicking (opaque/linked ID) |
| Graphics/alerts *burned into the stream video* (also in VODs) | OBS **browser source overlay** | Viewers can't interact; no review; any web tech. See the twitch-dev skill |
| Chat commands (`!vote`), bots | **Chatbot** | See the twitch-chat skill |
| Reacting to follows/subs/raids/cheers/channel points | **EventSub** | See the twitch-eventsub skill |

Common winning combo: Extension for viewer input → EBS → (a) Extension PubSub back to all viewers,
(b) a WebSocket to an OBS browser source so the result shows *in the video* (the official
"Increase Feedback" guide recommends exactly this), (c) Send Extension Chat Message for callouts.

**Hackathon reality check.** Review takes **8–14 days** and only one version can be in review at a
time, so a hackathon extension lives in **Local Test or Hosted Test**. In both, the extension is
visible **only to accounts on the Testing Account Allowlist** (Access tab, numeric user IDs) plus the
owner — everyone else sees the channel without it. Add every teammate/judge account ID up front, or
demo from an allowlisted account. Building extensions requires **2FA** on the Twitch account.

## Mental model

```
 twitch.tv page ──embeds──▶ supervisor.ext-twitch.tv ──embeds──▶ https://<client_id>.ext-twitch.tv/.../panel.html
                                                                   │  (your zip, served from Twitch CDN)
   Twitch.ext.onAuthorized → { token (JWT), helixToken, channelId, clientId, userId (opaque) }
   Twitch.ext.configuration → broadcaster/developer/global segments, delivered at load (no EBS needed)
   Twitch.ext.listen('broadcast') ◀─────────── Helix POST /extensions/pubsub ◀── EBS (EBS-signed JWT)
   fetch(EBS, Authorization: Bearer <token>) ──────────▶ EBS verifies HS256 with the base64-DECODED secret
```

1. **Frontend = static assets only.** HTML/JS/CSS/images in a zip, served by Twitch's CDN. The
   Content Security Policy blocks remote scripts (only your files, the helper, Google Analytics),
   inline scripts, iframes, remote fonts except Google Fonts, and any fetch/img/media domain you did
   not allowlist in the console. No SSR — build a SPA (Vite).
2. **Helper is mandatory**: every HTML page loads
   `https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js` as its **first script**, from
   Twitch's CDN (never bundle or self-host it).
3. **Identity**: `auth.userId` is an *opaque* ID — `U…` (logged in, stable across channels) or `A…`
   (anonymous, changes every session — never persist). The real Twitch user ID appears only after
   the viewer accepts `Twitch.ext.actions.requestIdShare()` (needs "Request Identity Link" enabled).
4. **JWT** (HS256, signed with your extension secret) carries `channel_id`, `role`
   (`broadcaster|moderator|viewer`), `opaque_user_id`, `user_id?`, `pubsub_perms`, `exp`. It refreshes
   itself and `onAuthorized` re-fires — always use the latest token.
5. **EBS (optional)**: any HTTPS server. Verifies frontend JWTs; signs its own `role: "external"`
   JWT to call Helix `/extensions/*` (PubSub, configuration, chat, secrets).
6. **Config service**: up to 5 KB per segment, delivered with the page — lets a pure-frontend
   extension (no EBS) be configured by the broadcaster.
7. **Extension PubSub** is alive and separate from the decommissioned legacy PubSub (shut down
   2025-04-14; Twitch stated Extension PubSub is unaffected). Topics: `broadcast` (channel),
   `global` (all channels), `whisper-<opaqueId>` (one viewer).

## Extension types (anchors) and views

| View | Where | Size / constraints | Path field (Asset Hosting) |
|---|---|---|---|
| `panel` | Below the video, also when offline; pop-out button | **318 px wide**, height set in console **100–500 px** (default 300); keep content within 318×496 to avoid scrolling | Panel Viewer Path |
| `video_overlay` | Transparent layer over the **whole player**; disabled offline, hidden while paused/ads | Must scale with the player; avoid player-control zones; global overlays must be interactive & stream-relevant (policy 4.10) | Video – Fullscreen View Path |
| `video_component` | Inside the player in a collapsible extensions sidebar, starts minimized | Console: aspect ratio X/Y, target height (% of player), autoscale + scale pixels; must fill its iframe and not duplicate the frame's minimize/title UI (2.10/2.11) | Video – Component Viewer Path |
| `mobile` | Twitch mobile app, behind chat | Fluid layout, ≥44pt tap targets, initial load ≤ 1 MB, < 3 s at ~500 Kb/s (policies 3.2/3.3) | Mobile Viewer Path (can reuse panel html; `?platform=mobile`) |
| `config` | Extensions manager, before/after activation (broadcaster) | Dynamic width up to 1100 px, dynamic height | Config Path (required) |
| `live_config` | Creator dashboard Live module (broadcaster, while live); pop-out | — | Live Config Path (optional) |

Every iframe gets query params `anchor` (web only: `panel|video_overlay|component`), `platform`
(`web|mobile`), `mode` (`viewer|dashboard|config`), `state` (`testing|hosted_test|released|…`),
`popout`, `language`, `locale`.

## Lifecycle

**Local Test** (assets from your Testing Base URI — HTTPS, must end in `/`) → upload zip → **Hosted
Test** (assets from Twitch CDN — the first time CSP and relative paths are really exercised) →
**Review** (8–14 days; needs review channel URL, walkthrough guide, icons/screenshots, privacy &
ToS URLs) → **Pending Action** / **Rejected** (terminal, client ID revoked) / **Approved** →
**Released** (immutable; a new version replaces it, old one → Deprecated). Changing version
details requires moving back to Local Test. Details: `references/dev-workflow.md`.

## Gotchas that cause most bugs

1. **Secret is base64.** Decode it (`Buffer.from(secret, 'base64')`) before HMAC; using the string
   directly yields "invalid signature" everywhere (EBS verify, Helix 401, Bits receipts).
2. **Opaque ≠ user ID.** `auth.userId`, `viewer.opaqueId`, `whisper-<id>` are opaque. Key per-user
   data on `U…` opaque IDs or linked `user_id`; reject/skip `A…` for anything persistent.
3. **CSP**: no inline `<script>` (load a bundled file), no `eval`-style libs bundled with your code,
   no iframes, fonts only local/Google Fonts (don't inline them as `data:` — Vite `assetsInlineLimit: 0`),
   every external fetch/image/media domain must be in the console allowlists ("Allowlist for URL
   Fetching Domains" etc.) including **your EBS**. CSP via `<meta>` is not allowed.
4. **Absolute asset paths break on the CDN** (served under `/<client_id>/<version>/<hash>/`).
   Use relative paths: Vite `base: './'`. Zip the **contents** of `dist/`, not the folder.
5. **Roles come only from the verified JWT.** `Twitch.ext.viewer.*` is unvalidated (UI only).
   `moderator` is only reported for identity-linked users. The EBS must check `role` for privileged
   actions and use `channel_id` from the token, never from the request body.
6. **Viewers can't publish PubSub or write config.** `Twitch.ext.send` and `configuration.set`
   work only with a broadcaster token (config/live_config views). Viewers → your EBS → Helix.
7. **PubSub limits**: message ≤ 5 KB; Building guide says **1 msg/s per channel**, Helix reference
   says 100/min per (client ID, broadcaster). Coalesce updates (the template sends leading +
   trailing at ≤1/s). `listen()` callbacks receive the message as a **string**.
8. **Set Extension Configuration Segment does not reach open extensions** — push a PubSub message
   (or reload) when the EBS changes config. Config `set` is 5 KB max, 20 writes/min (Helix).
9. **EBS JWTs**: `role: "external"`, `user_id` = **extension owner's** user ID (not the
   broadcaster), short `exp`, plus `channel_id` (+ `pubsub_perms.send`) for PubSub and chat. Header
   `Authorization: Bearer <jwt>` **and** `Client-Id: <extension client id>`.
10. **CORS on the EBS**: frontend origin is `https://<client_id>.ext-twitch.tv` (Hosted Test and
    later); allow `Authorization, Content-Type` in preflight. In Local Test the page comes from your
    base URI, so allow that origin too.
11. **Bits**: always gate UI on `Twitch.ext.features.isBitsEnabled` (mandatory). Bits only work on
    Affiliate/Partner channels that can receive Bits; dev-mode products on your own testing channel
    don't deduct Bits; loopback/test transactions carry **no receipt**. Never grant anything on the
    client's word — verify `transactionReceipt` on the EBS. Wording: "use/exchange/get Bits", never
    "buy/spend/purchase/donate/cheer".
12. **`onAuthorized` fires repeatedly** (refresh) — register once, store latest, don't re-init the app.
13. **Hosted Test visibility** = allowlisted test accounts only, and viewers must accept the
    pre-release disclosure prompt. If "nothing shows up", check the allowlist and activation slot.
14. `onPositionChanged` was **removed** from the reference (2026-06-08, "unused"); Developer Rig is
    decommissioned; legacy `Twitch.ext.purchases` / `rig` are not documented — don't use them.

## Quick start (vanilla TS + Vite + node:http EBS)

```bash
# 1. Console: dev.twitch.tv/console/extensions → Create Extension → type Panel (+ others) → version 0.0.1
#    Asset Hosting: Testing Base URI https://localhost:8080/ ; Panel Viewer Path panel.html ;
#    Config Path config.html ; Live Config Path live_config.html ; Video-Fullscreen path video_overlay.html
#    Capabilities: "Extension Configuration Service"; Allowlist for URL Fetching Domains: your EBS origin
#    Settings: copy Client ID + Extension Secret (base64) + your numeric owner user ID
SKILL=<path to this skill>
cp -r $SKILL/assets/templates/frontend web && cp $SKILL/assets/templates/twitch-ext.d.ts web/src/
cp -r $SKILL/assets/templates/ebs ebs
(cd web && npm i && cp .env.example .env)       # set VITE_EBS_URL
(cd ebs && npm i && cp .env.example .env)       # set TWITCH_EXTENSION_CLIENT_ID/SECRET/OWNER_ID
mkcert -install && mkcert -cert-file web/certs/localhost.pem -key-file web/certs/localhost-key.pem localhost
(cd web && npm run watch & npm run preview)     # https://localhost:8080/panel.html
(cd ebs && npm run dev)                         # HTTPS: set EBS_TLS_CERT/EBS_TLS_KEY (mkcert) or use a tunnel
node $SKILL/scripts/jwt-selftest.ts ./ebs/jwt.ts && node $SKILL/scripts/ebs-smoke-test.ts ./ebs/server.ts
# 2. Status page → "View on Twitch and Install" → Configure → Activate as Panel 1 → open your channel
# 3. Hosted Test: (cd web && npm run zip) → Files → upload extension.zip → Move to Hosted Test
```

Minimal frontend pattern (what `src/lib/ext.ts` does):

```ts
const ext = window.Twitch.ext;
let token = '';
ext.onAuthorized((auth) => { token = auth.token; });            // fires again on refresh
ext.onContext((ctx) => { if (ctx.theme) document.documentElement.dataset.theme = ctx.theme; });
ext.configuration.onChanged(() => render(JSON.parse(ext.configuration.broadcaster?.content ?? 'null')));
ext.listen('broadcast', (_t, _type, msg) => update(JSON.parse(msg)));
await fetch(`${EBS}/api/vote`, { method: 'POST', headers: { Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json' }, body: JSON.stringify({ option: 1 }) });
```

Minimal EBS pattern (what `ebs/jwt.ts` + `twitch-ext-api.ts` do):

```ts
const key = Buffer.from(process.env.TWITCH_EXTENSION_SECRET!, 'base64');
const { payload } = await jwtVerify(bearer, key, { algorithms: ['HS256'] });   // jose
const ebsJwt = await new SignJWT({ exp: now + 60, user_id: OWNER_ID, role: 'external',
  channel_id: payload.channel_id, pubsub_perms: { send: ['broadcast'] } })
  .setProtectedHeader({ alg: 'HS256' }).sign(key);
await fetch('https://api.twitch.tv/helix/extensions/pubsub', { method: 'POST', headers: {
  Authorization: `Bearer ${ebsJwt}`, 'Client-Id': CLIENT_ID, 'Content-Type': 'application/json' },
  body: JSON.stringify({ target: ['broadcast'], broadcaster_id: payload.channel_id, message: '{"x":1}' }) });
```

Twurple alternative on the EBS: `@twurple/ebs-helper` (`createExternalJwt`,
`sendExtensionPubSubBroadcastMessage`, `setExtensionBroadcasterConfiguration`,
`sendExtensionChatMessage`, …) — it signs for you but does not verify incoming tokens; keep
`verifyExtensionJwt` from the template for that.

**Vue/Nuxt**: Nuxt SSR/Nitro does not apply to extension views (static CDN files only). Use a plain
Vite + Vue SPA with the same multi-page `vite.config.ts` (add `@vitejs/plugin-vue`); keep Nuxt for
your separate website/EBS if you like.

## Reference map

| File | Read / use when |
|---|---|
| `references/helper-api.md` | Any `window.Twitch.ext` call: every callback, field, action, config, features, bits, viewer, PubSub, query params, JWT schema |
| `references/jwt-and-ebs.md` | Building the EBS: verifying tokens, roles, signing external JWTs, Helix extension calls, PubSub/chat limits, CORS, secret rotation, Helix JWT in the frontend |
| `references/config-service.md` | Storing settings: segments, versions, 5 KB, required configuration, frontend vs EBS writes |
| `references/bits-and-monetization.md` | Bits products/SKUs, useBits flow, receipt verification, EventSub `extension.bits_transaction.create`, Get Extension Transactions, loopback testing, eligibility, wording policy, subscription status |
| `references/dev-workflow.md` | Vite multi-page build, HTTPS local test, zip rules, console fields, Hosted Test, review checklist & policies, design (theme, sizes, fonts), A/B tests, analytics, load testing |
| `references/helix-extension-endpoints.md` | Generated table of all 17 extension-related Helix endpoints with auth type, required JWT claims and rate limits |
| `assets/templates/twitch-ext.d.ts` | Copy into `src/` — ambient types for the whole helper (`Twitch.ext.*`, query params) |
| `assets/templates/frontend/` | Vite multi-page starter: `panel/mobile/video_overlay/config/live_config.html`, `src/lib/ext.ts` (auth fan-out, EBS fetch, Helix JWT fetch, theme, PubSub JSON, config), views, CSS |
| `assets/templates/ebs/jwt.ts` | jose-based verify (rotation-aware), `requireRole`, Bits receipt verify, external JWT signing |
| `assets/templates/ebs/twitch-ext-api.ts` | Typed Helix calls: PubSub (channel/global/whisper), config get/set, required config, chat, secrets, Get Extensions |
| `assets/templates/ebs/server.ts` | node:http EBS: CORS, JWT middleware, role checks, vote endpoint, Bits receipt endpoint, coalesced PubSub broadcast |
| `scripts/jwt-selftest.ts` | Run against your `jwt.ts` copy: 22 checks (tampered/expired/alg/rotation/receipts/external JWT) |
| `scripts/ebs-smoke-test.ts` | Spins up your `server.ts` + a mock Helix and checks auth, roles, CORS, Bits, PubSub throttling end to end |
| `scripts/make-jwt.ts` | Zero-dep CLI: mint `external` tokens for curl against Helix, fake `viewer`/`broadcaster` tokens for your EBS, `decode` |
| `scripts/gen-extension-endpoints.ts` | Regenerates `helix-extension-endpoints.md` from the API reference (run by twitch-dev `refresh-docs.sh`) |

## Looking up details

The official pages are in `references/official/` (line 1 = source URL; regenerated by the
twitch-dev skill's `refresh-docs.sh`, don't edit):

```bash
grep -n "^## \|^### " references/official/extensions_reference.md      # helper API + JWT schema
grep -n "onTransactionComplete" -A 25 references/official/extensions_reference.md
grep -n "^## Restrictions on content" -A 15 references/official/extensions.md   # CSP table
grep -n "Asset Hosting" -A 30 references/official/extensions_life-cycle.md     # console fields
grep -n "^## [0-9]" -A 12 references/official/extensions_guidelines-and-policies.md  # review policies
# Helix extension endpoints live in the twitch-api skill's official api_reference.md:
grep -n "^## Send Extension PubSub Message" -A 80 <twitch-api skill>/references/official/api_reference.md
```

EventSub `extension.bits_transaction.create` payloads: see the twitch-eventsub skill. App access
tokens (needed for Get Extension Transactions / Bits products / Live Channels): see the twitch-dev skill.
