# Lane live-twitch
Spec (background, Rules and Decisions hold): `chatdom/Twitch.md`, `chatdom/Moments.md`, `chatdom/ChatDom.md` · Branch: `lane/live-twitch` · Worktree: `../worktrees/live-twitch` · Worker: Opus high
Scope: `apps/herald/**`, `apps/realm/src/{ingress,moments,raid-gate,allocation,wiring}/**` plus the realm's `main.ts`/`server.ts` wiring, `apps/api/**`, the stream view's realm feed in `apps/web/src/realm/**`, the moment presentations in `apps/web/src/twitch-moments/**` and `apps/web/src/raid-gate/**`, `scripts/live/**`, and this lane's PRD, progress and evidence (`work/lanes/live-twitch/**`, `work/evidence/live-twitch/**`).

## The part
My real channel answers. On a real twitch.tv/tobi4s_ stream, within seconds:
- someone cheers, and the sky over Willowmere answers at its rung (the Skyfire aurora and the rungs above it);
- a hype train starts, and the dragon comes;
- a raid comes in, and the Raid Gate wakes and the guests arrive in the kingdom;
- every person who speaks gets their own home and their window lights. The live kingdom (129634568) has twelve homes today, so the thirteenth chatter gets no window. Everyone who speaks gets their light, however many come.
Each one is labelled LIVE when it's real, and runs the whole path: herald → realm ingress → moment → the stream view (`/stream?source=realm&kingdom=129634568`).
The bar: a viewer on stream sees the kingdom react to the real event within a few seconds, every time, with the same presentation the team already built (the sky moments and the dragon on the stream view, the raid road at the gate). Nothing double-fires on a retry, and nothing breaks the running chat path.
You own it end to end and make the design calls.
Context: the herald already has the bits and hype code in `apps/herald/src/twitch-moments/` (`bits.ts`, `hype.ts`, `subscription.ts`, `normalizer.ts`) and delivers to the realm through `apps/herald/src/realm-delivery/`; the realm takes it in `apps/realm/src/ingress/`, has `apps/realm/src/moments/` and the Raid Gate coordinator in `apps/realm/src/raid-gate/` (not yet bound in `apps/api/src/main.ts`); homes are placed in `apps/realm/src/allocation/`. The presentations: `apps/web/src/twitch-moments/` (Skyfire, castle volley, the dragon) and `apps/web/src/raid-gate/` (the raid road). The Twitch CLI is installed (`twitch event trigger`, `twitch event websocket start-server`).
Proof: run the Twitch CLI's mock events end to end through your own herald, realm and API on spare ports (the services already running on 5194–5197 are in use; don't restart them), and show each moment arriving on the stream view. Then leave one command per moment in `scripts/live/` plus a short README there, so on a real stream each moment can be fired on tobi4s_ (a real cheer or a test event on that channel only) and checked: what to run, what you should see, how to tell it reached the kingdom.
Boundaries: the kingdom scene, camera, look, renderer and stream directors are main's (`apps/web/src/kingdom/**`, `apps/web/src/stream/**`, `packages/render/**`). If a moment needs one hook inside them to start on the stream view, keep it to a small additive seam and ask main for it as an exact `needs:` with the patch written out; carry on with the rest meanwhile. `packages/shared` contracts: add, don't break.
Work in checkpoints: if a session ends before the part is done, leave everything building and working, write `next: <id> <what is done, what remains>` and carry on next session. Hand main exact `needs:` for any seam outside scope and keep going.
Captures: take the shared capture lock for one still or one short clip at a time and release it in between, so main can capture between your frames; never hold it for a whole series.

## Tasks
- [ ] **LT10 — The real channel answers, whole.** Cheer → the sky at its rung, hype train → the dragon, raid → the Raid Gate wakes and the guests arrive, everyone who speaks gets a home window; all LIVE-labelled, proven herald → realm → stream view with the Twitch CLI mocks, a still of each moment on the stream view, and one command per moment in `scripts/live/` with its README.

## Backlog
