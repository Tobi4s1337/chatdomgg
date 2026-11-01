# Lane raid-road
Spec (background, Rules and Decisions hold): `work/specs/23-raid-gate.md`, with `01-atlas.md` · Branch: `lane/raid-road` · Worktree: `../worktrees/raid-road` · Worker: Opus high
Scope: `apps/web/src/raid-gate/**`, `apps/web/src/atlas/**`, `shots/raid-road/**`, and this lane's PRD, progress and evidence (`work/lanes/raid-road/**`, `work/evidence/raid-road/**`).

## The part
A raid as one journey you want to watch: the Raid Gate of the leaving kingdom wakes, the party gathers carrying their own banners and colours, a column of torches travels the road across the Atlas between the two holdings, and the guests arrive at the destination kingdom's gate with their banners, to the welcome and the gift.
The bar: one continuous, readable journey at 1080p at dusk; you'd clip it. Real Atlas holdings for both ends; when it isn't a real raid it is labelled SIMULATED.
You own it end to end and make the design calls.
Context: what exists in `apps/web/src/raid-gate` (controller, GuestArrival, welcome, gifts) and `apps/web/src/atlas` (live/paint.ts); `apps/web/src/kingdom-entry` for how you arrive in a kingdom; the effects vocabulary in `packages/render/src/effects/`; heraldry in `packages/content/src/genesis-heraldry/`; `chatdom/ChatDom.md`, `chatdom/Artstyle-Soul-Feel.md`, `chatdom/Quality.md`, `chatdom/Moments.md`.
Boundaries: the kingdom and stream scenes, kingdom-entry, the herald, `apps/api` and `packages/shared` are main's; ask for the arrival seam as an exact `needs:`.
Work in checkpoints: if a session ends before the part is done, leave everything building and working, write `next: <id> <what is done, what remains>` and carry on next session. For visual changes, show a before/after of the same view. Hand main exact `needs:` for any seam outside scope and keep going.

## Tasks
- [ ] **RR10 — The raid road, whole.** Gate wakes and the party gathers with banners; the torch column along the Atlas road; guests arrive at the destination gate with their banners to the welcome and the gift; captured as one sequence plus before/after stills.

## Backlog
