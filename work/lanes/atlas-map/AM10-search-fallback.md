# AM10 search fallback checkpoint

The Atlas service resolves public channels outside the survey. The browser uses
only the Atlas service; Twitch credentials and OAuth stay server-side. Search
and cards share the same identity, portrait seal, realm wording and pencil point.
There is no source badge. Missing audience averages, first-seen/live history and
raid history remain null rather than becoming zero or invented survey facts.

## Decisions

- Survey exact matches and cards answer locally. On a search miss, Get Users
  resolves a login before Search Channels supplies partial matches. Local prefix
  matches cannot hide an exact outside login: a strict Get Users probe can put
  that exact result first, retaining local rows during outages. Public input
  cannot invoke the adapter's private ID/login selectors.
- Get Channel Information supplies language/category/title; Get Users supplies
  identity/portrait; Get Streams supplies the observed live/viewer/start facts.
  These are public GETs. Cached live facts are dated observations, never current
  live authority. Current-tense labels use the map's live frame. AM11's entry and
  finder must explicitly check fresh liveness rather than use the 24-hour cache.
- Successful answers and identity aliases last 24 hours. Authoritative absence
  lasts one hour. Failed requests are never negative-cached. Cache and in-flight
  tables are bounded; concurrent identical queries share work. A cached result
  can always open its card without spending another IP allowance.
- Each IP gets six uncached lookup admissions, replenishing one per ten seconds;
  the client table retains at most 10,000 entries. Actual outbound Helix attempts
  share a rolling 60-per-minute ceiling and preserve a 200-point reserve, reading
  remaining/reset headers on every reply. 429/5xx impose jittered future backoff;
  they do not trigger retry storms. Missing credentials disable lookup only.
- A lookup passes the survey's gone/gambling gate and current moderation set.
  New facts in a gambling category are omitted. Cached replies pass the gate
  anew. If moderation changes during a network lookup, the service returns a
  bounded retry instead of allowing stale names in nested road/card data.
- `lookup=1` opts into provisional points and nullable facts. Older clients keep
  their original reply shape and survey behavior. `portraits=1` still controls
  the optional picture field. Existing route/gateway allowlists suffice.
- One browser-safe `PencilPlaces` core serves both lookup and live dabs. The
  existing SHA-256 ID prefix chooses a target, then the frozen hex lattice finds
  the nearest dry place in its language/game realm, excluding every permanent
  holding, including withheld ground. Unknown languages use the existing Outer
  Isles resolver. Complete region chunks are required before live dabs are drawn.
- Provisional points reserve no land and are never written to a preview, revision
  or holding ledger. The same ID, world, complete holdings and resolved realm
  produce the same point across restart and changes in other live channels.
  Distinct hashes may share a provisional slot: assigning exclusive temporary
  slots would make their positions depend on who else is live. A language/game
  change can intentionally resolve a different realm and therefore a new point.
- The selected pencil flag follows the camera, stops animating when the embed is
  paused/hidden, and disappears on close. Empty limited searches offer retry by
  Enter or a button. A 500 ms typing pause avoids spending the lookup allowance
  on ordinary prefixes; Enter asks immediately, and typing cancels stale reads
  and warming retries. Missing/disabled direct links offer Twitch instead of an
  endless failed lookup loop.

Twitch behavior was checked against the official [API reference](https://dev.twitch.tv/docs/api/reference/)
and [rate-limit guide](https://dev.twitch.tv/docs/api/guide/#twitch-rate-limits).

## Verification

121 distinct focused tests pass across directory HTTP, lookup/cache/budget,
placement, live paint, still composition and client decoding/holding projection.
These include positive and negative cache expiry, in-flight deduplication,
reserve recovery, 60 actual attempts, 429/5xx cooldown, exact-login prefix
collisions, sixth-search-to-card admission, per-IP spoof rejection, moderation
changes in flight, and deterministic service restart placement. The final
late-moderation/coordinate changes were rechecked with the affected tests.
Scoped TypeScript, ESLint, service build and web production build pass.

Real public lookups resolved `tobi4s_` (129634568, point -11.2 / 364) and
`zliifer` (32369905, point 485.6 / -1664.6), both offline and absent from the
owned survey's public register. No collector import or Twitch write ran. The
owned immutable preview remains `pv-20261101T223528Z-0eafe4c17e44`.
Public HTTP facts, survey-only 404s and matching points after an actual service
restart are in `work/evidence/atlas-map/am10-fallback-http.json`. The world hash
remains `8de8d31fd2d8bdf7bceb6e4c679952a62cccd235e6dc9a3620dcb479c066f88b`.

Desktop/phone capture paths and browser checks are in
`work/evidence/atlas-map/am10-fallback-shots.json`. The shots use actual replies;
controlled limited/disabled replies are exercised separately after capture.
Eight browser checks pass, including 250 ms sequential typing, Enter/button
retry, and disabled direct links. Captures report zero uncaught errors and zero
browser Helix/OAuth requests. A separate real phone-width typing flow issued
exactly one search for `tobi4s_` and opened its correct card; see
`work/evidence/atlas-map/am10-fallback-typing.json`. The phone review caught a
pencil flag above the sheet; its corrected layer now stays behind the controls.
Eight real-data PNGs were opened and judged at 1440×900 and 390×844. They
demonstrate real identity/search/card UI on the dated Canvas2D map, not
WebGL camera flight or GPU performance. The existing still-to-WebGL readiness
gap and hero performance bar remain for the final AM10 pass. The real-GPU lease returned exit 3 because the tunnel was disconnected. No GPU
performance claim is added here. The carved chrome remains the next checkpoint.

## Operator adoption after merge

1. Build the web client and Atlas service from the merged commit using their
   existing build commands. No new dependency, migration, bulk export or import
   is required for lookup. Retain the existing data directory and previews.
2. Restart the Atlas service through the established operator process with
   `node --env-file=$HOME/.config/chatdom/atlas.env` so `TWITCH_CLIENT_ID` and
   `TWITCH_CLIENT_SECRET` are loaded. Never copy credentials into the checkout.
   Without them, survey search/cards continue and unknown channels offer Twitch.
3. For the existing loopback public gateway, set `ATLAS_TRUST_LOOPBACK_PROXY=1`
   only when that proxy overwrites `X-Forwarded-For` with one validated client IP.
   The service otherwise uses the socket address and ignores forwarding claims.
   This is an operator setting; this lane changed no server/proxy configuration.
4. Confirm a survey hit works without lookup, then opt-in search/card reads for
   one outside login. Repeating that result should use its cache and retain the
   point. Confirm the browser makes no Helix/OAuth request. No new gateway routes
   are needed. Existing faces/name adoption steps still apply separately.

Testing used only owned listeners 127.0.0.2:5199 (Atlas) and 127.0.0.2:5175
(web preview), stopped afterwards. The unrelated 127.0.0.1 listeners and live
5193 were untouched. AM10 remains unchecked: carved UI and final GPU/phone work
are still required. Proposed language names still need Tobias's review.
