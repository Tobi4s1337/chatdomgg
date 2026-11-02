# The studio

The studio stages Chatdom footage. It is a private tool: a pixel-measured replica of the twitch.tv/tobi4s_ channel
page, with the real stream view in the player and the real Chatdom panel under it. It also holds a seeded chat
crowd, typed shot scripts, a virtual clock, a frame-stepped recorder, set pieces built from the product's own
modules, and the voice, sound and edit tooling. Every frame is a pure function of (shot, t), so the same frame
renders to the same bytes every time.

Big media never goes in git. It lives in `/srv/chatdom/media/teaser/` (override with
`CHATDOM_TEASER_MEDIA`): reference captures and Twitch's fonts and icons (for local rendering only), takes, audio and
cuts. `work/evidence/teaser/MEDIA.md` lists what is there. `work/lanes/teaser/VOICE.md` lists every audio file we keep.

## Kept out of every public route

- The server (`server/serve.mjs`) binds to `127.0.0.1` only. `startStudio` throws for any other host.
- Nothing in `apps/web` routes to it, nothing in `scripts/public` or the API gateway allowlist names it, and the
  front page has no link to it.
- `package.json` has no `build` script, so `pnpm -r build`, `pnpm verify` and the public build never touch it.
- Fixture triggers live only in the shot scripts. The studio drives the product's own simulated routes
  (`/stream?source=simulated…`, `/panel`) through its own origin. It never adds a route to the product.
- Nothing is ever written to Twitch. `rig/reference-capture.mjs` opens the real page logged out and read only.
  It never clicks or types, and its captures stay in the media folder.

## Serve it

```sh
nice -n 19 pnpm --filter @chatdom/web build    # only when apps/web changed; the studio serves apps/web/dist
ss -ltn | grep 5182                           # pick a free port from packages/testing/capture-ports.mjs
node apps/studio/server/serve.mjs --port 5182 # or: pnpm --filter @chatdom/studio serve -- --port 5182
```

One origin serves everything, so the studio can reach into the frames it embeds:

| Path | What |
|---|---|
| `/studio/?shot=S08&t=1.2` | one frame of a page shot. Add `&player=key` for a transparent player, ready to composite |
| `/studio/?fixture=page&t=8` | the replica's own sample state, for working on the page itself |
| `/studio/frame.html?shot=S06` · `?card=title` | full-frame stills moved in the edit, and the title cards (record cards with `--alpha`) |
| `/studio/set.html?scene=grand\|kingdom\|raid\|forge\|atlas\|growth&shot=…&from=…` | the set pieces (`src/set/`, the contract is in `src/set/contract.ts`) |
| `/stream`, `/panel`, `/-/grand`, `/assets/…` | this worktree's web build |
| `/media/teaser/…` · `/evidence/…` | the media folder and `work/evidence`, read only |

Never use 5191 or 5192 outside a GPU lease: other lanes' leases fail when those ports are busy. Port 5187 and
5190–5197 are always reserved.

## Open a shot and drive the page

The shots are typed data in `src/shot-list/list.ts`, S01 to S22. `SHOTS.md` is generated from them
(`node apps/studio/edit/shots-md.mjs`). A page shot is built with `pageShot()` (`src/shot-list/page.ts`), and every
field is keyframed in shot time:

- **Chat.** `seed` and `beats` drive the seeded crowd (`src/chat/crowd.ts`). Each beat is a mood over a stretch of
  time: `trickle`, `greet`, `hype`, `awe`, `forge`, `raid-welcome`, `emote-wave` or `farewell`, with an optional
  `rate` (0 means silence). Use `scripted` for the lines the story needs, built with `say`, `sub`, `gift`, `raid`
  and `announce` from `src/chat/say.ts`. `say(1.0, 'lurker', '…', { firstTime: true })` gives Twitch's
  first-time-chatter highlight. The people come from `src/chat/roster.ts`: about 120 invented logins, each one
  checked absent on Helix (`src/chat/check-names.mjs` writes `names-checked.json`, and the roster test enforces it).
  Add a new name to the roster only after it passes that check.
