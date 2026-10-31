# Lane effects-library
Spec (background, its Decisions hold): `work/specs/48-effects-library.md` · Branch: `lane/effects-library` · Worktree: `../worktrees/effects-library` · Scope: new `packages/render/src/effects/**` + this lane's PRD, progress and evidence (`work/lanes/<lane>/**`, `work/evidence/<lane>/**`) · Worker: Opus high

## The part
One coherent vocabulary of small moving lights and air for the world: fireflies, embers, sparks, short curling chimney
smoke, dust in real light shafts, and the Forge flight's magic trail. Effects reinforce real places and real events, never
fake presence, and sit in the existing HDR scene and bloom with source-sized glow. You own it end to end and make the
design calls. The bar: at stream distance at dusk the town feels alive and warm, never busy.
Context: spec 48; `work/references/magic-lighting.md`, `work/references/post-stack.md` (techniques only, no copied code).
Boundaries: the scope above. `apps/web` adapters, replacing old emitters and shared types are main's. Simulated bench inputs
are visibly labelled.
Work in checkpoints: if a session ends before the part is done, leave everything building and working, write `next: <id> <what is done, what remains>` and carry on next session. For visual changes, show a before/after of the same view. Hand main exact `needs:` for any seam outside scope and keep going.

## Tasks
- [x] **EL01 — A visible, deterministic effects bench and the factory** · Seed/clock, source lifecycle, quality and disposal; show sparse fireflies and embers in the existing HDR scene.
- [ ] **EL10 — The whole effects library, handed across.** Smoke from real chimneys, dust in real shafts, sparks and the Forge flight trail on real events, fireflies and embers; deterministic and bounded on every quality tier, no leaks; a concrete adapter for an existing stream cue so main can switch each one on; bench stills at stream distance that make the town feel alive.

## Backlog
