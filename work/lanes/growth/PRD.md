# Lane growth
Spec (Rules and Decisions hold): `work/specs/50-growth.md`, with `work/specs/04-homes-hearth.md` and `02b-settlement-plan.md` · Branch: `lane/growth` · Worktree: `../worktrees/growth` · Worker: team
Scope: `apps/web/src/growth/**`, `packages/content/src/growth-homes/**`, `shots/growth/**`, and this lane's PRD, progress and evidence (`work/lanes/growth/**`, `work/evidence/growth/**`).

## The part
Growth you can see: one citizen's home grows forward through its tiers, hut to cottage to house to manor to hall, the back fence moving and new materials and heights arriving, each step a small celebration on the lot; and around it the town grows with the kingdom, a new quarter's streets and civic places opening at the growth edge, lanterns coming on in the new homes. Watched as one sequence at dusk, it says "this place has been lived in for years, and it grows because people keep showing up".
The bar: one continuous, readable sequence at 1080p at dusk, from close on the home to wide on the town; every step reads as earned and warm, never as a menu or a progress bar; the hut has the same care as the hall. Growth only ever goes forward. When it isn't a real kingdom's history it is labelled SIMULATED.
You own it end to end and make the design calls.
Context: home tiers and depths in `packages/shared/src/voxel.ts` (`HomeTier`, `HOME_DEPTH_METRES`) and the home families in `packages/content/src/homes/`; quarters by year and growth exits in `packages/world/src/settlement/generator.ts`; how the kingdom places and lights homes in `apps/web/src/kingdom/settlement-content.ts`, `home-life`, `lights`; the effects vocabulary in `packages/render/src/effects/`; `chatdom/ChatDom.md`, `chatdom/Artstyle-Soul-Feel.md`, `chatdom/Quality.md`, `chatdom/Moments.md`.
Boundaries: the kingdom and stream scenes, `packages/world`, `packages/shared`, `packages/content`, `apps/api` and the herald are main's; read them freely, build the sequence in your own folder (a bench page or a director that composes what exists), and ask for any seam into the stream view as an exact `needs:`.
Work in checkpoints: if a session ends before the part is done, leave everything building and working, write `next: <id> <what is done, what remains>` and carry on next session. For visual changes, show a before/after of the same view. Hand main exact `needs:` for any seam outside scope and keep going.
Captures: take the shared capture lock for one still or one short clip at a time and release it in between, so main can capture between your frames; never hold it for a whole series.

## Tasks

First consumer seam: import `GrowthSceneFrameSchema`, `GrowthSceneFeed`, `GrowthHomeView` from `@chatdom/shared`;
use `@chatdom/world/growth` to generate earned SIMULATED frames. Main owns live binding and actual house revision
commits. Preserve your ceremony work; no replacement progression model. Key a beat by kingdom/source sequence/kind/plot
so a repeated frame does not repeat a housewarming. Tent is an entitlement until the camp asset is supplied; don't call
a hut a tent. Main will mount `apps/web/src/growth/index.tsx` at `/-/growth` on its first checkpoint. Send exact scene
ports as `needs:`; build the owned visual sequence while main provides them. No full-suite screenshot matrix.
- [ ] **GR10 — Growth over time, whole.** One home grows hut → hall on its lot with a warm moment at each step; the town around it grows a new quarter at its growth edge with lit homes; captured as one sequence plus before/after stills (close and wide).

Next content checkpoint inside GR10: a Hearth hut/cottage pair unmistakable from across the street, in the
same light and at the same camera. The cottage must gain a full second storey, a higher and clearly different
roof line, more warm panes, and a garden or fence. A rear extension alone does not pass. Other tiers should earn an obvious storey/roofline
and richer plot silhouette. Author any new variants under `packages/content/src/growth-homes/**`; do not edit
existing families or native-host selection. Main integrates version-aware native publication without reducing
existing homes or changing their door/Forge slots. This art can proceed independently of civic/card/crier/history.
The portable props/score checkpoint is on main; retain the standalone bench WIP. Main now owns the live stream
ceremony mount and witnessed revision handoff; do not duplicate those integration modules.

## Backlog
