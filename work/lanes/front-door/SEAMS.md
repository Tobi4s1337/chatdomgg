# front-door seams

Frozen on Sun 1 Nov 2026 for this round. Change a seam only by writing the change here and in the other lane's
SEAMS.md. Each side builds so that it works with or without the other side's part; nobody edits the other lane's
files to make a seam work.

## 1. The Atlas embed (atlas-map gives, front-door mounts)

**What front-door calls.** The story page's last section mounts the live Atlas:

```ts
const { mountAtlas } = await import('<atlas-map's export under apps/web/src/atlas/>');
const handle = mountAtlas(element, { mode: 'hero' });
```

`mode` is `'hero' | 'explore' | 'gate'` (raid-show uses `'gate'`). The exact file and handle shape are atlas-map's to
choose; write them here when they exist. front-door needs:

- **Lazy and light.** Importable on its own from the front page's small build, without pulling in the kingdom engine,
  the realm client or the identity chunks. front-door imports it only when the section nears the viewport.
- **Contained.** It draws inside the element it is given, sized by the host (full-bleed on desktop, a designed
  height on a phone). No global body styles, no scroll capture that traps the page on a phone, and in hero mode it
  never rewrites the URL or takes over the route.
- **A handle.** `destroy()` to unmount cleanly, and a ready-or-failed signal (a promise or callbacks). On failure, or
  without WebGL, front-door shows its own real capture of the Atlas with "Explore the map" linking to `/map`.
- **Hero mode.** The live map with its glow and search, quiet chrome, and "Explore the map" taking you to `/map` at
  the same view. Reduced motion is honoured.
- **The view, for sign-in.** A way to read and set the current view (position, zoom, open card), so the sign-in
  round trip returns to the same view (A09). front-door's kit stores and restores it with the return-view helper
  (section 3).
- **Same origin only.** Data from `/map-data/...` on our origin (the CSP allows nothing else, except Twitch's image
  CDN `static-cdn.jtvnw.net` for pictures).

**How front-door finds it.** Through `import.meta.glob`, so the front page builds and works before the export
exists. Until then the section shows a real capture of `/map` and the link.

**Kit pieces for the Atlas** (section 3): atlas-map mounts the sign-in seal, the Twitch mark on each card's
"Watch on Twitch" button, the footer with the legal links and the line "Live from Twitch. Chatdom is not affiliated
with or endorsed by Twitch.", and links to `/how-it-works` (or mounts the How it works sheet). These are atlas-map's
edits in its own files; front-door supplies the pieces and the recipe.

## 2. The hero (grand-world gives, front-door shoots and later mounts)

The grand land is every kingdom's land and the end version (decision 47), so the front page's hero is the grand
land: tobi4s_'s, at dusk.

**Now (FD10): captures.** front-door shoots its own stills on Tobias's GPU through `pc-lease` from the existing
orbit view on main:

```
/-/grand?channel=tobi4s_&capture=1&still=1&hour=<dusk>&view=<view>&yaw=<..>&pitch=<..>&dist=<..>&t=<time>
```

(`apps/web/src/grand/index.tsx` reads `channel`, `still`, `stats`, `view`, `hour`, `tier`, `t`, `capture`, `yaw`,
`pitch`, `dist`, and sets `window.__chatdomReady`.) front-door asks grand-world to keep these parameters, or their
replacements written here, working on the final land, deterministic for a given `t`, so a sequence of stills taken
across several leases lines up into one motion.

**Later (FD13): a live hero.** front-door asks grand-world for a small, lazily importable mount, for example
`mountLandHero(element, { channel: 'tobi4s_', hour, orbit: true, tier: 'auto' })`, returning `destroy()` and a
ready-or-failed signal, drawing only into the given element, choosing its own quality tier, stepping down without
WebGL, and honouring reduced motion. Windows lighting as names appear is the ambition; it uses whatever presence the
land already shows. Until the mount exists, the hero stays on captures and front-door re-shoots them after Monday's
merge.

front-door never edits `apps/web/src/grand/**`, `packages/world/src/grand/**`, `packages/voxel/**`,
`packages/render/**` or the kingdom scene.

## 3. The carved kit `packages/ui` (front-door owns, everyone reads)

**Rules.** Every existing export of `@chatdom/ui` (`.`, `./kit.css`, `./passport`, `./growth-card`) keeps its name and
API. New pieces are additive. Other lanes never edit `packages/ui`; they ask with a `needs:` line in their own progress
and a note here, and front-door answers in its next session.

