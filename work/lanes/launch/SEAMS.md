# launch — seams

The launch lane crosses seams on purpose: it walks chatdom.io as a visitor, fixes small breaks where they are and
hands bigger ones to their owners. Each small fix it makes in another lane's files is listed under `## from launch`
in that lane's `SEAMS.md`; each hand-over is a `needs:` line there and in `progress.txt`.

## The Twitch extension zip

`node scripts/public/extension.mjs --origin https://chatdom.io --version 0.0.1` builds the panel and writes
`deploy/public/dist/chatdom-panel-0.0.1.zip` (gitignored; rebuild it from the commit) with a report beside it.
The staged-data guard in the packer is unchanged: the panel build removes the staged code instead (front-door's
`SEAMS.md`, `## from launch`).

## deploy:

**0. (done by 18:47) chatdom.io answered 502 after the 17:55 redeploy: the gateway had no server bundle.** In the deploy checkout
`worktrees/public-next`, `apps/api/dist/` holds only `api.mjs` (17:55:46): a `pnpm build` (or `pnpm --filter
@chatdom/api build`) ran after `scripts/public/build.mjs` (17:54) and vite emptied `apps/api/dist/`, deleting
`public.mjs`; `node scripts/public/start.mjs` then exits with "Not built yet (apps/api/dist/public.mjs is missing)",
so nothing listens on 5480. Realm (5197), herald (5194), Forge (5195), API (5196) and Atlas data (5193) are up.
Steps, now:

1. `cd /srv/chatdom/public-next/apps/api && pnpm exec vite build --config src/public/vite.config.mjs`
   (writes `dist/public.mjs` beside `api.mjs`; `emptyOutDir` is false in that config).
2. Start the gateway as it is normally started (`node scripts/public/start.mjs` from the checkout root, its usual
   env files, port 5480).
3. Check: `curl -s -o /dev/null -w '%{http_code}' https://chatdom.io/` answers 200.

From this lane's next merge on, `@chatdom/api`'s `build` script writes both bundles, so a later `pnpm build` can no
longer take the gateway down. Until then, after any `pnpm build` in the deploy checkout, rerun
`node scripts/public/build.mjs` (or step 1).

**1. (done: roads answer 200 and the public lookup finds tobi4s_ on the redeploy) The Atlas data service (127.0.0.1:5193) ran a stale build.** It is started from `worktrees/atlas/apps/surveyor`
(branch `lane/atlas`, 8d4d8676, started 2 Nov 14:19) with only `ATLAS_DATA_DIR=shots/atlas-data` (relative to that
worktree). That build has no road routes (`/map-data/v1/roads/<preview>/busiest` answers 404 on every Atlas load and
logs a console error) and no Twitch lookup (`card/login/<login>?lookup=1` answers 404 for any channel the survey has
not mapped). Steps:

1. Copy the data directory out of the lane worktree to a persistent place:
   `mkdir -p /srv/chatdom/atlas-data && cp -a /srv/chatdom/atlas/apps/surveyor/shots/atlas-data/. /srv/chatdom/atlas-data/`
2. Build the service from the deployed checkout of `lane/integrator`:
   `cd <deploy checkout>/apps/surveyor && pnpm exec vite build --logLevel warn`
3. Stop the old `dist/atlas.mjs serve` (cwd `worktrees/atlas/apps/surveyor`) and start the new one in its place:
   `cd <deploy checkout>/apps/surveyor && ATLAS_DATA_DIR=/srv/chatdom/atlas-data node --env-file=/root/.config/chatdom/atlas.env --disable-warning=ExperimentalWarning dist/atlas.mjs serve`
   (`atlas.env` gives it `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` for the public card lookup; it binds 127.0.0.1:5193).
4. Check: `curl -s -o /dev/null -w '%{http_code}' https://chatdom.io/map-data/v1/roads/$(curl -s https://chatdom.io/map-data/v1/preview | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')/busiest`
   answers 200, and the same preview's `card/login/tobi4s_?lookup=1` answers 200.

**3. Real visitor addresses behind Traefik (`PUBLIC_TRUSTED_PROXIES`).** atlas-map's gateway patch
(`gateway-visitor-address.integrator.patch`) is applied on this lane (apps/api/src/public: `proxy.ts`, `config.ts`,
`main.ts` and their tests; 131 public tests pass). Unset, the gateway behaves exactly as before. Traefik is **not** on
docker0: the gateway listens on `172.17.0.1:5480`, but every connection to it comes from `172.18.0.4` (bridge
`br-3c27a4918437`, `172.18.0.0/16`; sampled 2 Nov 19:10). atlas-map's suggested `172.17.0.0/16` would trust nobody.
After the deploy that carries this lane:

