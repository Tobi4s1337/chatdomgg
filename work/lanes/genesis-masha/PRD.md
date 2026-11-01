# Lane genesis-masha
Spec (background, Rules and Decisions hold): `work/specs/39-channel-genesis.md`, with 40-44 (landmarks, heraldry, emote art, keepers, sound) · Branch: `lane/genesis-masha` · Worktree: `../worktrees/genesis-masha` · Worker: Opus high
Scope: `apps/web/src/genesis/kingdoms/masha/**`, `packages/content/src/genesis-kingdoms/masha/**`, `shots/genesis/masha/**`, and this lane's PRD, progress and evidence (`work/lanes/genesis-masha/**`, `work/evidence/genesis-masha/**`). Two other workers do the other two Genesis kingdoms beside you, each in its own kingdom folders.
Shared Genesis code (`apps/web/src/genesis/*.ts(x)`, `packages/world/src/genesis/**`, `packages/content/src/genesis-*/**`) may only be extended additively and minimally (a registry entry, a new export, a hook); anything bigger goes to main as an exact `needs:`.

## The part
**MashaD4** (154972160) becomes a real Genesis kingdom of its own: a mountain city (five hundred homes beneath the keep and the mountain pass) at its own true size, grown from its public channel (broadcaster id seeds the land; category sets biome and landmarks; its colours make crest, banners and roofs; its emotes become statues and stained glass; its description gives motto and lore). It sits in a size triptych with the two other Genesis kingdoms, so the three together show "hamlet → town → city".
The bar: put it beside the other two and Willowmere, cover the labels, and you still know whose kingdom it is. Beautiful at dusk from its hero view and from the Atlas door, at the quality of the Willowmere stream view on a real GPU. Big crowds shown as lights, never faked; unfounded land stays labelled as now.
You own it end to end and make the design calls.
Context: `shots/genesis/154972160@1920x1080.png` (where it stands now) and `shots/genesis/showcase-full@1440x900.png`; `apps/web/src/genesis/` (channels.ts holds its captured public data); `packages/world/src/genesis/`; the finished Genesis content lanes in `packages/content/src/genesis-*`; the effects vocabulary in `packages/render/src/effects/`; `chatdom/ChatDom.md`, `chatdom/Artstyle-Soul-Feel.md`, `chatdom/Quality.md`, `chatdom/Moments.md`.
Boundaries: shared contracts in `packages/shared`, engines, shaders, package manifests, the stream and Willowmere scenes are main's.
Work in checkpoints: if a session ends before the part is done, leave everything building and working, write `next: <id> <what is done, what remains>` and carry on next session. For visual changes, show a before/after of the same view. Hand main exact `needs:` for any seam outside scope and keep going.

## Tasks
- [x] **GM10 — MashaD4, a kingdom of its own.** Land, landmarks, crest and banners, emote art, keepers, sound and its own dusk light at its own size, captured from its hero view and the Atlas door with a before/after against `shots/genesis/154972160@1920x1080.png`.

## Backlog
