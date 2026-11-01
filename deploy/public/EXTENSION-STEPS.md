# The Chatdom panel on twitch.tv/tobi4s_: console steps

**Not run.** This lane has not configured the extension in Twitch. Hosted Test and C04's purchase bar remain open.
These are operator instructions, not evidence of successful registration or delivery. Use the
[Hosted Test checklist](../../work/lanes/panel-window/HOSTED-TEST.md) for acceptance.

Build from the repo root with `node scripts/public/extension.mjs --origin https://chatdom.io --version 0.0.1`.
Read `deploy/public/dist/chatdom-panel-0.0.1.txt` alongside its zip: the origins and asset sizes must match the
console. Existing version details may require returning to Local Test; Hosted Test uses uploaded assets on Twitch.
[Twitch lifecycle](https://dev.twitch.tv/docs/extensions/life-cycle/).

1. Open [Extensions Manager](https://dev.twitch.tv/console/extensions) as the owner of tobi4s_, with two-factor
   sign-in. Select Chatdom and its version, or create `0.0.1` with **Panel** and **Mobile**. Fill in the description,
   summary and contact emails. Mention Bits for shared celebrations.
2. In **Capabilities**, enable **Request Identity Link** and **Extension Configuration Service** (Twitch hosted).
   Set required **Streamer Writable Channel Segment Configuration** version to `1`; leave the developer required
   version empty. Enable Bits, leave chat capabilities off, and allow `https://chatdom.io` for panel/config links.
   Configuration holds public preferences, never secrets.
   [Configuration Service](https://dev.twitch.tv/docs/extensions/building/#using-the-configuration-service).
3. In **Monetization**, set **Bits enabled: Yes**, subscription support No, and complete onboarding if requested.
   Keep all products **In Development: Yes**, **Broadcast: Yes**. Each gift's 100/300/500 bands bring the same effect;
   no product release belongs to this rehearsal. [Monetization](https://dev.twitch.tv/docs/extensions/monetization/).
4. In **Asset Hosting**, set Testing Base URI to the operator's HTTPS Local Test server, ending in `/`. Hosted Test
   serves the zip instead. Panel Viewer Path `panel.html`, Panel Height `496`, Mobile Viewer Path `mobile.html`,
   Config Path `config.html`, Live Config Path `live_config.html`. Set **URL Fetching Domains** and **Image Domains**
   to the report's backend origin (`https://chatdom.io` here), including paintings. Leave Media Domains empty.
   Use that origin for panel/config links; add other domains only for a real use identified in the report.
5. In **Access**, allow numeric test account `129634568` (tobi4s_) and every intended tester. Save. Open the panel
   with an allowlisted account and accept Twitch's pre-release disclosure.
6. Transfer the extension's **Client ID**, base64 **Extension Secret**, and OAuth **Client Secret** privately to
   the host/operator as `TWITCH_EXTENSION_CLIENT_ID`, `TWITCH_EXTENSION_SECRET`, `TWITCH_EXTENSION_CLIENT_SECRET`.
   The last two are distinct secrets. Never reuse the Atlas application. Keep the private environment file outside
   the repo with mode `0600`; no values in command arguments, screenshots or logs. The host also needs its existing
   `REALM_INGRESS_PANEL_SECRET`, realm and database. Its operator owns restarting it.
   For Extension PubSub, additionally set `TWITCH_EXTENSION_OWNER_ID` to the extension owner's numeric Twitch user
   ID, verified from the owning account. This public ID is a separate operator field, not a secret. Its role is
   distinct from the target channel; never infer it from that channel, even when the verified IDs happen to match.
   The publisher signs external JWTs with this owner as `user_id`
   and the destination channel separately as `channel_id`. Panel health names `TWITCH_EXTENSION_OWNER_ID` when
   it is missing or invalid. Full switch-on therefore cannot be promised from only the Client ID and Extension
   Secret. [Signing Extension JWTs](https://dev.twitch.tv/docs/extensions/building/#signing-the-jwt).
7. Review the plans below. Once the webhook endpoint is served, the operator can deliberately apply the development
   catalogue and subscription. Inspect again and require `enabled`; pending callback verification proves no delivery.
   The scripts never activate a channel, release products or delete subscriptions.
8. Upload the versioned zip in **Files**, move to **Hosted Test** in Status, then **View on Twitch and Install**.
   Install on tobi4s_, open Configure and save broadcaster preferences version `1`, then activate **Panel 1**.
   Complete required configuration before activation if Twitch asks. Never forge a connected kingdom in settings.
9. Check the channel in two allowlisted accounts and the Twitch mobile app. Follow the linked checklist through
   read, shared identity, Take your place, light, settings, Hide/resume and the first test-mode gift. Credentials
   alone never make an absent world effect ready; its gifts stay closed.

The founding OAuth entry is **not wired yet**. No public Found your kingdom URL is documented or invented here.
Main/Herald must supply an entry requesting exactly Tech §7.2's six Tier 1 scopes:
`channel:bot moderator:read:chatters moderator:read:followers moderator:read:blocked_terms moderator:read:shield_mode moderation:read`.
Installing the extension grants none of these scopes. Keep connection acceptance open until the actual entry and
persisted channel grant exist.

## Operator commands

Node 22 loads the TypeScript catalogue using `--experimental-strip-types`. Run from the repo root. Both defaults
are **offline dry runs**: no HTTP calls and no credentials needed.

```sh
node --experimental-strip-types apps/panel/scripts/register-products.mjs
node apps/panel/scripts/subscribe-bits.mjs --origin https://chatdom.io
```

`--inspect` authenticates and reads Twitch without registrations. The product/webhook tools need only the three
extension credential values above; they use OAuth and do not need `TWITCH_EXTENSION_OWNER_ID`. The host's PubSub
publisher does require the owner ID. Use a private environment file; `/run/secrets/chatdom-extension.env` below
is an operator convention, not a file shipped by this lane.

```sh
node --env-file=/run/secrets/chatdom-extension.env --experimental-strip-types apps/panel/scripts/register-products.mjs --inspect
node --env-file=/run/secrets/chatdom-extension.env apps/panel/scripts/subscribe-bits.mjs --origin https://chatdom.io --inspect
```

After reviewing those plans, replace `--inspect` with `--apply` for the intended mutation. **This lane has not run
apply against Twitch.** The catalogue script compares all 60 desired entries including disabled/expired products,
skips unchanged entries, and blocks the entire write if any matching SKU is released or retired. There is no
release flag. Partial provider failure can leave some development entries registered; inspect and rerun to finish.
[Product API](https://dev.twitch.tv/docs/api/reference/#get-extension-bits-products).

The webhook script reads every subscription page and retains an enabled or verification-pending match. Wrong
callback/transport or failed status needs operator repair; it never deletes or duplicates the target. Default:
`https://chatdom.io/api/panel/v1/bits-webhook`; `--callback` accepts another HTTPS port-443 endpoint. It uses
`extension.bits_transaction.create` version `1`, condition `extension_client_id`, transport `webhook`. Its secret
is private hex `HMAC-SHA256(base64Decode(TWITCH_EXTENSION_SECRET), "chatdom:extension-bits:v1")`, matching the API
default. Leave `PANEL_BITS_EVENTSUB_SECRET` unset so an old override cannot disagree. Extension Secret rotation
requires reviewing the existing webhook key; matching subscription metadata cannot prove its secret.
[Bits event](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#extensionbits_transactioncreate).

App tokens stay in memory, validate at startup and before the next call after an hour, and get one remint/retry
after 401. These are one-shot tools, not background sessions. Errors withhold provider bodies and exception details.
[Token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/).

Check `/healthz` for host availability and `/api/panel/v1/health` for panel setup. Record missing names, never
values. A ready response proves configuration, not payment or mounted effects. For an empty panel check allowlist
and activation; for Out of reach check matching origins, URL/image allowlists, realm ingress and keys against the
zip report. A narrow desktop capture does not replace testing on a real phone in the Twitch app.
