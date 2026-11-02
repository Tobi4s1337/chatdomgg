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

**1. The Atlas data service (127.0.0.1:5193) runs a stale build.** It is started from `worktrees/atlas/apps/surveyor`
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

**2. After the next deploy of `lane/integrator`**, nothing else is needed for this lane's fixes: they are in the web
build, the gateway (`apps/api`) and the realm (`apps/realm`).

## Only Tobias

- Found the first Atlas edition (`atlas:authorize` with the founder's private key, then `atlas:found`). Until then no
  founded kingdom or signed-in streamer is drawn on the map; the Atlas search offers the front door's kingdoms
  (`/api/public/door`) by name in the meantime.
