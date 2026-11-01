# chatdom.io: the public host

One process on one port serves everything a visitor touches: the front door, the web app (walking, the showcase,
the Atlas, the stream view), Twitch sign-in, the Twitch panel's backend, and the realm with its realtime socket.
The realm runs as a supervised child on loopback and is restarted if it stops. Homes, sessions and kingdoms live
in Postgres and the founded directory, so a restart loses nothing; walkers reconnect on their own.

## Build

```sh
pnpm install --frozen-lockfile
node scripts/public/build.mjs
```

This builds the realm, the web app with its front door, and the server bundle. It precompresses the static files
and writes the Twitch panel zip to `deploy/public/dist/chatdom-panel-<version>.zip`, checked against Twitch's
hosted-asset rules. See [EXTENSION-STEPS.md](EXTENSION-STEPS.md) for the zip.

## Start

```sh
node scripts/public/start.mjs
```

- **First:** it applies the realm's additive migrations to `REALM_DATABASE_SCHEMA`. They never drop or rewrite
  anything. Pass `--no-migrate` to skip them; they are also skipped when `PUBLIC_REALM_TARGET` names a realm the
  host already runs.
- **Port:** `5175` (HTTP on `127.0.0.1`). Put TLS in front of it for `https://chatdom.io`, pass `Host` through and
  allow WebSocket upgrades on `/live-realm-data/`. The server sends HSTS itself.
- **Health:** `GET /healthz` answers `200 {"alive":true,"database":true,"realm":true,...}`, or `503` while the
  database or the realm is down.
- **Stopping:** SIGTERM drains open requests and stops the realm cleanly within 25 s.
- **Internal port:** the supervised realm listens on `REALM_PORT` (5173). Only 5175 may be reachable from
  outside, so keep 5173 closed at the firewall.

## Twitch redirect URI

Add this to the Twitch application whose `TWITCH_CLIENT_ID` the host uses (Twitch console → Applications →
Manage → OAuth Redirect URLs):

```
https://chatdom.io/api/realm/auth/callback
```

## Environment

Set these in the environment, or in `deploy/public/.env` (ignored by git), or in the files that
`PUBLIC_ENV_FILE` lists, separated by commas. Values already in the environment win over the files. The values
never appear in logs or errors.

**Required**

| Name | What it is |
|---|---|
| `DATABASE_URL` | Postgres for the realm, sign-in and the panel |
| `REALM_DATABASE_SCHEMA` | The live schema, `realm` |
| `REALM_PUBLIC_ORIGIN` | `https://chatdom.io`. It sets the redirect URI and makes cookies `Secure` and `__Host-` |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | The Twitch application used for sign-in and public user lookups |
| `PUBLIC_KINGDOMS` | The kingdoms the front door offers, as `<channel id>:<login>`, comma separated: `129634568:tobi4s_` |
| `REALM_ENTRY_KINGDOM_ID`, `REALM_ENTRY_KINGDOM_NAME` | The kingdom the realm names on its gate: `129634568`, `Willowmere` |
| `REALM_FOUNDED_DIRECTORY` | A persistent directory, outside the repo, holding each kingdom's approved scene |
| `REALM_EVIDENCE_KEY` | Hex key that signs home tenure (the same key the realm has always used; changing it voids homes) |

**For the Twitch panel** (see [EXTENSION-STEPS.md](EXTENSION-STEPS.md))

| Name | What it is |
|---|---|
| `TWITCH_EXTENSION_CLIENT_ID` | The extension's Client ID |
| `TWITCH_EXTENSION_SECRET` | The extension's secret (base64, as shown in the console). Set both or neither |

**Optional**

| Name | Default | What it is |
|---|---|---|
| `PUBLIC_PORT` | `5175` | The one public port |
| `PUBLIC_HOST` | `127.0.0.1` | The interface it binds to |
| `REALM_PORT` | `5173` | The supervised realm's internal port (5170–5199) |
| `PUBLIC_REALM_TARGET` | unset | `http://host:port` of a realm already running on this host. Set it and no realm is started |
| `REALM_INGRESS_HERALD_SECRET` | unset | Lets the herald on this host deliver chat to the realm (point the herald's `HERALD_REALM_URL` at the realm's port) |
| `PUBLIC_HERALD_TARGET` | unset | `http://host:port` of the herald, served as `/presence-data` (who is watching, live) |
| `PUBLIC_MAP_TARGET` | unset | `http://host:port` of the Atlas data, served as `/map-data` |
| `PUBLIC_FORGE_TARGET` | unset | `http://host:port` of the Forge service, served as `/forge-data` |
| `PUBLIC_PANEL_EXTRA_ORIGINS` | unset | More origins allowed to call the panel backend (Local Test on `https://localhost:8080`) |
| `PUBLIC_DATABASE_POOL` | `20` | Postgres connections held by the public server |
| `REALM_AUTH_MODE` | `live` | `simulated` runs sign-in with simulated people (shown as SIMULATED on every page) |
| `PUBLIC_WEB_ROOT` | `apps/web/dist` | The built web app |

## One realm per schema

The realm is the only writer for its kingdoms: it holds a lease in the database. Run one realm per schema. If this
host already runs the live realm, set `PUBLIC_REALM_TARGET` to it instead of starting a second one.

## What is public

The front door at `/` (with the showcase one click away), the walk at `/?walk=1&kingdom=<id>` (sign-in first),
the stream view at `/stream`, `/showcase`, `/map`, `/kingdom/<id>`, sign-in under `/api/realm/`, the realm's
`founded`, `entry` and `watch` reads and its socket under `/live-realm-data/`, and the panel backend under
`/api/panel/v1/`. Nothing else is served: no internal or ingress routes, no bench or reference pages, no source
maps. Unknown paths get the front door with status 404.
