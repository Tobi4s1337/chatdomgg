# Configuration Service

Sources: `official/extensions_building.md` (Using the Configuration Service, Required Configurations),
`extensions_life-cycle.md` (Capabilities), `extensions_reference.md` (Helper: Configuration), Helix
Get/Set Extension Configuration Segment + Set Extension Required Configuration, Extension 101 tutorial.

## What it is

A Twitch-hosted key-value store per extension: three **segments**, each a single string (`content`)
plus a `version` string, **delivered to the frontend at load time** via the helper. You avoid an EBS
round trip on every page load (huge for scaling) and can build EBS-less extensions.

Enable it: Extensions manager → **Capabilities** → "Select how you will configure your Extension" →
**Extension Configuration Service** (default). Other choices: "No configuration", "Custom/My Own
Service" (your EBS stores config; enables Required Per Channel Configuration via Helix).

## Segments

| Segment | Delivered to | Set by | Helper write? | Helix write? |
|---|---|---|---|---|
| `broadcaster` | Views on that channel | Developer (EBS) **and** broadcaster | Yes: `configuration.set('broadcaster', version, content)` with a broadcaster token | Yes (`broadcaster_id` required) |
| `developer` | Views on that channel | Developer only | No | Yes (`broadcaster_id` required) |
| `global` | Every view, all channels | Developer only | No | Yes (no `broadcaster_id`) |

- **Size: 5 KB per segment.** Content is a string — JSON-encode objects yourself.
- **Public!** "All data is sent to extension views by anonymous users" — never store secrets, API
  keys or private data in any segment (third-party user IDs are OK per the docs, tokens are not).
- Read in the frontend only inside `Twitch.ext.configuration.onChanged(cb)` (fires on load once config
  arrives; segments are `undefined` before that or if never set).

```ts
Twitch.ext.configuration.onChanged(() => {
  const b = Twitch.ext.configuration.broadcaster;   // { version, content } | undefined
  const cfg = b ? safeParse(b.content) : DEFAULTS;   // validate — content is untrusted input
});
```

## Writing

**Frontend (broadcaster only)** — typically from `config.html` / `live_config.html`:

```ts
Twitch.ext.configuration.set('broadcaster', '1', JSON.stringify({ question, options }));
```
It is fire-and-forget (returns void); show a "Saved" state yourself (submission best practice).
Viewer tokens cannot write.

**EBS (any segment)** — `PUT https://api.twitch.tv/helix/extensions/configurations` with an
EBS-signed JWT (`role: external`, owner `user_id`, `exp`) + `Client-Id`:

```json
{ "extension_id": "<client id>", "segment": "developer", "broadcaster_id": "274637212",
  "version": "1", "content": "{\"tier\":\"pro\"}" }
```
→ 204. Omit `version` to update the latest definition. Rate limit **20 updates/min**.
Template: `setConfigurationSegment(cfg, 'developer', content, { broadcasterId, version })`.

**Read on the EBS** — `GET /helix/extensions/configurations?extension_id=…&segment=broadcaster&segment=developer&broadcaster_id=…`
(repeat `segment`; omit `broadcaster_id` for global only). Rate limit **20 GETs per segment per minute** —
cache it. Template: `getConfigurationSegments(cfg, ['broadcaster','developer'], broadcasterId)`.

**Important:** "Extensions that are active on a channel do not receive the updated configuration"
when you set it via Helix. If open viewers must see the change now, also send a PubSub message
(either containing the new config, or telling clients to refetch from your EBS). Helper writes from the
broadcaster's config page are picked up on the next load the same way — push via `Twitch.ext.send`
(broadcaster token) if live views must update immediately.

## Versions

`version` is a free-form string you attach to each segment write (e.g. `"1"`, `"0.0.1"`). Use it for
schema migrations: bump it when the content format changes and handle old versions when reading.

## Required configuration (block activation until configured)

Two variants:

1. **Configuration Service + required versions** — on the Capabilities tab, fill "Developer Writable
   Channel Segment Configuration" / "Streamer Writable Channel Segment Configuration" with the required
   version strings. When the channel loads, Twitch compares them with the versions stored in the
   segments; **if they don't match, the extension won't load / can't be activated** until the
   broadcaster (or your EBS) writes that version. So: required broadcaster version `"1"` + your config
   page calls `set('broadcaster', '1', …)`.
2. **Custom/My Own Service + Required Per Channel Configuration** — enter any string (e.g. `"RCS"` or
   `"v2-setup"`) in the console. When your EBS decides the channel is configured, call
   `PUT /helix/extensions/required_configuration?broadcaster_id=…` with
   `{ extension_id, extension_version, required_configuration: "<same string>" }` (EBS JWT with owner
   `user_id`). Changing the string in a new version forces reconfiguration.

Without required configuration, your code must work with defaults until configured — strongly
recommended (Monetization Strategies: streamers often activate and forget to configure; default
configurations keep the extension usable and monetizable from activation).

## Patterns

- **Broadcaster settings** → broadcaster segment from config view; viewers read it at load.
- **Per-channel entitlements you control** (plan tier, feature flags) → developer segment via EBS
  (broadcasters can't tamper with it).
- **Global announcements / kill switch / content packs** → global segment + a `global` PubSub ping.
- **Large or private data** → your EBS/DB; store only a pointer (e.g. a channel key) in config.
- Configuration UX (submission best practices): keep setup in the config page, tabs for steps,
  placeholder examples, success/failure indicator, tell the broadcaster if live config is also needed.
