# WT10 integration seams — 2026-11-01

WT10 remains unchecked. This lane can build movement, wardrobe rendering, controls and gestures, but its PRD makes kingdom, stream, shared contracts, realm and API read-only. The following gaps were found in the real consumers, not inferred from a bench. Main must freeze/bind these seams before end-to-end acceptance. No code outside lane scope was changed.

## Ready lane work

- `createWornCitizenLook(id, authorizedRecipe, subLapsed)` preserves the builder's full-body recipe and exact cloth dyes, while only subscription pieces dim after lapse. It does not grant eligibility.
- `CitizenSample.gesture` supports `none | nod | wave | bow | cheer | dance | sit | point`, with distance-driven walking under upper-body gestures and shortest-arc turning.
- `WalkControllerOptions.gestures` accepts an authenticated port: `available()`, `publish(gesture)`, `sample(walkerId, monotonicNow)`. The controller mounts the selector only when this port exists, clears on ownership loss/disconnect/hidden page, and exposes `gestureFor(id, now)` for rendering. No invented room messages are sent.
- `layoutWalkLabels` accepts measured names/bubbles and HUD rectangles, prioritizes active speech, bounds labels to the screen, and avoids overlap without detaching text from the actual head. Bind it once across walker labels and crowd bubbles, in web and stream, rather than running separate layouts.
- Door overlap recovery rechecks support before jumping/accelerating; a closed door can no longer push an avatar off a ledge and still allow a grounded jump.
- Flat-ground gait now keeps world-space stance contacts and solves the articulated legs against them. Stop recovery puts one foot home at a time; seat/tiptoe transitions preserve contact. Terrain height changes, placement corrections and hidden intervals rebase instead of stretching a leg. It has not yet been judged in a town clip.
- `CitizenRenderer.footfalls` contains only the latest update's actual gait touchdowns (`id`, `side`, world-space sole `position`). Consume synchronously after `update`; it is empty after discontinuities, entry or culling. `integration.patch` replaces the kingdom's independent 0.9 m audio clock with these contacts and retains the existing authority, placement, floor-material and mute guards. The patch is unapplied because kingdom is main-owned.
- Wardrobe save completions are fenced against authority replacement, external saved-look refresh and unmount. Canonical saves preserve newer local edits. Main must keep a person's `LookAuthority` reference stable and replace it when the authenticated person changes; the public display name is not an identity key. Phone save status is now visible, pending a new screenshot.

## needs: approved appearance projection and tools

`packages/shared/src/citizen-look.ts` and realm `watch.ts` currently admit only six starter IDs. `kingdom/walk-scene.ts`, `observed-walkers.ts`, and `citizen-scene.ts` all construct `createDefaultCitizenLooks()`. The builder's `LookAuthority` is an interface; it is not currently bound to these street appearances.

Main must expose an authenticated save/read authority and a public approved appearance projection keyed by opaque appearance ID, not by a private Twitch/person ID. Both room walkers and the stream's watcher projection must refer to that same ID. Server validation owns earned entitlements and subscription lapse; neither a client recipe nor a browser's local storage is evidence. Load the appearance once per version and replace prepared render data on approval, retaining the old renderer until the new one is ready. Every active look ID must be included (no dropping citizens while a recipe loads).

The content `CitizenLook` recipe has no persisted handheld tool field. Main must freeze a nullable allowed tool/keepsake ID plus eligibility, include it in the approved appearance, and bind the visual asset to the existing `gripRight` socket. The builder cannot safely invent a tool save key: `parseLook` rejects extra fields. No fake tool UI was added.

`integration.patch` is the exact optional consumer patch for the current `kingdom/walk-scene.ts`; it consumes prepared appearances and the gesture port and passes gestures to the runtime. It deliberately does not fabricate a projection or grant authority. Apply on main when supplying those ports. The read-only stream must consume the same approved appearance mapping and current gesture projection.

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

Founded movement collides with 0.5 m SolidBox columns (`packages/world/src/founded-world/collision.ts`), while the actual town draws smoothed triangles (`kingdom/terrain-worker.ts`). The lane can ease a step but cannot make soles meet a different visible surface. Freeze a shared terrain-support sampling convention used by visible terrain and movement, including thin slabs and stair landing support. Preserve deterministic prediction/replay.

Walkers currently have no neighbour query in the movement contract. Freeze a bounded neighbour sample for avatar soft-push, applied identically to client/server steps; keep doors un-blockable after 0.6 s of pressing, and never displace a body into world solids. Do not implement divergent browser-only forces or falsify public stream positions to hide overlaps.

## Acceptance still required

- Sign in as a real identity, spawn at the owned door, save clothing and see the same clothes in another client and the public stream.
- Three connected people traverse the full founded terrain, stairs and doors, greet, gather/part, and speak with deletion/clear respected.
- Web 1440×900 and 390×844, stream 1920×1080 and 1280×720 stills; short watched clips of the actual town. The lane's SIMULATED component review is not this proof.
- Real GPU/device check for frame pacing and cloth contact. SwiftShader cannot establish performance.

## needs: isolate the existing SDK correction regression

The unchanged `apps/web/src/walk/realm-predict.test.ts` case `keeps the moving camera on SDK render feet through a real acknowledged correction above the fixed-step rate` failed again in the aggregate and isolated checks. Aggregate render delta was 0.23037076 m against a 0.167983756 m frame bound; isolated delta was 0.0973500264 m against 0.094083348 m. This assertion has failed in three observed runs across the two checkpoints, though an earlier isolated run passed. No tolerance was relaxed and no third current-turn retry was made.

This test directly adds 0.24 m to the exact `client.predicted.x`, then samples the SDK render value while real acknowledgements arrive. That can expose the injected drift before the first correcting acknowledgement as well as the subsequent reconcile. Read-only SDK inspection shows live `snapshotPrev()` reads the mutated local state plus error. Therefore the failing assertion establishes an unresolved test/path regression, not yet a proven production reconciler defect. Main owns `apps/web/src/realm/client.ts` and the SDK patch. Instrument the acknowledgement/reconcile boundaries and distinguish pre-ack injection from correction before choosing a fix; retain the camera-anchor and all-field parity checks. Logs are copied into this lane's evidence directory.

## Full-town diagnostic and capture readiness

`node apps/web/src/walk/check-town.mjs` compiles all 659 native founded placements and uses the production movement step for three separate supported spawns. Forward, reverse and idle samples passed without entering solids or losing support; each travelled 2.51347 m. This is CPU collision evidence only. Compilation took about 83 seconds on this host.

`capture-town.mjs` is a prepared, **unexecuted** three-SDK-connection capture runner for the actual Kingdom component and the same complete collision world. It uses memory-only SIMULATED identities and single-use reference tickets, with no persisted ownership claim, approved wardrobe projection or gesture transport. It takes one still or three-second real-time clip per shared capture lock. It is linted and reviewed, but runtime readiness is not established. Two existing component capture attempts ended with no allowed free port; a separate read-only probe found every allowed capture port occupied. No existing service was stopped or alternate reserved port used. Resume capture only after capacity changes.
