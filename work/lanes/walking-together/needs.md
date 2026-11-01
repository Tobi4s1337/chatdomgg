# WT10 integration seams — 2026-11-01

WT10 remains unchecked. This lane can build movement, wardrobe rendering, controls and gestures, but its PRD makes kingdom, stream, shared contracts, realm and API read-only. The following gaps were found in the real consumers, not inferred from a bench. Main must freeze/bind these seams before end-to-end acceptance. No code outside lane scope was changed.

## Ready lane work

- `createWornCitizenLook(id, authorizedRecipe, subLapsed)` preserves the builder's full-body recipe and exact cloth dyes, while only subscription pieces dim after lapse. It does not grant eligibility.
- `CitizenSample.gesture` supports `none | nod | wave | bow | cheer | dance | sit | point`, with distance-driven walking under upper-body gestures and shortest-arc turning.
- `WalkControllerOptions.gestures` accepts an authenticated port: `available()`, `publish(gesture)`, `sample(walkerId, monotonicNow)`. The controller mounts the selector only when this port exists, clears on ownership loss/disconnect/hidden page, and exposes `gestureFor(id, now)` for rendering. No invented room messages are sent.
- `layoutWalkLabels` accepts measured names/bubbles and HUD rectangles, prioritizes active speech, bounds labels to the screen, and avoids overlap without detaching text from the actual head. Bind it once across walker labels and crowd bubbles, in web and stream, rather than running separate layouts.
- `PeopleLabels` in `walk/labels/index.tsx` now supplies the real measured Solid layer, Twitch emote rendering and synchronous removal. `peopleFromLabels` joins speech to a walker only by its authority-supplied home slot. `measureReservedElements` converts caller-selected HUD boxes into layer-local coordinates, including stream scaling. Position-only updates do not remeasure text. Component stills at both web sizes were inspected; town/stream binding is still pending.
- `CitizenRenderer.heads` supplies the latest update's animated head/hair/hat top centre plus 0.08 m. Local geometry bounds are prepared once for painted and legacy assets, including hat sockets. It follows actual sit, bow and tiptoe poses, and clears on cull/departure/dispose. Opacity-zero heads remain for caller-controlled first-person suppression.
- Door overlap recovery rechecks support before jumping/accelerating; a closed door can no longer push an avatar off a ledge and still allow a grounded jump.
- Flat-ground gait now keeps world-space stance contacts and solves the articulated legs against them. Stop recovery puts one foot home at a time; seat/tiptoe transitions preserve contact. Terrain height changes, placement corrections and hidden intervals rebase instead of stretching a leg. It has not yet been judged in a town clip.
- `CitizenRenderer.footfalls` contains only the latest update's actual gait touchdowns (`id`, `side`, world-space sole `position`). Consume synchronously after `update`; it is empty after discontinuities, entry or culling. `integration.patch` replaces the kingdom's independent 0.9 m audio clock with these contacts and retains the existing authority, placement, floor-material and mute guards. The patch is unapplied because kingdom is main-owned.
- Wardrobe save completions are fenced against authority replacement, external saved-look refresh and unmount. Canonical saves preserve newer local edits. Main must keep a person's `LookAuthority` reference stable and replace it when the authenticated person changes; the public display name is not an identity key. Phone save status is now visible, pending a new screenshot.

## needs: approved appearance projection and tools

`packages/shared/src/citizen-look.ts` and realm `watch.ts` currently admit only six starter IDs. `kingdom/walk-scene.ts`, `observed-walkers.ts`, and `citizen-scene.ts` all construct `createDefaultCitizenLooks()`. The builder's `LookAuthority` is an interface; it is not currently bound to these street appearances.

Main must expose an authenticated save/read authority and a public approved appearance projection keyed by opaque appearance ID, not by a private Twitch/person ID. Both room walkers and the stream's watcher projection must refer to that same ID. Server validation owns earned entitlements and subscription lapse; neither a client recipe nor a browser's local storage is evidence. Load the appearance once per version and replace prepared render data on approval, retaining the old renderer until the new one is ready. Every active look ID must be included (no dropping citizens while a recipe loads).

