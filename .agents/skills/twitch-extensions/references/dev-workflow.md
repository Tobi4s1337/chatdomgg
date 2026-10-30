# Development workflow: build, test, upload, review

Sources: `official/extensions.md` (CSP, HTTPS on localhost), `extensions_life-cycle.md` (states, manager
tabs, Asset Hosting), `extensions_building.md`, `extensions_designing.md`,
`extensions_guidelines-and-policies.md`, `extensions_submission-best-practices.md`,
`extensions_a-b-testing-in-extensions.md`, `extensions_using-google-analytics-in-extensions.md`,
`extensions_load-testing-extensions.md`, Extension 101 tutorials. Build steps verified with Vite 8.3.

## Contents
- [Project layout](#project-layout)
- [Vite multi-page build](#vite-multi-page-build)
- [CSP rules that shape the build](#csp-rules-that-shape-the-build)
- [Console setup (Extensions manager tabs)](#console-setup-extensions-manager-tabs)
- [Local Test over HTTPS](#local-test-over-https)
- [Packaging the zip](#packaging-the-zip)
- [Hosted Test](#hosted-test)
- [Review and release](#review-and-release)
- [Policy checklist](#policy-checklist)
- [Design guidelines](#design-guidelines)
- [Vue, React, other frameworks](#vue-react-other-frameworks)
- [Analytics and A/B testing](#analytics-and-ab-testing)
- [Load testing](#load-testing)
- [Hackathon playbook](#hackathon-playbook)

## Project layout

```
my-extension/
  web/                      ← assets/templates/frontend (zip = contents of web/dist)
    panel.html mobile.html video_overlay.html config.html live_config.html
    src/lib/ext.ts src/panel.ts src/video_overlay.ts src/config.ts src/live_config.ts src/style.css
    src/twitch-ext.d.ts     ← assets/templates/twitch-ext.d.ts
    vite.config.ts certs/   ← mkcert files (gitignored)
  ebs/                      ← assets/templates/ebs (server.ts, jwt.ts, twitch-ext-api.ts)
  overlay/                  ← optional OBS browser source (not part of the extension zip)
```

## Vite multi-page build

`assets/templates/frontend/vite.config.ts` (verified: `vite build` → 5 HTML files at `dist/` root,
`./assets/*.js|css`, zero inline scripts, helper stays the first `<script>`):

```ts
export default defineConfig({
  base: './',                                  // relative URLs — CDN path is /<client_id>/<version>/<hash>/
  build: {
    assetsInlineLimit: 0,                      // no data: fonts (font-src forbids data:)
    modulePreload: { polyfill: false },
    minify: false,                             // human-readable JS for review (policy 2.5)
    rolldownOptions: { input: { panel: 'panel.html', video_overlay: 'video_overlay.html', mobile: 'mobile.html',
                              config: 'config.html', live_config: 'live_config.html' } },
  // Vite 5–7: use `rollupOptions` (Vite 8 still accepts it as a deprecated alias)
  },
  server: { port: 8080, https },  preview: { port: 8080, https },   // https from ./certs if present
});
```

- Add `video_component.html` the same way if you support the component anchor.
- Each HTML page: helper `<script src="https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js">`
  first in `<head>`, then `<script type="module" src="./src/<view>.ts">`. Vite rewrites the module
  script to `./assets/<view>-<hash>.js` and leaves the helper alone.
- Env: `VITE_EBS_URL` (build-time) → `import.meta.env.VITE_EBS_URL`. The value ends up in the bundle —
  never put secrets in `VITE_*`.
- `npm run build` = `tsc --noEmit && vite build`. `npm run zip` zips `dist/` contents.
- Module scripts are fine (Twitch's CSP allows `'self'`); mobile policy says iOS 10+/Android 4.1+,
  all current Twitch apps run modern WebViews.

## CSP rules that shape the build

Current policy (changelog 2026-07-31 updated GA URLs, added `blob:` to connect-src and the Twitch image
CDN to img-src):

| Directive | Allowed |
|---|---|
| `default-src` | `'self'`, `https://<client_id>.ext-twitch.tv` |
| `script-src` | self, ext origin, `https://extension-files.twitch.tv` (helper), `*.google-analytics.com`, `www.googletagmanager.com` — **no `'unsafe-inline'`, no `'unsafe-eval'`** |
| `style-src` | self, ext origin, `'unsafe-inline'` (inline styles OK), `fonts.googleapis.com` |
| `font-src` | self, ext origin, `fonts.googleapis.com`, `fonts.gstatic.com` (**no `data:`**) |
| `img-src` | self, ext origin, `static-cdn.jtvnw.net` (Twitch emotes/avatars), GA, `data:`, `blob:`, + **Allowlist for Image Domains** |
| `media-src` | self, ext origin, `data:`, `blob:`, + **Allowlist for Media Domains** |
| `connect-src` | self, ext origin, `https://api.twitch.tv`, `wss://pubsub-edge.twitch.tv`, GA, `blob:`, + **Allowlist for URL Fetching Domains** (your EBS!) |
| `frame-src` | nothing — **no iframes** (policy 2.2) |
| `block-all-mixed-content` | only https/wss |

Consequences: bundle every library (no CDN `<script>`s), no inline `<script>` or `onclick=""`
attributes (inline event-handler attributes are inline script), no `eval`/`new Function` (some template
compilers — use precompiled builds, e.g. Vue runtime-only), no embedded YouTube/iframes, list every
image/media/API domain in the console (and on each version submission, policy 2.12). Configure CSP only
in the console — `<meta http-equiv="Content-Security-Policy">` is not allowed. Iframe sandbox: forms,
scripts, same-origin, popups (and popups-escaping-sandbox) allowed; no `alert/confirm/prompt`, no
top navigation, no pointer lock, no downloads without user activation.

Per community reports the CSP is applied by Twitch's CDN, so **Local Test may not surface CSP
violations** — Hosted Test is where they appear. Always do a Hosted Test pass before demoing.

## Console setup (Extensions manager tabs)

Create: dev.twitch.tv/console/extensions → Create Extension → name → version (e.g. `0.0.1`) → types.
Account needs **2FA**.

| Tab | Key fields |
|---|---|
| Version Details | Name, summary, description, author, category, logo 100×100 PNG, taskbar icon 24×24 PNG (component), discovery image 300×200 PNG, screenshots (1024×768, 4:3, <10 MB), author email (verify it!), support email, EULA/ToS URL, privacy policy URL |
| Capabilities | Request Identity Link (Yes if you need real user IDs), Chat Capabilities (only if you call Send Extension Chat Message), configuration method (none / Custom / Configuration Service) + required segment versions, Allowlist config/panel URLs (off-site links) |
| Monetization | Bits support, Subscription support (required before Hosted Test) |
| Asset Hosting | **Testing Base URI** (must end with `/`), Type of Extension, Panel Viewer Path, Panel Height (100–500, default 300), Video-Fullscreen (overlay) path, Component path + aspect ratio/target height/autoscale/scale pixels, Mobile path, Config Path (≤1100 px wide), Live Config Path (optional), CSP allowlists (Image / Media / URL Fetching domains) |
| Files | Upload Version Assets (zip) |
| Access | Streamer Allowlist (who can install after release), **Testing Account Allowlist** (who can see/install in test) — numeric user IDs, comma separated (Get Users to convert logins) |
| Settings (top right) | Client ID, extension secret(s), owner, delete extension |

Paths are relative to the base URI (Local Test) or zip root (Hosted Test), e.g. `panel.html`; query
strings are allowed (`index.html?view=panel`).

## Local Test over HTTPS

Twitch is HTTPS, so the base URI must be HTTPS (default `https://localhost:8080/`).

```bash
mkcert -install && mkdir -p certs && mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost
npm run watch        # vite build --watch → dist/
npm run preview      # https://localhost:8080/panel.html (vite.config picks up ./certs)
# or: npm run dev    # Vite dev server (HMR); fine for quick iteration but less production-like
```

Then console → Status → **View on Twitch and Install** → Install → Configure (your config.html) →
Activate (choose slot, e.g. Panel 1 / Overlay) → open your channel (overlays/components only render while
**live**; panels work offline). Pop the extension out with the arrow icon to debug it in its own window.

- Easy-mode alternative from the docs: Chrome flag `chrome://flags/#allow-insecure-localhost` and an
  `http://localhost:8080/` base URI.
- Remote teammates/phones: expose with an HTTPS tunnel (cloudflared/ngrok) and use that URL as base URI.
- EBS in Local Test: HTTPS too (template `EBS_TLS_CERT`/`EBS_TLS_KEY`, or a tunnel); add the page
  origin (`https://localhost:8080`) to `EBS_ALLOWED_ORIGINS`.
- Mobile testing: install the Twitch app, log in with an allowlisted account, open the channel;
  query `platform=mobile`.

## Packaging the zip

- Zip the **contents** of `dist/` (files at the zip root), not the `dist` folder:
  `cd dist && zip -r ../extension.zip . -x '*.map'` (verified listing: `panel.html`, `assets/…`).
- Only assets needed to run: no executables, no source maps needed, no `node_modules`, no extraneous files
  (policy 2.8). All HTML/CSS/JS used must be inside the zip.
- Viewer paths in Asset Hosting must match file names in the zip.
- Mobile: initial load from the CDN ≤ 1 MB (policy 3.2).

## Hosted Test

Files tab → upload zip → (wait for "assets uploaded") → Status → **Move To Hosted Test**. Now assets come
from `https://<client_id>.ext-twitch.tv/<client_id>/<version>/<hash>/…` with the real CSP.

- Visible only to the **Testing Account Allowlist** + owner (+ some staff); viewers accept a
  pre-release disclosure first.
- To change version details or assets, move back to Local Test, upload again, re-enter Hosted Test.
- Common failures here: 404s from absolute paths, CSP blocks (EBS/image domains not allowlisted, inline
  script, data: fonts), CORS (origin is now `https://<client_id>.ext-twitch.tv`).

## Review and release

- Submit from Hosted Test: Extension Review Channel URL + **Walkthrough Guide and Change Log**
  (template in `official/extensions_submission-best-practices.md`: backend/allowlists, source code info
  & language, test accounts, changelog, testing steps, optional video, live review times 9AM–5PM PT).
- Review takes **8–14 days**; one version in review at a time; re-submitting resets the queue position.
  Review channel needn't be live for panel-only or self-contained configs; otherwise give live times.
- Minified/obfuscated JS → submit human-readable source via the linked form (policy 2.5/2.6); libraries
  using `eval` must be separate files, not bundled into your minified code. Easiest: `minify: false`.
- Outcomes: Pending Action (fix & resubmit, same version), Rejected (terminal; client ID revoked),
  Approved → **Release** whenever you want. Released versions are immutable; ship updates as a new
  version (Create New Version copies settings). Release immediately upgrades all installs — keep the EBS
  compatible with the previous frontend.

## Policy checklist

Functional/technical: loads on the review channel; config page saves and activation works; no Flash; no
iframes; **no keyboard shortcuts** powering features; audio only with volume controls **default muted**;
human-readable JS; validate AJAX data before injecting into the DOM (use `textContent`); helper first
script in every HTML; components use the whole iframe and don't duplicate frame UI; list all fetched
URLs; public hosting domains need a unique identifier.

Mobile: iOS 10+/Android 4.1+, ≤ 1 MB initial load, < 3 s at ~500 Kb/s, everything visible in portrait
& landscape within the chat viewport. (No Apple developer account / iOS allowlist needed since 2024-07-09.)

Content: icon + ≥1 accurate screenshot; accurate description (incl. chat behaviour); **no Twitch
branding/logo/Glitch/global emotes**; no ads/sponsorships; off-site links need visible indicators and
can't be competitors/social/shopping/CTA landing pages; viewers must not need to download software;
global overlays must be interactive and stream-relevant; no NFTs.

Commerce/Bits: no money for items, no external payment flows, Bits policies (see
`bits-and-monetization.md`).

Moderation (user-generated content): require identity link to submit, show the submitter's username,
let broadcasters review/approve images/AV content and remove any content, honour chat bans, run text
through AutoMod-style checks, consider posting UGC to chat.

## Design guidelines

- **Theme**: follow `onContext` `theme`. Recommended palette — light: bg `#fff`, text `#232127`, links
  `#6441A4`; dark: bg `#201c2b`, text `#e5e3e8`, links `#e2dbf0`; accent `#6441A4` (template CSS).
- **Fonts**: web-safe fonts (fastest) or bundled/Google Fonts; one family, few sizes.
- **Panel**: 318 px wide, ≤ 496 px tall to avoid scrolling, ~10 px inner padding, works offline, splash
  for first use, clear loading state.
- **Overlay**: preload (avoid spinners), stay out of player control areas (top info bar, bottom
  controls), scale with the player (theatre/fullscreen/embed), collapsible, hide when too small,
  keep drag-and-drop inside the frame; disabled when offline, hidden when paused.
- **Component**: fill the iframe; use console sizing (aspect ratio, target height %, autoscale with
  scale pixels → CSS-zoomed fixed-width layout, or responsive when autoscale is off).
- **Mobile**: fluid, ≥ 44 pt tap targets, minimal UI, obvious navigation.
- **Pop-out**: panels and live_config can be popped out (`popout=true`) — layout must grow fluidly.
- **Onboarding**: subtle hints, progressive disclosure, ask for identity only when needed and explain why.
- **Fail gracefully**: handle 4xx/5xx, keep the UI usable, offer a feedback path.
- **Focus**: Twitch returns focus to the player after clicks unless a form field is clicked (Firefox has
  known focus issues with inputs).

## Vue, React, other frameworks

- Any SPA framework works if the build is static, relative, CSP-clean. Vue: `npm i vue
  @vitejs/plugin-vue`, add `plugins: [vue()]`, mount one app per HTML entry (`createApp(Panel).mount('#app')`).
  Vue's default `vue` import in Vite is the runtime-only build (no `eval` template compiler) — good.
- **Nuxt**: SSR/Nitro server routes don't exist on the Twitch CDN. Either skip Nuxt for the extension or
  `nuxi generate` with `ssr: false`, relative `app.baseURL: './'`, and no inline scripts — Nuxt
  injects inline config/payload scripts, which violates `script-src`, so plain Vite + Vue is the reliable
  path. Keep Nuxt for your companion website/EBS.
- React (create-react-app story in the official docs) works the same way: helper `<script>` in
  `index.html`, HTTPS dev server.

## Analytics and A/B testing

- Google Analytics is allowed (script/connect/img CSP include GA/GTM). Load it from your **bundled JS**,
  not an inline snippet; anonymize IPs (GDPR); cookie flags `samesite=none; secure`. Not covered for
  Safari/iOS app.
- Official extension analytics: Helix **Get Extension Analytics** (user token with
  `analytics:read:extensions`) → CSV report URLs (`overview_v2`).
- A/B: split deterministically (e.g. broadcaster/channel ID parity from `auth.channelId`), toggle
  features/CSS per bucket, record events, analyse, ship the winner.

## Load testing

Your EBS must survive every viewer of a big channel loading at once and reacting to the same PubSub
message. Official guide: Locust on AWS Elastic Beanstalk (`official/extensions_load-testing-extensions.md`).
Mint test tokens with `scripts/make-jwt.ts viewer …` so load tests pass your JWT check. Mitigations:
config service for initial data, caching, PubSub carrying data (not "go fetch"), random jitter.

## Hackathon playbook

1. Day 0: create the extension, enable 2FA, fill Testing Account Allowlist with every teammate/judge ID,
   enable Configuration Service, set allowlists (EBS domain), note client ID/secret/owner ID.
2. Copy templates, get Local Test working on your own channel (panel first — works offline).
3. Build EBS features; run `jwt-selftest.ts` and `ebs-smoke-test.ts`; deploy EBS on HTTPS.
4. Move to **Hosted Test** early (CSP and path issues surface only there); demo from Hosted Test.
5. Pair with an OBS browser-source overlay fed by the same EBS so judges see effects in the video.
6. Don't plan on Released status — review alone takes 8–14 days.
