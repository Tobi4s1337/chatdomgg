# PW13: switched on the moment the extension exists (2 November 2026)

## What works when the values are set

- **The values.** `TWITCH_EXTENSION_CLIENT_ID` and `TWITCH_EXTENSION_SECRET` switch on token verification, CORS for the
  extension's own origin, reading, join, light, presence, privacy and the config pages. `TWITCH_EXTENSION_OWNER_ID`
  adds Extension PubSub and Configuration Service publication, because Twitch's external JWT must name the owner.
  `TWITCH_EXTENSION_CLIENT_SECRET` adds gift reconciliation and the product and webhook tools. Every value is an
  environment value, with no code change. `/api/panel/v1/health` names each missing value in a plain list, never a
  value and never a stack trace. The decision is in `PW13-CONTRACT.md`.
- **PubSub.** A bounded `{version:1,type:'panel.refresh'}` broadcast per channel, at most one a second. Open panels
  re-read the verified API. The five-second poll stays as the fallback.
- **The Configuration Service.** The realm owns the preferences: tabs, about eight gifts and one band each. Twitch holds
  a published copy, written by a durable server outbox and verified by GET. Config shows Saved only after verification,
  and while waiting it shows "Saved in the kingdom; waiting for Twitch to confirm." with "Check Twitch again". Live Config's
  Hide pauses panel gifts at the realm writer, and paid gifts that are still pending wait until Resume.
- **The tools.** `apps/panel/scripts/register-products.mjs` registers the 60 SKUs, and `subscribe-bits.mjs` subscribes the
  `extension.bits_transaction.create` webhook. Both plan offline, `--inspect`, and write only with `--apply`.
  `node scripts/public/extension.mjs` builds the zip. `deploy/public/EXTENSION-STEPS.md` covers Bits, the hosted
  Configuration Service, Request Identity Link, the image domain allowlist for the paintings, and mobile.

## The switch-on rehearsal

`apps/api/src/panel/gifts/browser.integration.test.ts`, second case. It runs on a disposable `panel_window_test_*`
schema with the real realm code on its own port. It uses a generated client ID, secret, owner and OAuth secret, and
substitutes only Twitch's two remote hosts at the fetch boundary:

1. It composes the API exactly as the gateway does: `readPublicConfig` from the environment, then `createPanelHttp`
   with no supplied services.
2. With no extension values set, health answers 503 and names `TWITCH_EXTENSION_CLIENT_ID` and `TWITCH_EXTENSION_SECRET`
   (and the owner ID under broadcast and configuration), with no values and no stack. The kingdom route refuses with 503.
3. After the values are set, with no code change, health reports ready, with broadcast, configuration and gifts all
   configured. CORS answers the extension's origin and refuses another.
4. Two real panels in Chrome through the Helper mock, with real HS256 tokens. The test reads the kingdom, then runs
   **Take your place**. Light is confirmed by the realm (an installed deed and a committed `panel` observation).
   It then saves the broadcaster's tabs and bands through Config. Saved appears only after Twitch's GET is verified,
   and the published content equals the realm reading. Next it runs Hide and Resume in Live Config. Finally it makes a
   gift with a signed receipt. Its moment reaches the second panel over PubSub in 114 ms locally, while that panel's
   polling clock is paused. Database counts rise by exactly one, and no token, receipt, secret or ID reaches the DOM,
   storage, a URL or a log.

The gift's world effect is supplied by an explicit, test-only effect authority. That is not a production effect,
and it is not Hosted Test.

```sh
REALM_DATABASE_TESTS=1 PANEL_BROWSER_TESTS=1 node --env-file=/tmp/panel-window-realm.env \
  node_modules/vitest/vitest.mjs run --no-fsModuleCache apps/api/src/panel/gifts/browser.integration.test.ts
```

Result: 2 of 2 passed, twice. The second run came after the port probe learned to skip ports held on the wildcard
address: the first run had bound 127.0.0.1:5175 beside someone else's wildcard listener.

## Evidence

- Real-GPU stills (RTX 5080, one lease) in `work/evidence/panel-window/PW13/`: `config`, `config-gift-bands`,
  `config-pending` and `live-config` at 318×496 and 390×844. I looked at all of them. They show one wood and parchment
  object, with no horizontal overflow and no target under 44 px. The capture's backend answers are layout fixtures; the
  rehearsal above proves behaviour. Word counts of the first view at 318×496, counted from the stills: Config 41, pending 41, Live Config 46. Config is
  a dashboard page and scrolls as a document. On the phone, Live Config leaves its lower half as bare wood, which I
  judged acceptable for a dashboard page.
- The zip: `node scripts/public/extension.mjs` passes every hosted-asset check: 17 files, 495 KB, and a first load
  of 914 KB for panel and mobile and 631 KB for the config pages. There are no fixtures, simulation strings or three.js.
  The allowlists are URL Fetching, Image Domains and Panel URLs, all `https://chatdom.io`.
- Mobile (C06): the same three tabs, thumb-first, from PW10 to PW12, with real-GPU stills at 390×844 in the PW10–PW12
  evidence folders, under 1 MB.

## Open, outside this lane or with Tobias

- Hosted Test has **not run** this round. `HOSTED-TEST.md` is Tobias's 15-step checklist, ending with the first real
  test-mode gift. C04's purchase bar stays open until then.
- The "Found your kingdom" link waits on a real founding OAuth entry, and Herald's grants patch narrows the first
  connection to the six Tier 1 scopes (`PW13-NEEDS.md`).
- Production gift effects: `PW12-NEEDS.md`.
