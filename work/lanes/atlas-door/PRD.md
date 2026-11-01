# Lane atlas-door
Spec (background, Rules and Decisions hold): `chatdom/Atlas.md`, `chatdom/World-Tree.md`, `chatdom/ChatDom.md`, `chatdom/Artstyle-Soul-Feel.md`, `chatdom/Quality.md` · Branch: `lane/atlas-door` · Worktree: `../worktrees/atlas-door` · Worker: Opus high
Scope: `apps/web/src/genesis/**` (except the three authored kingdoms in `kingdoms/{aggman,masha,pinkkitty}`, which you read as the bar), `apps/web/src/atlas/**`, `packages/world/src/genesis/**`, `shots/genesis-door/**`, and this lane's PRD, progress and evidence (`work/lanes/atlas-door/**`, `work/evidence/atlas-door/**`).

## The part
The Atlas is the door for every channel. Click any holding on the Atlas, or arrive there by raid, and you are standing in a kingdom generated from that channel:
- its land from the broadcaster id, so the same channel is always the same place;
- its biome and landmarks from its categories (a Counter-Strike harbour is not a Just Chatting garden town);
- its crest and banners from its colours, its emotes as statues in the square, its motto and lore from its description;
- its size from the Atlas data, hamlet to capital.
Two channels never look alike, and a random holding is as loved as the three authored kingdoms (The_AGGman's harbour, PinkKittyRose's river town, MashaD4's mountain city): lit homes, dressed streets, a landmark you remember, a reason to look around.
The bar: pick ten holdings at random from the Atlas, open each one, and every one reads at 1080p dusk as its own place with care in it, never as the same template recoloured. The way in feels like a door: from the Atlas you travel into the kingdom, not a page load and a cut.
You own it end to end and make the design calls.
Context: the Genesis composer and channel inputs in `apps/web/src/genesis/` (`kingdom-composer.ts`, `channels.ts`, `seat-content.ts`, `water-content.ts`) and the authored kingdoms beside them; `packages/world/src/genesis/`, `settlement/` and `kingdom-land/`; the Atlas map, data and road in `apps/web/src/atlas/` (`data/`, `map/`, `road/`); the content library in `packages/content/`; the effects vocabulary in `packages/render/src/effects/`.
Boundaries: the kingdom scene, renderer and stream directors (`apps/web/src/kingdom/**`, `apps/web/src/stream/**`, `packages/render/**`), `packages/shared`, `packages/content`, `apps/api` and the realm are main's: read them freely; ask for any seam as an exact `needs:` with the patch written out, and keep going meanwhile.
Work in checkpoints: if a session ends before the part is done, leave everything building and working, write `next: <id> <what is done, what remains>` and carry on next session. For visual changes, show a before/after of the same view. Hand main exact `needs:` for any seam outside scope and keep going.
Captures: take the shared capture lock for one still or one short clip at a time and release it in between, so main can capture between your frames; never hold it for a whole series.

## Tasks
- [ ] **AD10 — Every channel's kingdom, whole.** Any Atlas holding (and any raid arrival) opens a generated kingdom from its channel: land from the id, biome and landmarks from categories, crest and banners from colours, emote statues, motto and lore, hamlet → capital from the Atlas data; the journey in from the Atlas; ten random holdings captured at 1080p dusk as a contact sheet next to the three authored kingdoms, each its own place.

## Backlog