The content `CitizenLook` recipe has no persisted handheld tool field. Main must freeze a nullable allowed tool/keepsake ID plus eligibility, include it in the approved appearance, and bind the visual asset to the existing `gripRight` socket. The builder cannot safely invent a tool save key: `parseLook` rejects extra fields. No fake tool UI was added.

`integration.patch` is now one exact six-file main-owned consumer patch: walk-scene, observed walkers, citizen speech, scene orchestration, kingdom UI and stream UI. It consumes prepared appearances and the optional gesture port; binds gait audio; exposes actual camera distance and home slot on label projections; and replaces separate walker names/speech layers with `PeopleLabels` using actual animated head anchors. It deliberately does not fabricate an appearance projection or grant authority. `git apply --check` and `node apps/web/src/walk/check-integration.mjs` both pass: the latter typechecks the proposed source entirely in memory, without writing main-owned files. Apply/review on main; it is not runtime-verified integration. The stream still needs the same approved appearance mapping and authenticated current gesture projection.

## needs: authenticated transient gesture contract

Freeze a gesture request and present-tense projection in shared and implement in the realm and watcher feed. Proposed concrete wire shape (for main to approve):

```ts
// Authenticated room derives walkerId. The request cannot supply identity or earned items.
type GestureIntent = { version: 1; id: string; type: 'walker.gesture'; gesture: 'none' | 'wave' | 'bow' | 'cheer' | 'dance' | 'sit' | 'point' };
type GestureProjection = { walkerId: string; sequence: number; gesture: GestureIntent['gesture']; startedAt: number; expiresAt: number };
// Extend RealmTransientMessage with { type: 'gestures'; writerEpoch: string; gestures: readonly GestureProjection[] }.
```

Bound it to the authenticated session, room writer epoch, maximum six non-neutral selections per ten seconds, and the lane's gesture durations (sit remains until moving/stand/disconnect). Reject while seated in an authoritative place if the action would replace that seat. Clear sit/dance on actual movement and clear all on departure/moderation/disconnect. Send current unexpired projections on bootstrap/reconnect and watcher checkpoints without replaying historic gestures. Include `none` cancellation and sequence order. The client maps server epoch times to its monotonic clock; it must not compare Unix time directly with `performance.now()`.

Local animation may anticipate a sent gesture, but all other browsers and stream see only approved current projections. Transport loss clears local state and draws no false success. Speech remains Twitch witnessed `CitizenChatCue`, including removal/clear; gestures must not send chat or bypass Twitch moderation.

## needs: terrain contact and soft-push authority

Founded movement collides with 0.5 m SolidBox columns (`packages/world/src/founded-world/collision.ts`), while the actual town draws smoothed triangles (`kingdom/terrain-worker.ts`). The lane can ease a step but cannot make soles meet a different visible surface. Freeze a shared terrain-support sampling convention used by visible terrain and movement. Thin slabs, bounded stair ascent/descent, landing support and doorway headroom already exist in `movement/collide.ts` and `step.test.ts`; preserve them and deterministic prediction/replay rather than rebuilding them.

Walkers currently have no neighbour query in the movement contract. Freeze a bounded neighbour sample for continuous avatar soft-push, applied identically to client/server steps; keep doors un-blockable after 0.6 s of pressing, and never displace a body into world solids. Existing collision-safe separation during world adoption/recovery (`realm/founded/anchors.ts`, `persistence/kingdom.ts`) must remain; that safeguard is distinct from continuous walking soft push. Do not implement divergent browser-only forces or falsify public stream positions to hide overlaps.

## needs: choose the authenticated person's owned door at entry

Real OIDC sign-in, authenticated single-use entry tickets and SDK admission already exist in `api/realm-auth/service.ts`, `realm/auth/authenticator.ts` and the opt-in Postgres auth integration tests. The missing behavior is owned-door spawn selection: `realm/founded/provider.ts` currently ignores the `principal` in `spawn(_principal, arrival)` and chooses `anchors[arrival]` in the market. Fresh join uses that spawn in `realm/kingdom-room.ts`; session replacement correctly preserves a safe carried pose.

Main must use the authenticated principal's current deed and the installed home's actual doorway to choose a collision-validated supported egress point, with an explicit safe visitor fallback. Do not derive a private deed from a public slot or modify the generic arrival anchor list to pretend ownership. Preserve replacement/recovery semantics. The lane cannot apply this change because both the deed authority and provider are read-only here.