- **The page.** Set `viewers`, `uptime`, `theatre`, `scroll`, `hypeTrain`, and `composing` (a line typed into the
  viewer's own chat box, then sent).
- **The panel.** `panel` is the `/panel` query (for example `state=unshared`). `clickPanel: true` makes the
  cursor's last key a real click on the panel's button.
- **Cursor and camera.** `cursor` keys move a hand-like cursor, with eased moves, presses and an arrow or hand
  shape. `camera` keys move a virtual camera over the composed page (`cx`, `cy`, `zoom`) for push-ins.
- **Player.** `key` (transparent), `plate` (a frame sequence from `media/teaser/takes/<take>/`), `still` (a real
  still, moved) or `live` (the stream view in place). `src/shot-list/plates.ts` names the take every page shot
  shows.

In a browser, `window.__studio.frame(t)` draws any time of the open shot and resolves once every image in view has
decoded. `window.__studio.actions` lists the shot's scripted clicks. Set pieces expose `window.__set`, with `t()`,
`idle()` and `stats()`.

## Take a still

```sh
nice -n 19 node apps/studio/rig/still.mjs --url "/studio/?shot=S08&t=1.2" --out /tmp/s08.png --port 5182 [--size 1920x1080]
```

This takes one frame in headless Chrome on this host, under the shared capture lock, held for that frame only.
WebGL here goes through SwiftShader, which is fine for checking a still by eye and nothing more. Use
`rig/probe.mjs <url>` to see a page's console errors and failed requests before you spend a lease on it.

## Record a take

`rig/record.mjs` is the recorder. Before any page script runs, it injects the virtual clock (`rig/virtual-clock.js`)
into every same-origin frame. The clock covers Date, performance.now, requestAnimationFrame, timers and Web
Animations. For each frame the recorder advances the clock exactly 1/fps s, waits until the page settles, and
captures. A slow host makes a take slower, never different. Every take writes `take.json`, which holds each
frame's index, time, clock value and SHA-256.

- **Page plates, cards and moved stills (DOM only), on this host:**
  `nice -n 19 node apps/studio/rig/batch.mjs pages|stills|cards|S01,S08 [--scale 2]`. Each job takes the
  capture lock for itself alone. Keep jobs short (a handful of seconds of footage).
- **Kingdom footage, on Tobias's RTX 5080:** never on this host's CPU. The takes are listed in `rig/film.mjs`.
  `node apps/studio/rig/shoot.mjs list` shows each take's state. `node apps/studio/rig/shoot.mjs film-S04` (or
  `all`) runs `chatdom-pc-lease --wait 10 --max 10` once per chunk. Inside a lease the studio serves on
  127.0.0.1:5192, and the recorder runs with `--gpu --capture webcodecs`: the plate canvas is encoded by the GPU
  in the page, with exact timestamps. Each lease records within a wall-time `--budget`, and the next lease
  continues with `--resume`. Exit 3 means the tunnel is down. Exit 75 means another lane held the lease. Read the
  `chatdom-pc-lease` header before the first lease.
- **Check and finish:** `nice -n 19 node apps/studio/rig/verify.mjs <take dir> [--clean]` checks that every frame
  is there exactly once, at the right clock value and with matching bytes, then muxes `master.mp4`.
  `rig/plate-frames.mjs <take>` unpacks a master into the frames a page shot's player shows.
  `edit/sheet.mjs <take dir>` makes a contact sheet. Look at every take.

## Edit, voice and sound

- `edit/edl.ts` is the edit decision list: shots with in and out points, transitions, captions from the narration's
  word timings, and sounds. `edit/render.mjs --cut rough|first --out …` renders it with ffmpeg (niced, at most 4
  threads). `edit/snap.mjs` snaps the cuts to the music's beats. `edit/review.mjs` writes review clips under 10 MB.
- `voice/` holds the ElevenLabs tooling (`eleven.mjs`, with a cache keyed by voice, model, settings and text), the
  J01 comparison, the scratch and final narration, and `final.json`, which the edit reads. The key is loaded only
  with `node --env-file=$HOME/.config/chatdom/elevenlabs.env …`, and nothing ever prints it. Log every batch in
  `work/lanes/teaser/voice-ledger.md`.
- `sound/ambience/` renders the kingdom's own soundscape offline (beds and hero sounds). `sound/temp-bed.mjs`
  synthesises the temporary score. It is never to be published.
- The kept takes are listed in `work/lanes/teaser/VOICE.md`. Never regenerate or overwrite them.

## Checks

- `pnpm --filter @chatdom/studio test` runs the chat tests and the recording test. The recording test records the
  same frames twice and expects equal hashes. It needs `apps/web/dist` and a turn in the capture queue, so the
  repo's own `pnpm test` skips it.
- `pnpm --filter @chatdom/studio typecheck`, and `pnpm lint` from the root.
- `node apps/studio/rig/hooks-check.mjs [--runtime]` checks that every product hook and route the shots use still
  exists. Run it after main is merged in, then fix the shot scripts to match.
- `node apps/studio/rig/replica-check.mjs` measures the replica against the reference capture (boxes, text styles,
  colours) and writes the side-by-side with a difference overlay. `rig/reference-capture.mjs` takes a new
  reference capture.
