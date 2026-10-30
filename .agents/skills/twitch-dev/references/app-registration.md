# Registering a Twitch application (dev console)

Official: `references/official/authentication_register-app.md`. Console: https://dev.twitch.tv/console/apps

## Prerequisites (do these first — they block registration)
1. A Twitch account with a **verified e-mail** (Twitch mails a verification link on sign-up).
2. **Two-factor authentication enabled**: https://www.twitch.tv/settings/security → Security → 2FA.
3. **Refresh the console** after enabling 2FA / verifying e-mail, otherwise "Register" stays blocked.
4. For a bot: create the **bot's own Twitch account** now (separate e-mail). The *app* is owned by your
   developer account; the bot account only authorizes the app (it does not need its own app).

## Steps
1. Console → **Applications** → **Register Your Application**.
2. **Name** — must be unique across all Twitch apps; users see it on the consent screen and under
   Settings → Connections → *Other Connections*.
3. **OAuth Redirect URLs** — add each one and click **Add** (rules below).
4. **Category** — pick the closest type (e.g. a chat bot category for bots, website/application
   integration for web apps). Purely descriptive; it doesn't change API behaviour.
5. **Client Type** — **Confidential** (default; you get a client secret; use for anything with a backend)
   or **Public** (no secret; device code flow only; refresh tokens single-use + 30-day expiry).
   For a hackathon web/overlay/bot backend choose **Confidential**.
6. Tick *I'm not a robot* → **Create**.
7. Back in Applications → **Manage**: copy the **Client ID** (public; may appear in front-end code).
8. Click **New Secret** → copy the **Client Secret** once into your secret store / `.env`.
   Generating a new secret **invalidates the old one immediately** — redeploy everything that uses it.

## Redirect URI rules (most common "it doesn't work" cause)
- Must match **exactly** what you send as `redirect_uri`: scheme, host, port, path, and trailing slash.
  `http://localhost:3000` ≠ `http://localhost:3000/` ≠ `http://127.0.0.1:3000`.
- `http://` is fine for `localhost`; real hosts need `https://`.
- Up to **10** URLs per app (Twitch CLI docs).
- **Twitch CLI** `twitch token -u` uses `http://localhost:3000` (or `--port`/`--redirect-host` variants) and
  its docs say that URL must be the **first** entry, with no trailing slash.
- Suggested set for a typical project:
  - `http://localhost:3000` (Twitch CLI + `scripts/token.ts login`)
  - `http://localhost:3000/auth/twitch/callback` (your Nuxt/Express dev server)
  - `https://<your-deploy>/auth/twitch/callback` (production / tunnel URL)
- Remote dev boxes (Codespaces, cloud IDEs): register the forwarded `https://…` URL, or use the device
  code flow, which needs no redirect URI at all.

## Secrets & IDs — handling
| Value | Secret? | Where it may live |
|---|---|---|
| Client ID | no | front-end, overlay HTML, logs |
| Client secret | **yes** | server env only (`TWITCH_CLIENT_SECRET`) — never in a browser, overlay URL, Extension frontend, mobile app or repo |
| EventSub webhook secret | **yes** | server env (`TWITCH_EVENTSUB_SECRET`, 10–100 ASCII chars) — you invent it |
| Extension secret | **yes** | EBS env — see the twitch-extensions skill |
| Access/refresh tokens | **yes** | server-side store (see `auth.md` §13) |

Do **not** share one client ID across different applications — Twitch may suspend API access for it.
One app per product is right; dev/staging/prod may use separate apps so you can rotate secrets independently.

## Extensions are registered elsewhere
Extensions are created under the console's **Extensions** tab and get their own client ID + extension
secret; see the twitch-extensions skill. A normal "Application" is what bots, overlays, websites and
EventSub backends use.

## Chat bot status & badges (what you can and cannot get)
- **Chat Bot badge** (automatic, no application form): send with the Send Chat Message API using an
  **app access token**, the bot user granted `user:bot` (+ `user:write:chat`), the broadcaster granted
  `channel:bot` **or** the bot is a moderator, and the bot is not the broadcaster. To be listed under
  *Chat Bots* in "Users in Chat", read chat via EventSub `channel.chat.message` with an **app token**
  (webhook/conduit) — WebSocket and IRC readers are not listed.
- **Verified bot** (higher chat/auth/join rate limits) is a separate request at
  https://dev.twitch.tv/limit-increase, rarely granted, does **not** give the badge, doesn't raise whisper
  limits, and isn't exempt from AutoMod. As of the 2026-10 docs snapshot, **reviews for chatbot
  verification are temporarily paused** — design within normal limits. Details: twitch-chat skill.

## Organizations (only if you need them)
Drops, game analytics, and some Extension/monetization features require a **developer organization**
(console → Organizations) and game ownership verification. Not needed for bots, overlays or EventSub.

## Checklist before writing code
- [ ] 2FA on, app created, Confidential, Client ID + secret in `.env`
- [ ] Redirect URIs: `http://localhost:3000` first, plus your app callback(s)
- [ ] Bot account created (if any), logged in a private window for authorizing it
- [ ] `TWITCH_EVENTSUB_SECRET` generated: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] `.gitignore` has `.env` and token files
