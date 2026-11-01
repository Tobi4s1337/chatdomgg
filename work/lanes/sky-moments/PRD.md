# Lane sky-moments
Spec (background, Rules and Decisions hold): `work/specs/20-twitch-moments.md` (its cheer tiers and the hype train with the earned dragon) · Branch: `lane/sky-moments` · Worktree: `../worktrees/sky-moments` · Worker: Opus high
Scope: `apps/web/src/twitch-moments/**` (new: the town's sky moments as one mountable module with a README mount recipe), `apps/web/src/twitch-moments-bench/**`, `shots/sky-moments/**`, and this lane's PRD, progress and evidence (`work/lanes/sky-moments/**`, `work/evidence/sky-moments/**`).

## The part
Twitch's own events are the physics of the kingdom, and the sky over the dusk town is where everyone sees it: a cheer makes the sky answer (sparks and fireworks for small cheers, up to a Skyfire aurora rolling over the mountains for a big one), and a hype train dresses the town and, at its level, wakes the dragon, who rises from beyond the ridge, circles the castle and the town looks up.
The bar: over the real Willowmere dusk view (the stream view composition) it gives you goosebumps; readable at 1080p at a glance; the town and the light respond, not just particles. Driven by the herald's event shapes; simulated runs are labelled SIMULATED.
You own it end to end and make the design calls.
Context: spec 20's tiers and train/dragon rules; `apps/herald/src/twitch-moments/` (event shapes, hype.ts); the effects vocabulary in `packages/render/src/effects/`; the dragon in `apps/web/src/forge/anvil-hero/bench/dragon-scene.ts` (read and adapt into your scope, never edit it); the stream view in `apps/web/src/stream/` (mount.ts) for how to sit over the town; `chatdom/ChatDom.md`, `chatdom/Artstyle-Soul-Feel.md`, `chatdom/Quality.md`, `chatdom/Moments.md`.
Boundaries: the stream and kingdom scenes, the forge, the herald, `packages/render` and `packages/shared` are main's: deliver a one-call mount and hand main the exact `needs:` to wire it in.
Work in checkpoints: if a session ends before the part is done, leave everything building and working, write `next: <id> <what is done, what remains>` and carry on next session. For visual changes, show a before/after of the same view. Hand main exact `needs:` for any seam outside scope and keep going.
Captures: take the shared capture lock for one still or one short clip at a time and release it in between, so main can capture between your frames; never hold it for a whole series.

## Tasks
- [x] **SM10 — The sky answers a cheer.** The cheer tiers up to the Skyfire aurora over the dusk town, with the town's light responding; captured before/after over the stream view.
- [ ] **SM11 — The hype train wakes the dragon.** The train dresses the town, the dragon wakes at its level, rises from the ridge, circles the castle, the town looks up, and it leaves or is beaten; captured as a sequence over the stream view.

## Backlog
