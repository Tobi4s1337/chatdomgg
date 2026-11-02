# The campfire (web)

The fire at the clearing on the edge of the Wilds, and Dusk Court, in the browser. The clearing's logs, hearth and
Magistrate's chair are founded geometry (`packages/content/src/campfire`, installed by the realm's founded scene
hook); the kingdom draws them and collides with them like any placement. This folder adds only what moves, glows
and speaks, and the carved HUD.

## In a kingdom walk (the product path)

`register.ts` is the one line for play's `providers.ts`: `import '../campfire/register';`. It registers the walk
feature `campfire` (play's `registerWalkFeature`, B1c). For every walk, `walk.ts` (`mountCampfireWalk`):

- finds the installed clearing in the walk's own founded scene (`clearing.ts` `findClearing`, placement
  `campfire:clearing:v1`); a kingdom without it gets nothing;
- mounts `effects.ts` in the walk's scene: the flame, sparks, embers, smoke, a game lantern by each playing seat
  (snuffed, sent and tipped as the round says), the Gallery's embers and Twitch chat rising as lanterns beyond the
  logs (from the room's `transient` chat), with their words in play's feature overlay; a glow and a warm pool on the ground round the fire; 14 draws, no real lights;
- opens a `session.ts` on the same kingdom room (`campfire`, `campfire.self`, `campfire.receipt`); private only for a
  walker with an identity, never on the watching or stream view;
- shows the carved HUD (`Hud.tsx` through `walk-hud.tsx`) while you sit at the fire, or stand within 9 m of it while
  a round runs; sitting frees the cursor (play's `requestCursor`) and the arrows, digits and Enter go round the circle
  (`keys.ts`, `input.ts`); E and Escape stay with the seat's interaction;
- sounds the fire, the night and the round's public moments (`sound/`) through the kingdom's own mixer.

Sitting is the realm's `sit` interaction on `fire:clearing:seat:<n>` and the kingdom room's `CampfireSeatHost`
(`apps/realm/src/campfire`). Seat 0 is the Magistrate's chair, the streamer's only.

## The stream

`StreamOverlay.tsx` reads only the public frame from a session opened with `private: false`; with no round it shows
nothing (`graph.test.ts` keeps it away from the HUD, the hand and every card).

## `/-/campfire`

Says where the fire is. It never stages a circle.

## The recorded round (dev only)

`round.mjs` plays a whole Dusk Court round in the lane's own in-memory realm (SIMULATED reference identities, a
founded hamlet from a seed) with five headless walkers and one browser walker, and writes `ga11-round.json/.md` to
the evidence folder. It builds `round-page.tsx` (play's `KingdomEntry` on the live entry source) in place of
`main.tsx`; that page is never a route. It needs play's walk feature slot, so it runs from an assembled tree.

- SwiftShader: `node round.mjs` (the browser presses real keys; holds the shared capture lock).
- Real GPU: `node round.mjs --build-only`, then `chatdom-pc-lease --wait 30 --max 10 -- node round.mjs --gpu
  --skip-build`. The leased Chrome can only open a URL and wait, so each still is its own page (`?shot=`), the
  harness seats that person through the same interaction authority E reaches (`campfireReference().sit`) on every
  page (a new page replaces the old session, which leaves its log; the court holds the player as away meanwhile),
  and the fire's clock stands still between the operator's steps, so the hold never runs out.

The kingdom's source ribbon is hidden in these stills: presence comes only from the realm's durable outbox, which
the in-memory realm never writes, so it would always read "Connection lost".

## Provenance

No third-party code or assets. Glyphs, props, effects, sounds and words are authored here.