**Who reads it today:** `apps/web/src/kingdom` (ProvenanceSeal), `apps/web/src/growth`, `apps/web/src/avatar-builder`,
`apps/web/src/forge`, `apps/web/src/build-tools`, `apps/web/src/citizen-card`, `apps/web/src/passport` (raid-show),
`apps/panel/src` with `card/` and `passport/` (panel-window), `apps/dock/src` (raid-show), and the front door.

**What front-door adds this round** (names may be refined; the final names are written here when they land):

| Piece | For | Notes |
|---|---|---|
| `@chatdom/ui/fonts.css`, `--cd-face-name` | everyone who shows a Twitch name | Self-hosted faces for every script, split by `unicode-range`. Latin pages download no CJK. |
| a canvas font helper | the Atlas map, the world's nameplates | Loads the faces a string needs before it is drawn on a canvas. |
| sign-in seal | front page, legal pages, the Atlas, the walk-in gate | Official Twitch Glitch, unaltered, in a brass frame; signed-in and signed-out states; sign-out with CSRF; designed sign-in outcomes. |
| return-view helper | anyone who sends people to sign in | Stores a view in `sessionStorage` under one key just before leaving, and returns it once on the way back (the sign-in service accepts only plain paths). |
| Twitch mark | "Watch on Twitch" buttons on Atlas cards | The official mark in its brass frame, unaltered. |
| site footer | every public page | "Imprint · Impressum", "Privacy", "Terms", "How it works", and "Live from Twitch. Chatdom is not affiliated with or endorsed by Twitch." |
| How it works sheet | the Atlas's carved tab | The same four pictures as `/how-it-works`. |

**Landed in FD10** (on chatdom.io's own pages; FD11 moves them into `packages/ui` without changing these
contracts):

- **The return-view key.** `sessionStorage['chatdom:return-view:v1']` holds
  `{ path, at, section?, scrollY?, view? }`: `path` is a plain path on our origin, `at` the time it was written (ms),
  `section` the id of the section in view, `scrollY` a scroll position, and `view` an object a view handle gives
  (the Atlas's position, zoom and open card), stored as given and handed back untouched. It is written just before
  the browser leaves for `/api/realm/auth/start` and read once on the way back; a view older than 15 minutes is
  ignored. The sign-in service returns only to the paths its rule accepts (`/`, `/map`, `/map/<login>`, one-word
  paths); a page it refuses (`/how-it-works`) comes back to `/`, and the front page carries the visitor on to the
  stored path. Code: `apps/web/src/site/return-view.ts`.
- **The sign-in seal and the Twitch mark** are for chatdom.io pages only. **No Glitch inside the Twitch panel
  extension** (Extensions Guidelines 4.3: no Twitch name, branding, logo or Glitch in extension content).
  panel-window: the panel's footer links to `/privacy`, `/terms` and `/imprint` without the mark or the Twitch line.
  Details in `twitch-brand.md`.
- **The session name.** The seal shows the Twitch name once the session reply carries one (an optional `name`, asked
  of main); until then it says "Signed in with Twitch".

**Heads-up: the kit stops printing SIMULATED** (decision 25). `ProvenanceSeal`, `provenanceLines` and the passport
and growth-card helpers keep their API but will not print the word. front-door lists every capture and test that
reads the word before changing it and writes the list here, so each owner can update their own checks in their own
lane. Benches stay benches: unlabelled, and not reachable on the public origin.

## 4. The public origin (front-door owns the gate)

- The page list in `apps/api/src/public/routes.ts` decides what chatdom.io serves. A lane that needs a new public page
  writes `needs: public page <path>` and front-door adds it.
- Public page URLs that ask for staged data (`source=simulated`, `fixture=`) get the 404 page. The fixture-only
  `/-/citizen-card` leaves the public list. `/showcase` redirects to `/`.
- The legal pages have stable URLs for panel-window's panel footer and for Tobias's extension listing on
  dev.twitch.tv: `https://chatdom.io/privacy`, `https://chatdom.io/terms`, `https://chatdom.io/imprint`.
- One setting, `PUBLIC_INDEXING=closed|open` (default `closed`), controls `X-Robots-Tag`, `robots.txt` and the
  sitemap. Traefik's own noindex middleware is removed by Tobias once this is deployed.
- The live gateway is restarted only by Tobias or main.