## Existing stream and speech paths; remaining binding needs

The stream already receives real same-room walker frames from `realm/bootstrap/watch.ts`, interpolates/draws them through `kingdom/observed-walkers.ts`, and supplies slot-linked walker feet to camera subjects. Room and observed-walker tests cover movement, interpolation, placement and stale/revision clearing. This is real implementation evidence, but no watched town/stream capture has yet shown the required arrival at the square; the current director follows presence/chat events rather than a dedicated walking-arrival event.

Twitch-witnessed speech, emote images, remove and clear are already wired through `realm/adapters/chat.ts`, `kingdom/citizen-scene.ts`, the web and stream. Slot-linked speech follows walking feet. Walkers without home slots are excluded from this association. The scene still emits walker names separately from speech until main applies the reviewed `PeopleLabels` producer/consumer patch. Main must also associate guest speech with its real walker without inventing a home. Keep the existing moderation-removal path.

## Acceptance still required

- Sign in as a real identity, spawn at the owned door, save clothing and see the same clothes in another client and the public stream.
- Three connected people traverse the full founded terrain, stairs and doors, greet, gather/part, and speak with deletion/clear respected.
- Web 1440×900 and 390×844, stream 1920×1080 and 1280×720 stills; short watched clips of the actual town. The lane's SIMULATED component review is not this proof.
- Real GPU/device check for frame pacing and cloth contact. SwiftShader cannot establish performance.

## SDK correction test history — resolved by main's revised test

The unchanged `apps/web/src/walk/realm-predict.test.ts` case `keeps the moving camera on SDK render feet through a real acknowledged correction above the fixed-step rate` failed again in the aggregate and isolated checks. Aggregate render delta was 0.23037076 m against a 0.167983756 m frame bound; isolated delta was 0.0973500264 m against 0.094083348 m. This assertion has failed in three observed runs across the two checkpoints, though an earlier isolated run passed. No tolerance was relaxed and no third current-turn retry was made.

This test directly adds 0.24 m to the exact `client.predicted.x`, then samples the SDK render value while real acknowledgements arrive. That could expose injected drift before the first correcting acknowledgement as well as the subsequent reconcile. Main commit `e2512e1` now waits for acknowledged actual movement and excludes the artificial injection interval without changing the frame bound, camera-anchor checks or all-field parity. After sync, all six real-room SDK cases passed in isolation and again in the full 177-test lane set. The earlier failure is retained as history, **not an active blocker or a proven production reconciler defect**.

## Full-town diagnostic and capture readiness

`node apps/web/src/walk/check-town.mjs` compiles all 659 native founded placements and uses the production movement step for three separate supported spawns. Forward, reverse and idle samples passed without entering solids or losing support; each travelled 2.51347 m. This is CPU collision evidence only. Compilation took about 83 seconds on this host.

`capture-town.mjs` is a prepared three-SDK-connection capture runner for the actual Kingdom component and the same complete collision world. It uses memory-only SIMULATED identities and single-use reference tickets, with no persisted ownership claim, approved wardrobe projection or gesture transport. It takes one still or three-second real-time clip per shared capture lock. Its runtime has **not yet completed verification**. Component captures now work with `--offline`: static build bytes are routed inside Chrome and no listener is used. A later read-only probe found safe port 5171 free; the new town `--offline` mode needs only one allowed port for the actual temporary realm. It allows only that owned realm origin through request routing. No existing service or reserved port was used.

## needs: shared capture queue ticket recovery

Three current jobs (desktop wardrobe 16064, phone detail 11635, one-port town 77952) each logged lane queue registration and were re-polled live. A fresh authoritative directory read then found zero `.json` tickets under `/tmp/chatdom-capture.lock.queue`. The shared supervisor retains `ticket` after registration but has no missing-ticket recovery; with no own entry it cannot become `head`. All three stranded jobs were intentionally canceled and returned exit 130. Main commit `91bf5ad` records the same condition from Chronicle, but contains no helper fix. Main owns `packages/testing/capture-lock.mjs`: repair and test missing-ticket recovery and PID namespace assumptions without weakening mutual exclusion. The lane touched no other process, registry entry or lock file. Stop retries until the helper changes; all lane capture handles are terminal.