1. In the gateway's environment (`ops/bin/public` or its env file): `PUBLIC_TRUSTED_PROXIES=172.18.0.0/16`
   (the bridge, not the container's single address, so a Traefik restart that changes its address keeps working).
2. Restart the gateway, then the Atlas serve loop with `ATLAS_LOOKUPS_PER_CLIENT_MINUTE=6` (one allowance per visitor
   instead of one shared by everyone).
3. Check: `ss -tn state established '( sport = :5480 )'` still shows peers in `172.18.0.0/16`, and two visitors no
   longer share one lookup allowance (the Atlas service's per-client log line names different addresses).

**4. The panel's picture: run the panel painter.** The Chatdom panel is live in Hosted Test on twitch.tv/tobi4s_
and its frame, name, tabs and Walk in work (5080 still `work/evidence/launch/gpu/twitch-panel@1440x2000.png`, 19:25), but
its picture says "The kingdom is out of view" and always will: the picture is painted by
`apps/web/src/panel-painter/runner.mjs` (README beside it), which uploads a WebP to `POST /api/panel/v1/stills`, and
nothing on this host runs it (no runner process; `PANEL_STILL_DIRECTORY` defaults to `/tmp/chatdom-panel-stills`, which
does not exist). In the deploy checkout of `lane/integrator`:

1. A new upload secret, different from `REALM_INGRESS_PANEL_SECRET`: `openssl rand -hex 32`. Put it as
   `PANEL_PAINTER_SECRET=<it>` and `PANEL_STILL_DIRECTORY=/srv/chatdom/panel-stills` (`mkdir -p` it; outside `/tmp`, so
   a reboot keeps the last painting) into the gateway env file that already holds `REALM_INGRESS_PANEL_SECRET`, and
   restart the gateway (`node scripts/public/start.mjs --no-migrate`, as now).
2. Serve the deploy checkout's web build for the painter page on a loopback port of the lane range (5175 was free at
   19:25): `cd apps/web && pnpm exec vite preview --host 127.0.0.1 --port 5175 --strictPort`. It only serves
   `/-/panel-painter`; the gateway never exposes it.
3. A painter env file, mode 600, outside the repo (e.g. `/root/.config/chatdom/panel-painter.env`):
   `PANEL_PAINTER_WEB_ORIGIN=http://127.0.0.1:5175`, `PANEL_PAINTER_API_ORIGIN=http://172.17.0.1:5480` (the gateway's
   listen address), `PANEL_PAINTER_REALM_ORIGIN=http://127.0.0.1:5197`, `PANEL_PAINTER_KINGDOM_IDS=129634568`, the same
   `REALM_INGRESS_PANEL_SECRET` the gateway and realm use, and the new `PANEL_PAINTER_SECRET`.
4. Start it from the checkout root and keep it running:
   `nice node --env-file=/root/.config/chatdom/panel-painter.env apps/web/src/panel-painter/runner.mjs`
   (headless Chrome; the grand land's cold load takes about a minute, then one still a minute while live and at most
   one an hour at rest; it takes the shared capture lock per still).
5. Check: `ls /srv/chatdom/panel-stills` holds a picture for `129634568` within a few minutes, and the panel on
   twitch.tv/tobi4s_ (About) shows Willowmere instead of "The kingdom is out of view".

**2. After the next deploy of `lane/integrator`**, nothing else is needed for this lane's fixes: they are in the web
build, the gateway (`apps/api`) and the realm (`apps/realm`).

## Only Tobias

- Sign in once on chatdom.io with Twitch in the Chrome behind `chatdom-pc` (his RTX 5080), as tobi4s_. That closes
  the sign-in round trip (WALK step 6) and lets the lane still the walk, the HUD, a Forge wish and the tavern on the
  5080 with his session (steps 7, 8, 10). The lane never drives the Twitch login itself.

- Found the first Atlas edition (`atlas:authorize` with the founder's private key, then `atlas:found`). Until then no
  founded kingdom or signed-in streamer is drawn on the map; the Atlas search offers the front door's kingdoms
  (`/api/public/door`) by name in the meantime.
