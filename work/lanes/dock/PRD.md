# Lane dock
Spec (Rules and Decisions hold): `chatdom/Twitch.md`, `chatdom/Monarch.md`, `chatdom/Moments.md`, `chatdom/ChatDom.md`, `chatdom/Safety.md`, `chatdom/Quality.md` · Branch: `lane/dock` · Worker: codex sol high
Scope: the streamer's dock as a new app (`apps/dock/**`: an OBS custom browser dock, also usable as a page), its API routes (`apps/api/src/dock/**`, mounted with one line in `apps/api/src/main.ts`), `shots/dock/**`, and this lane's records (`work/lanes/dock/**`, `work/evidence/dock/**`). The kingdom scene and stream directors (`apps/web/src/kingdom/**`, `apps/web/src/stream/**`), the realm, the herald, the moments and `packages/shared` are main's (and the live Twitch lane's): read them freely and ask for the seam you need as an exact `needs:` with the patch written out. Never touch the running services on ports 5190–5199.

## The part
The streamer leads. Next to the stream in OBS sits the kingdom's dock: a small, beautiful panel in the kingdom's own look, and every press plays on stream at once.
- **Open the gate** when you go live, and the town wakes and gathers; **close it** at the end with a goodnight.
- **Start the fire** in the square and people come and sit.
- **Welcome a raid:** when a raid comes in, one press brings the guests up the road with their banner and the town turns out to greet them.
- **Crown a citizen** or knight one for the day, with the ceremony on stream.
- **Trigger a moment** the streamer chooses (the sky, the dragon, a Forge showcase) when the stream needs it.
- It shows what is happening (who is in town, what's growing, what's coming) at a glance, works with one hand mid-stream, is safe (only the broadcaster and their mods can press, every action is undoable or gentle), and signs in with Twitch.
Show it docked beside a stream view, each action pressed and its moment seen on stream, in stills and short clips you have watched. Fan out sub-agents (terra high for the UI and its states, one folder each). You own it end to end and make the design calls.
Captures: take the shared capture lock for one still or one short clip at a time and release it in between; while you wait for it, keep building, and never end a turn blocked on it.

## Tasks
- [ ] **DK10 — The streamer leads from the dock, whole.** Open and close the gate, start the fire, welcome a raid, crown a citizen, trigger a moment, each playing on stream at once; a dock that reads the town at a glance, safe for broadcaster and mods, Twitch sign-in; seen docked beside the stream.

## Backlog
