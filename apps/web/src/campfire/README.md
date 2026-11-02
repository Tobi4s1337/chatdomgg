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
  logs (from the room's `transient` chat), with their words in play's feature overlay; 11 draws, no real lights;
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

## Provenance

No third-party code or assets. Glyphs, props, effects, sounds and words are authored here.
