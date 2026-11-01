# Lane soul
Spec (Rules and Decisions hold): `chatdom/Artstyle-Soul-Feel.md`, `chatdom/World-Tree.md`, `chatdom/Moments.md`, `chatdom/ChatDom.md`, `chatdom/Quality.md` · Branch: `lane/soul` · Worker: codex sol high
Scope: `packages/world/src/soul/**` (keepers' days, weather and seasons), `packages/audio/src/soul/**` (soundscape and music), `apps/web/src/soul/**` (their presentation and a review view at `/-/soul`, one line in the `lanePaths` map of `apps/web/src/main.tsx`), `shots/soul/**`, and this lane's records (`work/lanes/soul/**`, `work/evidence/soul/**`). The kingdom scene and stream directors (`apps/web/src/kingdom/**`, `apps/web/src/stream/**`), `packages/shared`, the realm and the existing citizens, home-life and audio engine are main's: read them freely and ask for the seam you need as an exact `needs:` with the patch written out.

## The part
The kingdom is alive when nobody is watching. Open it between streams and it is a place going about its day, not a set waiting for its cast.
- **Keepers with routines:** a few plainly identified keepers (the baker, the lamplighter, the harbour master, the smith) live real days: the baker's chimney smokes at dawn and the bread cart rolls out, the lamplighter walks the streets at dusk lighting lamp after lamp, the harbour master rings the bell when a ship comes in. They are the only townsfolk; real people stay real people, and nobody is faked into a chatter.
- **Weather and seasons:** morning mist in the valley, soft rain that darkens the roofs and fills the puddles, a clear night of stars, snow that settles on the peaks and roofs as the season turns, wind that moves the banners and the trees. It changes slowly, at the pace of a real day.
- **A place you can hear:** a soundscape per biome and per hour (gulls and rigging at the harbour, the forge's ring, birds at dawn, crickets at night, rain on tiles) and music that fits the kingdom and the moment, quiet under the stream and never a loop you notice.
- **Hamlets feel loved too:** the smallest kingdom has its keeper, its weather and its sound.
It holds on the stream view and in the walk, it never spends what the frame needs, and everything that exists keeps working with it. Show it as a day in one kingdom, dawn to night, in stills you have looked at and a short listen of each soundscape. Fan out sub-agents (terra high for sounds, motion and views) one folder each. You own it end to end and make the design calls.
Captures: take the shared capture lock for one still or one short clip at a time and release it in between; while you wait for it, keep building, and never end a turn blocked on it.

## Tasks
- [ ] **SO10 — The kingdom alive between streams, whole.** Keepers with routines, weather and seasons, a soundscape and music per biome and hour, in every kingdom down to the hamlet; a dawn-to-night day of one kingdom seen and heard.

## Backlog
- Main: settle the capture supervisor's pending retry promise on queue cancellation; clean bounded waits currently print Node's unsettled-await warning.
