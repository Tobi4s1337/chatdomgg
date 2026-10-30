# Extension Helper reference (`window.Twitch.ext`)

Curated from `official/extensions_reference.md` (snapshot 2026-10-26) with runtime notes. Types for all
of it: `assets/templates/twitch-ext.d.ts`.

## Contents
- [Loading the helper](#loading-the-helper)
- [Namespaces at a glance](#namespaces-at-a-glance)
- [Core: version, environment](#core)
- [onAuthorized](#onauthorized)
- [onContext](#oncontext)
- [onError, onHighlightChanged, onVisibilityChanged, onPositionChanged](#other-callbacks)
- [PubSub: listen, unlisten, send](#pubsub-listen-unlisten-send)
- [actions.*](#actions)
- [configuration.*](#configuration)
- [features.*](#features)
- [bits.*](#bits)
- [viewer.*](#viewer)
- [Client query parameters](#client-query-parameters)
- [JWT schema](#jwt-schema)
- [Helix JWT (frontend Twitch API calls)](#helix-jwt-frontend-twitch-api-calls)
- [Undocumented / legacy members](#undocumented--legacy-members)
- [Init order recipe](#init-order-recipe)

## Loading the helper

```html
<head>
  <script src="https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js"></script>  <!-- FIRST script -->
  <script type="module" src="./src/panel.ts"></script>
</head>
```

- Required in **every** HTML file of the extension (Building guide), and policy 2.9 says it must be the
  **first** script. Load it from Twitch's CDN — `https://extension-files.twitch.tv` is the only
  third-party script origin besides Google Analytics in `script-src`.
- It is a classic (non-module) script, so it executes before deferred `type="module"` bundles —
  `window.Twitch.ext` is available synchronously in your modules.
- Outside a Twitch iframe (opening `panel.html` directly) the helper loads but `onAuthorized` never
  fires. Test inside Twitch (Local Test).

## Namespaces at a glance

| Namespace | Purpose |
|---|---|
| `Twitch.ext` | auth, context, errors, visibility/highlight, PubSub (`listen`/`unlisten`/`send`), `version`, `environment` |
| `Twitch.ext.actions` | Twitch-controlled UI: follow prompt, minimize, identity-share prompt |
| `Twitch.ext.configuration` | Configuration Service segments + broadcaster write |
| `Twitch.ext.features` | Feature flags: Bits, chat, subscription status |
| `Twitch.ext.bits` | Bits in Extensions: products, useBits, transaction callbacks |
| `Twitch.ext.viewer` | Convenience info about the viewer (unvalidated) |

## Core

| Member | Type | Notes |
|---|---|---|
| `Twitch.ext.version` | string | Helper semver, e.g. `"1.1.1"` |
| `Twitch.ext.environment` | string | Always `"production"` for external developers |

## onAuthorized

`Twitch.ext.onAuthorized(cb: (auth) => void)` — fired on load and **each time the JWT is refreshed**.

| Field | Type | Meaning |
|---|---|---|
| `channelId` | string | Channel ID of the page the extension is embedded on |
| `clientId` | string | Extension client ID |
| `token` | JWT | Send to **your EBS** (`Authorization: Bearer <token>`; Twitch's sample uses an `x-extension-jwt` header — any header works, it's your EBS) |
| `helixToken` | JWT | For Twitch API calls from the frontend: `Authorization: Extension <helixToken>` (see below) |
| `userId` | string | **Opaque** user ID (`U…` logged in, `A…` anonymous) — not the Twitch user ID |

Rules:
- Do bootstrap work (first EBS call, feature-flag reads, `bits.getProducts()`) inside/after the first
  callback. Register **once** and keep the latest values; don't rebuild the app on refresh.
- After `actions.requestIdShare()` succeeds, the callback fires again and the JWT now carries
  `user_id` (and `viewer.id` is set).

## onContext

`Twitch.ext.onContext(cb: (context, changedKeys: string[]) => void)` — fired when context changes. Treat
each call as a partial update and merge.

| Property | Type | Notes |
|---|---|---|
| `arePlayerControlsVisible` | boolean | Controls visible (mouseover). **Not sent on mobile** |
| `bitrate` | number | Bitrate of the broadcast |
| `bufferSize` | number | Buffer size |
| `displayResolution` | string | Player display size |
| `game` | string | Category being streamed |
| `hlsLatencyBroadcaster` | number | Seconds of latency broadcaster → viewer (useful to sync PubSub-driven UI with video) |
| `hostingInfo` | `{hostedChannelId, hostingChannelId}` \| undefined | Host mode info (legacy feature) |
| `isFullScreen` | boolean | **Not sent on mobile** |
| `isMuted` | boolean | |
| `isPaused` | boolean | |
| `isTheatreMode` | boolean | **Not sent on mobile** |
| `language` | string | Broadcast language, e.g. `"en"` |
| `mode` | `viewer` \| `dashboard` \| `config` | viewer = channel page; dashboard = live dashboard (live_config); config = extension config |
| `playbackMode` | `video` \| `audio` \| `remote` \| `chat-only` | audio & chat-only are mobile-only; stats may be wrong for remote/chat-only |
| `theme` | `light` \| `dark` | Twitch UI theme — switch your CSS on it |
| `videoResolution` | string | Broadcast resolution |
| `volume` | number | 0..1 |

**Latency sync tip:** PubSub messages arrive ahead of the video. If your UI reacts to something the
viewer should *see* on stream, delay rendering by `hlsLatencyBroadcaster` seconds.

## Other callbacks

| Function | Callback args | Notes |
|---|---|---|
| `onError(cb)` | `(error)` | Errors generated by the helper |
| `onHighlightChanged(cb)` | `(isHighlighted: boolean)` | Viewer hovers the extension's menu icon / open menu in the player. **video_overlay & component only** |
| `onVisibilityChanged(cb)` | `(isVisible: boolean, context?)` | Extension hidden/re-shown (viewer action, pause, ad). `context` only when visible. While hidden: no `onContext`, do minimal work |
| `onPositionChanged(cb)` | — | **Removed from the docs on 2026-06-08 as "unused"**. Don't build on it |

## PubSub: listen, unlisten, send

```ts
Twitch.ext.listen(target, (target: string, contentType: string, message: string) => void)
Twitch.ext.unlisten(target, sameCallbackObject)
Twitch.ext.send(target, contentType, message: object | string)   // broadcaster JWT only
```

| Target | Who receives | Who can publish |
|---|---|---|
| `broadcast` | All instances of **this extension on this channel** | EBS (Helix, `pubsub_perms.send:["broadcast"]`), broadcaster frontend via `send` |
| `global` | All instances on **all channels** | EBS only (Helix, `channel_id:"all"`, `send:["global"]`, `is_global_broadcast:true`). Broadcasters cannot send global |
| `whisper-<opaqueUserId>` | One viewer — each frontend may only listen to its **own** id from `onAuthorized` (`auth.userId`); others are blocked | EBS (Helix target `whisper-<id>`), broadcaster frontend |
| other strings | "Non-Extensions PubSub topics also are supported" (legacy; legacy PubSub is shut down — don't rely on it) | — |

- `message` in the listener is **always a string** (`JSON.parse` it); `send` serialises objects to JSON.
- `unlisten` needs the **same function object** you passed to `listen`.
- Limits (Building guide): **1 message/second/channel, 5 KB per message**. Helix reference: 100
  messages/minute per (extension client ID, broadcaster ID). Community testing reports a token bucket
  (~100 points, refills ~1/s); global has its own pool and whispers count against the channel's pool.
- Typical use: EBS pushes state/deltas; viewers fetch the initial state from the EBS (or config) on load
  because PubSub has no history.
- PubSub arrives at all viewers at once — if thousands of viewers react to a message by calling your
  EBS simultaneously you DDoS yourself. Put the data **in** the message, or add random jitter.

## actions

| Function | Notes |
|---|---|
| `actions.followChannel(channelName)` | Twitch-controlled follow dialog for a channel **login**; result via `onFollow` |
| `actions.onFollow(cb: (didFollow: boolean, channelName: string) => void)` | Result of a `followChannel` prompt |
| `actions.minimize()` | Minimize a video_component or video_overlay extension |
| `actions.requestIdShare()` | Ask the viewer to share their identity. On success `onAuthorized` fires with a token containing `user_id`. No effect if identity linking isn't enabled (Capabilities → Request Identity Link) or on the viewer's own channel. Ask only when needed and explain why (design guidance) |

## configuration

| Member | Notes |
|---|---|
| `configuration.broadcaster` | `{version, content}` \| undefined — broadcaster segment for this channel |
| `configuration.developer` | `{version, content}` \| undefined — developer segment for this channel |
| `configuration.global` | `{version, content}` \| undefined — global segment (all channels) |
| `configuration.onChanged(cb: () => void)` | Called when configuration is received (on load). Read the three properties **inside** it — they are unset before the first call |
| `configuration.set(segment, version, content)` | Frontend write. `segment` must be `"broadcaster"`; uses the broadcaster's JWT, so only works in views the broadcaster is using (config, live_config, or their own channel). `content` is a string (max 5 KB) |

More (versions, required config, EBS writes): `config-service.md`.

## features

| Member | Notes |
|---|---|
| `features.isBitsEnabled` | `true` = Bits in Extensions will work on this channel. False if Bits not enabled in the Monetization tab, broadcaster not eligible, or broadcaster disabled it. **Mandatory check** for monetized extensions |
| `features.isChatEnabled` | `true` = Send Extension Chat Message allowed (Chat Capabilities enabled and not disabled by broadcaster) |
| `features.isSubscriptionStatusAvailable` | `true` = subscription status of identity-linked viewers available (helper + Twitch API); needs "Subscription Status" enabled and broadcaster permission |
| `features.onChanged(cb: (changed: string[]) => void)` | Flags arrive asynchronously **after the first `onAuthorized`**; re-check the flags you care about |

## bits

| Function | Notes |
|---|---|
| `bits.getProducts(): Promise<Product[]>` | Products for your extension. Released version → only products not `inDevelopment` (field omitted). Unreleased → all products, with `inDevelopment`. Rejects where Bits actions are unsupported (legacy rig, mobile app < 6.4) |
| `bits.useBits(sku)` | Opens Twitch's confirm dialog for that SKU; blocks interaction with the extension until closed |
| `bits.onTransactionComplete(cb: (tx) => void)` | Completed transaction. Sent to the initiator only, or to every instance on the channel if the product has **Broadcast** on |
| `bits.onTransactionCancelled(cb)` | Cancel button, click outside, or useBits error dismissed |
| `bits.setUseLoopback(bool)` | Don't call live services; loops back to the completion handler after a fixed delay (UI testing) |
| `bits.showBitsBalance()` | Show the viewer's balance for 1.5 s (call on product hover; repeated calls reset the timer). Ignored on mobile |

`Product`: `{ sku, displayName, cost: { amount: string, type: "bits" }, inDevelopment? }`.

Transaction object (docs table is garbled — runtime shape):

| Field | Notes |
|---|---|
| `displayName` | Display name of the user who used Bits |
| `initiator` | `"current_user"` on the initiator's machine, `"other"` elsewhere (lowercase at runtime) |
| `product` | The Product object (docs claim "string") |
| `domainID` | `"twitch.ext." + extension ID` |
| `transactionID` | Transaction ID (loopback objects use `transactionId`) |
| `userId` | Twitch user ID of the user who used Bits (identity is shared by confirming) |
| `transactionReceipt` | JWT (HS256, extension secret) with `topic: "bits_transaction_receipt"`, `exp`, `data{transactionId, time, userId, product{…}}` — **verify on the EBS**; absent in loopback/test |

Full flow and policies: `bits-and-monetization.md`.

## viewer

Convenience copy of JWT info, **passed without validation** — use for UI only.

| Member | Type | Notes |
|---|---|---|
| `viewer.opaqueId` | string | Opaque ID |
| `viewer.id` | string \| null | Twitch user ID if identity shared, else null |
| `viewer.role` | string | JWT role |
| `viewer.isLinked` | boolean | Identity shared? |
| `viewer.sessionToken` | string | Same as `auth.token` |
| `viewer.helixToken` | string | Same as `auth.helixToken` |
| `viewer.subscriptionStatus` | `{ tier: "1000"\|"2000"\|"3000" }` \| null | null if not subscribed, not linked, or no subscription capability |
| `viewer.onChanged(cb)` | — | Viewer status changed (e.g., subscribed) |

## Client query parameters

Appended to the iframe URL; stable for the frame's lifetime (`new URLSearchParams(location.search)`).

| Name | Values |
|---|---|
| `anchor` | `component`, `panel`, `video_overlay` (only when `platform=web`) |
| `language` | user's language, e.g. `en` |
| `locale` | e.g. `en-US` |
| `mode` | `config`, `dashboard`, `viewer` |
| `platform` | `mobile`, `web` |
| `popout` | `true` / `false` — panel or live_config popped out into its own window (layout can grow) |
| `state` | `testing`, `hosted_test`, `approved`, `released`, `ready_for_review`, `in_review`, `pending_action`, `uploading` |

Using one HTML file for several anchors ("dynamic anchors") is fine — branch on `anchor`/`platform`.

## JWT schema

| Claim | Type | Notes |
|---|---|---|
| `channel_id` | string | Channel the frontend is served on |
| `exp` | NumericDate | Expiry (seconds). Helper refreshes before expiry |
| `is_unlinked` | boolean | `true` if the user previously shared identity and revoked it (docs' example shows the string `"false"` — accept both) |
| `opaque_user_id` | string | `U…` stable per Twitch account across sessions and channels; `A…` anonymous/transient. Broadcaster tokens use `U` + their user ID. EBS tokens leave it out |
| `pubsub_perms` | `{listen?: string[], send?: string[]}` | Topics the holder may listen/publish to; `*` = all for this extension/channel; absent = none |
| `role` | `broadcaster` \| `moderator` \| `viewer` \| `external` | `moderator` only for identity-linked users; `external` = EBS-signed |
| `user_id` | string | Twitch user ID — only if the user shared identity; can be revoked at any time (then a new opaque ID is issued) |

Example (Twitch-issued, broadcaster):

```json
{ "exp": 1484242525, "opaque_user_id": "UG12X345T6J78", "channel_id": "test_channel", "role": "broadcaster",
  "is_unlinked": "false", "pubsub_perms": { "listen": ["broadcast", "whisper-UG12X345T6J78"], "send": ["broadcast", "whisper-*"] } }
```

## Helix JWT (frontend Twitch API calls)

```ts
const res = await fetch('https://api.twitch.tv/helix/users?id=' + viewerId, {
  headers: { 'Client-Id': auth.clientId, Authorization: `Extension ${auth.helixToken}` },  // "Extension", not "Bearer"
});
```

- Works for endpoints that accept user access tokens and need **no scopes** (e.g. Get Users, Get
  Streams); scoped or app-only endpoints are rejected.
- Rate limit **30 requests/minute per extension viewer** across all endpoints (429 when exceeded); 401 =
  invalid/expired JWT (use the latest `helixToken`).
- `https://api.twitch.tv` is already in `connect-src`; no allowlisting needed.

## Undocumented / legacy members

- `Twitch.ext.rig.log()` — Developer Rig (decommissioned Jan 2023). Ignore.
- `Twitch.ext.purchases` / commerce APIs — old, not in the current reference. Don't use.
- `onPositionChanged` — see above.
- `@types/twitch-ext` (DefinitelyTyped, v1.24.x) still declares `onPositionChanged` and `rig`; the
  template d.ts marks them `@deprecated`.

## Init order recipe

```ts
const ext = window.Twitch.ext;                       // 1. helper loaded first in <head>
ext.onContext(applyTheme);                           // 2. theme ASAP to avoid a light flash in dark mode
ext.configuration.onChanged(readConfig);             // 3. config (no network to your EBS)
ext.listen('broadcast', onPubSub);                   // 4. live updates
ext.onAuthorized(async (auth) => {                   // 5. token → initial EBS state, flags, products
  saveToken(auth);
  if (!started) { started = true; await loadInitialState(); updateFeatureUi(); }
});
ext.features.onChanged(updateFeatureUi);
```
