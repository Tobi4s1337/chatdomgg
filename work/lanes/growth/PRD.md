# Lane growth
Spec (background, Rules and Decisions hold): `chatdom/World-Tree.md` §8 "Time and growth", with `work/specs/04-homes-hearth.md` and `02b-settlement-plan.md` · Branch: `lane/growth` · Worktree: `../worktrees/growth` · Worker: Opus high
Scope: `apps/web/src/growth/**`, `shots/growth/**`, and this lane's PRD, progress and evidence (`work/lanes/growth/**`, `work/evidence/growth/**`).

## The part
Growth you can see: one citizen's home grows forward through its tiers, hut to cottage to house to manor to hall, the back fence moving and new materials and heights arriving, each step a small celebration on the lot; and around it the town grows with the kingdom, a new quarter's streets and civic places opening at the growth edge, lanterns coming on in the new homes. Watched as one sequence at dusk, it says "this place has been lived in for years, and it grows because people keep showing up".
The bar: one continuous, readable sequence at 1080p at dusk, from close on the home to wide on the town; every step reads as earned and warm, never as a menu or a progress bar; the hut has the same care as the hall. Growth only ever goes forward. When it isn't a real kingdom's history it is labelled SIMULATED.
You own it end to end and make the design calls.
Context: home tiers and depths in `packages/shared/src/voxel.ts` (`HomeTier`, `HOME_DEPTH_METRES`) and the home families in `packages/content/src/homes/`; quarters by year and growth exits in `packages/world/src/settlement/generator.ts`; how the kingdom places and lights homes in `apps/web/src/kingdom/settlement-content.ts`, `home-life`, `lights`; the effects vocabulary in `packages/render/src/effects/`; `chatdom/ChatDom.md`, `chatdom/Artstyle-Soul-Feel.md`, `chatdom/Quality.md`, `chatdom/Moments.md`.
Boundaries: the kingdom and stream scenes, `packages/world`, `packages/shared`, `packages/content`, `apps/api` and the herald are main's; read them freely, build the sequence in your own folder (a bench page or a director that composes what exists), and ask for any seam into the stream view as an exact `needs:`.
Work in checkpoints: if a session ends before the part is done, leave everything building and working, write `next: <id> <what is done, what remains>` and carry on next session. For visual changes, show a before/after of the same view. Hand main exact `needs:` for any seam outside scope and keep going.
Captures: take the shared capture lock for one still or one short clip at a time and release it in between, so main can capture between your frames; never hold it for a whole series.

## Tasks
- [ ] **GR10 — Growth over time, whole.** One home grows hut → hall on its lot with a warm moment at each step; the town around it grows a new quarter at its growth edge with lit homes; captured as one sequence plus before/after stills (close and wide).

## Backlog
