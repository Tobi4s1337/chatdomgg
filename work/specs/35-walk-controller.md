# Spec 35: Walk into the kingdom

Status: **frozen 2026-10-30.** Start after main commits the handoff and creates the lane branch/worktree.
Vision: `chatdom/ChatDom.md` principles 8, 12, 17–18; `chatdom/Tech.md` §§8.2, 9.5;
`chatdom/Quality.md` rules 2–5, 9; `chatdom/Artstyle-Soul-Feel.md` §§6, 10, 13 and Decided.

## What and why

A citizen enters at street level and immediately knows how to walk. WASD, a sprint and a jump feel as direct
and dependable as Minecraft's controls; the places have Trove's invitation to explore and Townscaper's warmth.
The kingdom keeps its own crafted voxel art direction. A shoulder view leaves room to see the street, and the
wheel brings you naturally into first person. A roof, fence or forged chimney is solid for both feet and camera.
The cursor remains useful for the kingdom's menus. Moving never requires a held mouse button.
This lane owns the feel and the shared movement solver, consuming the actual places and collision data supplied
by their owners. Its result is demonstrated walking the kingdom, with another connected browser, rather than
only moving a box around a physics bench.

## Current state

- `packages/shared/src/realm/movement.ts:3` defines protocol 1, `WALK_HZ = 30`, `REALM_PATCH_MS = 200`,
  `WALK_BUTTON`, `WALK_BODY`, `WalkInput`, `PlayerState`, `PLAYER_FIELDS`, `SolidBox`, `CollisionWorld`,
  `PlayerStep` and `sanitizeWalkInput`. `WALK_BODY` is radius .28 m, height 1.75 m and maximum step .5 m.
- `packages/shared/src/realm/schema.ts:4` defines `WalkInputSchema`, `WalkerSchema` and `KingdomRoomState`.
  Movement uses float64 state and signed-byte direction components. Colyseus owns sequence/ack/time.
- `packages/world/src/movement/step.ts` exports `stepPlayer`. Main's reference already normalizes diagonals,
  integrates jump/gravity and sweeps Y/X/Z against solid boxes. It deliberately leaves full supported auto-step,
  simultaneous-contact handling and overlap recovery to this lane. Preserve its exact exported signature.
- `packages/world/src/realm/reference.ts` exports `REFERENCE_BLOCKS` and `REFERENCE_WORLD`, an explicitly
  SIMULATED court. It is not founded kingdom geometry and is read-only for this lane.
- `apps/web/src/realm/client.ts` and `apps/web/src/realm-reference/**` implement the real Colyseus boundary
  under spec 33. `connectRealm(endpoint, entry, world, storage?)` returns a `RealmClient`; `RealmEntry` supplies
  kingdom ID, the API session's stable `resumeScope` and a lazy single-use `ticket()` factory. Its
  `tick(now, input)` stages Predict's due fixed inputs and returns render poses. Its jump edge is latched until
  the first due send. Main demonstrated three real SDK clients and three Playwright browsers moving and
  reloading, with full `pnpm verify` green. The WC06 movement/Predict/input-staging grant below is effective;
  auth, join, reconnect, storage and transport remain main's boundary.
- `apps/web/src/kingdom/scene.ts` currently composes the real kingdom, build and Forge cameras. Its composition
  calls belong to the team integrator. Realm wiring supplies the versioned, complete kingdom collision adapter.
  `apps/web/src/realm-reference/index.tsx` is a useful connection check, not the final walking experience.

## Rules

1. **R1 — One movement law.** Client prediction and authoritative room simulation call the same
   `stepPlayer(state, input, dt, world)` at 30 Hz. Preserve the `PlayerStep` signature. No renderer, camera,
   clock, randomness, runtime trigonometry, hidden mutable solver history or client-controlled delta-time enters
   the shared step. State plus input plus immutable collision revision fully determine the next state. Specify
   numeric tolerances and stable contact/tie ordering; retain main's Y/X/Z tie policy unless a tested change is
   recorded in Decisions and reviewed by main.
2. **R2 — Familiar movement.** WASD is camera relative; Shift sprints; Space presses jump. Convert camera yaw
   into world direction in the client input layer, then quantize to integers in [-127,127]. Use `WALK_BUTTON`
   bits and the shared sanitizer. Clamp diagonal speed. The avatar faces its actual intended walk direction,
   not the camera whenever idle. Start from the reference 4 m/s walk, 7 m/s sprint and 6.8 m/s jump impulse;
   tune gentle acceleration and quick stops in the one shared step and record the chosen constants. No duplicate
   client physics tuning. `distance` accumulates actual horizontal travel, including sliding but excluding a
   penetration correction or visual easing, so the existing gait stays grounded.
3. **R3 — A press means one jump.** The input layer emits a jump pulse on a fresh Space keydown, ignoring repeat.
   Main's client latches that pulse until the first due fixed input and strips it from further inputs in an
   `n > 1` frame. A held key never produces repeated jumps. The pure step accepts it only while grounded; an
   airborne pulse is discarded. Blur, hidden document, menu takeover and disconnect clear held input and pending
   pulses. A released key must not leave walking or sprint stuck on. No extra shared history field is needed.
4. **R4 — Solid places.** Sweep the complete body volume through movement, slide along contacts and terminate
   with a documented finite iteration bound, including zero-time/corner hits. Never tunnel through a thin solid
   at sprint speed or a catch-up tick. Use the same `CollisionWorld.query` for terrain, structures, walls,
   roofs, fences, furniture, props, trees, placed/forged parts and closed doors. Real carves, openings and open
   doors are resolved by the supplied adapter, not render mesh guesses. Glass is solid. Collision never depends
   on render, shadow or distance LOD. Unknown space blocks; missing/mismatched collision revisions never become
   empty space. Deterministic overlap recovery must handle a bad spawn or changed solid with bounded search
   and no teleport through a wall; if no valid result exists, retain a finite stopped state and let the frozen
   adapter request authority recovery. `PlayerStep` returns void: if the existing adapter cannot identify this
   case, record `needs:` for main rather than inventing a return type or shared recovery message.
5. **R5 — A supported half-metre step.** Auto-step only when grounded and horizontally obstructed. Trial upward
   clearance, the remaining horizontal sweep and downward support before committing. Reject heights above .5 m,
   low ceilings, insufficient progress, unsupported/narrow landings and grazing paths that would climb sideways.
   Failed trials retain the ordinary slide. Never use stepping as a second airborne jump. Smooth the rendered
   vertical step independently of authoritative body collision; smoothing cannot hide the body inside geometry.
6. **R6 — A composed player camera.** Entry is third person, with the citizen in the lower-left third and the
   street open ahead. Use `THREE.PerspectiveCamera.filmOffset` for horizontal composition, preserving a coherent
   aim direction; demonstrate avatar placement in actual projected pixels at both aspect ratios. Do not fake
   framing by rotating the body or steering the walk sideways. The wheel continuously reaches first person
   and returns, with no mode button, jump cut or stuck minimum boom distance. Blend film offset toward zero,
   keep the local head/body from filling the view and restore its visibility on zoom out. Apply wheel delta
   modes and bounds; UI scrolling must not also zoom the world. Keep the horizon level. Time-based smoothing
   follows rendering time, never the shared solver. Auto-follow may return behind travel after 1.5 s without
   manual orbit; it must not fight active look or menus.
7. **R7 — Camera collision is immediate.** Query the supplied solid world for a conservative swept boom and
   near-plane footprint at the actual aspect/FOV, including shoulder offset. A center ray alone is insufficient.
   Clamp inward before drawing the very first obstructed frame, including a newly published wall or changed
   revision; ease outward over about .35 s only after clearance. Keep desired wheel distance separate from the
   temporary occlusion distance. A minimum distance never overrides clearance. Test roofs, corners, thin posts,
   doorways and first-person wall approach; neither camera nor near plane enters a solid. A claimed fade path
   must actually make the obstruction safe to see through; otherwise pull in conservatively. This lane does
   not add a separate partial terrain-only collision list.
8. **R8 — Cursor, capture and fallback.** Free cursor is default, with automatic follow and optional orbit drag.
   E is reserved for interactions and must not orbit the camera. V or another deliberately labelled play
   gesture may opt into mouse look; Escape releases immediately.
   A menu gets a usable cursor and owns its pointer/keyboard events. Movement itself requires no held mouse.
   Discard non-finite look deltas, ignore the first 120 ms after pointer lock, discard any event with either
   absolute delta >250 px, and clamp other per-event deltas to ±100 px. Bound pitch, wrap yaw and accumulate
   valid events across slow frames instead of losing them. Pointer-lock rejection uses a bounded drag fallback;
   it never switches fallback on merely because somebody flicked fast. Clear drag/capture on lost pointer-up,
   blur, unlock and successful re-lock. Editable fields never trigger walking or game shortcuts. Preserve the
   under-8-px/under-300-ms click-versus-drag distinction for the interaction owner.
9. **R9 — Predict stays Colyseus.** Use the frozen main adapter's `Predict` setup, `PLAYER_FIELDS`, reliable input
   handle and fixed-step staging. Render frames stage exactly the count returned by `predict.tick(now)`;
   render poses use Predict's values. Preserve position, velocity, grounded, yaw, distance and collision revision
   reconciliation. Use `smoothMs`, not an invented smoothing option. No custom input queues with their own
   sequence/ack/replay system. A revision transition must not replay old inputs against silently replaced solids:
   hold unsafe prediction, use the real matching immutable revision, or adopt the authoritative state under the
   frozen adapter's reset policy. Demonstrate recovery without walking through the changed wall.
10. **R10 — Useful on the phone.** Owned touch input offers a left thumb movement joystick and separate orbit/
    pinch regions; it does not swallow UI taps or require a keyboard. Coordinate its physical regions with the
    interaction owner's actions. Resize/orientation changes preserve framing and safe camera collision. This
    brief does not transfer gamepad targeting or click-to-walk pathfinding from their owners.
11. **R11 — Integrate without annexing.** Supply lifecycle, per-frame, resize, input ownership and camera takeover/
    return recipes with exact exports from the implemented modules. The integrator alone changes scene call
    sites, existing camera composition, root routing and adjacent owners' hunks. Build/Forge/director takeover
    releases the player camera cleanly and returns to a usable walking state. A bench can diagnose; final
    acceptance must use the actual kingdom walk path and supplied complete collision adapter.
12. **R12 — Keep the change focused.** Consume the places, materials, avatar/gait and realm services that exist.
    Do not build another town, crowd system or network benchmark. Keep any affected geometry attributes aligned
    to four-byte vertex boundaries, cap point sprites in pixels, and retain shadow LOD if those mechanisms are
    touched by owned code; do not expand this lane into a renderer audit. Synthetic identities/data are visibly
    SIMULATED. Actual 300-client input/authority load proof belongs to realm-server, not this lane's local bench.

## Contracts

Consume `@chatdom/shared/realm`: `WalkInput`, `PlayerState`, `PlayerStep`, `CollisionWorld`, `SolidBox`,
`WALK_HZ`, `WALK_BODY`, `WALK_BUTTON`, `PLAYER_FIELDS` and `sanitizeWalkInput`; consume the frozen movement
schemas without edits. The step mutates only its supplied `PlayerState`; input and returned solids stay read-only.
`PlayerState` positions are feet in world metres, velocities are metres/second and yaw is a byte, not radians.
Direction is already world relative. Camera trigonometry happens only before quantization in browser input.

Preserve `packages/world/src/movement/step.ts`'s exported `stepPlayer`, exposed by `@chatdom/world/movement`.
The read-only court is exposed by `@chatdom/world/realm-reference`. Browser camera and input modules are
lane-local exports under `apps/web/src/walk/**`; document their
actual implemented signatures in `apps/web/src/walk/README.md`, including dispose/reset and takeover ownership.
These are implementation seams, not permission to create new shared protocol fields.

Realm wiring owns the production `CollisionWorld` producer, publication/revision lifetime and authority bootstrap.
The lane reads each immutable revision and supplies bounds in world metres. If geometry, revision delivery or
the adapter's recovery policy is insufficient, record `needs:` with the exact failing case; never replace unknown
cells with air. Main/realm-server owns authoritative spawn/recovery and validates all request identity.

## Scope

Write: `packages/world/src/movement/**`, `apps/web/src/walk/**`, this spec, and
`work/lanes/walk-controller/{PRD.md,progress.txt}`. Tests, a compact Playwright capture script and README live
inside those owned folders. Screenshots: `shots/walk/**`; selected evidence: `work/evidence/walk-controller/**`.

**Effective WC06 grant, 2026-10-30:** main transfers the movement-step/Predict collision-revision and input-staging
hunks of `apps/web/src/realm/client.ts` to this lane. This includes the `stepPlayer` binding, movement reconciler,
matching collision-world selection and fixed-step jump/input staging. Auth, join, reconnect, storage/tokens,
transport and public-delivery changes remain read-only and main-owned. This is an explicit responsibility grant,
not ownership of the entire file; preserve adjacent main code.

Read-only: `packages/shared/**`, package exports/manifests/lockfiles, `apps/realm/**`, realm-reference, the
reference collision world, kingdom scene/index, build/Forge/director, citizens, renderer and content. The team
integrator applies scene composition calls. You are not alone; preserve other owners' changes and serialize
edits to the granted client hunks. Sub-agents have disjoint write sets and never run git.

## Acceptance

The reference room/client and movement exports are frozen and demonstrated, and main has granted WC06.
Realm wiring owns the production collision adapter. Start after main commits this frozen handoff and creates
the branch/worktree; independent camera, input and solver work need not wait for production scene binding.

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/world/src/movement apps/web/src/walk
pnpm build
node apps/web/src/walk/capture.mjs --base-url http://127.0.0.1:5190
```

WC01 introduces that capture script; it must target the integrator's actual kingdom walk entry and fail explicitly
if that binding or the real realm service is absent. Record the precise tested URL and owner-supplied realm start
command in the README when they exist; do not manufacture service commands or accept a fallback bench as success.
Final integration additionally runs **`pnpm verify`**. Scoped checks are never reported as the full verification.

Meaningful solver tests cover matched executions for a fixed input recording; normalized diagonal/sprint travel;
gravity, one grounded jump and no held repeat; thin walls, corner ties and finite termination; exact .5 m step
versus too high; headroom, grazing, failed trial and supported landing; embedded start and revision mismatch.
Camera/input tests cover an inserted occluder on the first frame, near-plane corners at both aspects, outward
recovery independent of wheel intent, continuous first person, menu/blur release, lock warp thresholds and a
successful re-lock after rejected lock. Do not create tests that merely mirror constants or a second physics law.

Browser checks use two real connected browsers to walk the same place. Exercise WASD/sprint/jump, slow-render
fixed-step staging, collision-revision publication, camera obstruction, wheel in/out, menu entry/exit, drag fallback
and build/Forge camera return. Inspect actual authoritative final positions as well as the picture. Reuse the
room and loaded scene; the realm-server lane owns 300 bots and network capacity measurements.

Take **one or two relevant actual-walk views at 1440×900 and 390×844**: a normal street shoulder pose and, if
needed, the tight doorway/roof or first-person view that best proves this change. Thus two to four final PNGs,
not a large noon/night/camera cross-product. Acquire `packages/testing/capture-lock.mjs` before browser startup;
reuse `--base-url`, await meaningful rendered readiness and settled lighting, fail console/page/shader errors,
use Chrome/SwiftShader, and stop only processes you own. Open each required PNG with `view_image` via `$look`.
The normal shoulder shot must visibly show the actual citizen in the lower-left third with useful world ahead;
a reference-court screenshot alone does not pass. Keep truthful SIMULATED provenance on practice sessions.

The normal-GPU owner handoff states the URL, both sizes and a short manual route: start/stop, sprint turn, jump,
.5 m step, doorway under a roof, lock/unlock/re-lock after a fast flick, wheel into/out of first person and menu
return. Ask Tobias to judge responsiveness, camera calm, multi-monitor pointer behavior and foot contact.
SwiftShader proves behavior/pixels, not GPU frame timing or final movement feel; record that remaining doubt.

## Quality bar

Walking feels familiar immediately. Quick stops do not become ice skating; acceleration does not feel like lag.
Steps do not jerk the camera. The citizen is small enough for the kingdom to feel large, readable enough to
belong there, and never reduced to a giant head. The town retains its warm, handmade materials and depth.
Walls and roofs remain solid under camera movement, live changes and low render rates. A menu never strands
the cursor or leaves a walking key stuck. Real shared movement, real realm prediction and real kingdom collision
must all be present in the final demonstration. The view and manual feel carry more weight than a diagnostic
counter or a green isolated bench.

## References

- `work/references/walking-voxel-worlds.md`: Voxelize's bounded sweep/slide and supported step trials; HYTOPIA's
  boom/film-offset lessons with stronger near-plane safety; time-based presentation easing and pointer-lock
  warp handling. Its prototype shoulder offset was explicitly not sufficient framing proof.
- `work/references/colyseus-realm.md`: exact release APIs for Predict, fixed-step input count, `smoothMs`, full
  state reconciliation and reconnect. No application ack/replay layer. Prior join/write counts do not prove
  the actual predicted 300-walker path.
- `work/specs/33-realm.md`: the frozen authoritative room and executable movement/client boundary.

Technique adaptation is welcome. Copied permissive source keeps its notice/header; ask main to record the
specific source/license in `THIRD_PARTY.md`, which this lane does not own. No copied prototype wholesale.

## Not now

Owned elsewhere: kingdom/place construction, collision-data publication, persistent authority/auth, 300-bot
load testing, crowd soft-push/pathfinding, interaction targets and click-to-walk, gamepad targeting, build mode's
editor rig, director policy, interior cutaway art, renderer-wide performance repairs and production deployment.
These ownership boundaries do not excuse a broken walking/camera experience on the places supplied to this lane.

## Decisions

- **2026-10-30 — Executable boundary frozen and client scope transferred.** Main demonstrated the real reference
  room/client with three SDK clients and three Playwright browsers moving/reloading; full verification passed.
  The lane extends the shared solver without changing its signature and owns the explicitly granted WC06
  movement/Predict/revision/input-staging hunks now. Auth/join/reconnect/storage remain read-only. Integrator
  alone composes kingdom scene calls. Start follows main's handoff commit and branch/worktree creation.
- **2026-10-30 — Current realm contract governs simulation.** Use 30 Hz, 5 Hz schema patches and `WALK_BODY`
  from shared. These supersede Tech's older client-authoritative 60 Hz, transform-relay and body-size examples.
- **2026-10-30 — Requested shoulder view governs placement.** Lower-left-third third person and seamless wheel
  first person supersede Tech's older centred 7 m example. The free cursor remains the default; capture is opt-in.
- **2026-10-30 — Jump is a fixed-input press pulse.** Main agreed to latch it until the first due input and
  remove it from subsequent inputs in the same frame; input emits keydown pulses rather than held jump bits.
- **2026-10-30 — E belongs to interactions.** Latest brief reserves E for the interaction owner. Camera orbit
  uses drag; optional pointer lock remains available. Do not bind Q/E orbit from the older Tech example.
- **2026-10-30 — Focus the demonstration.** A few actual walking frames and meaningful movement/occlusion flows
  are required. A new proof project or a repeated large screenshot matrix is not the deliverable.
- **2026-10-30 — WC02 solver: vertical first, then swept horizontal time of impact (tie-order change for main's
  review).** Main's Y sweep stays first, so floor seams never read as walls. X and Z are no longer separate axis
  sweeps: `slideHorizontal` (`packages/world/src/movement/collide.ts`) finds the whole body's earliest contact over
  the diagonal travel, snaps the blocked axis to the solid's face and lets the other axis keep only its own
  remaining travel (never re-normalized, so a wall slide cannot gain speed). One solid blocks the axis that entered
  last, X before Z on an exact tie; solids met at the same instant block together. Separate X-then-Z sweeps made a
  convex corner resolve differently for mirrored approaches; the swept version is mirror-symmetric, tested, and
  independent of `query` order. Each pass blocks an axis or finishes, so `SLIDE_PASSES = 3` always terminates,
  zero-time inside-corner hits included. `CONTACT_EPSILON = 1e-9` m: faces closer than that touch, never overlap.
- **2026-10-30 — WC02 support and determinism.** `grounded` is read at the end of the tick (`vy <= 0` and a solid
  top within `SUPPORT_PROBE = 1e-6` m under the footprint), so walking off a ledge is airborne at once and a jump
  is only accepted from real support. `Math.hypot` became `Math.sqrt` of exact sums: sqrt is correctly rounded
  everywhere, hypot is not specified to be, and Node and browsers must agree bit for bit. `distance` adds the
  horizontal displacement of the slide only.
- **2026-10-30 — WC02 overlap recovery and its seam.** Before moving, a body inside solids by more than the contact
  tolerance is pushed out along one of six axis directions, just far enough to clear every solid it is inside,
  within `RECOVERY_REACH = 1` m, and only if the swept path touches no solid it was not already inside (no push
  through a neighbouring wall). Shortest valid push wins; ties go up, -X, +X, -Z, +Z, down. The push is not walked
  distance. If nothing qualifies the step zeroes velocity and holds the body still, deterministically on both ends.
  `PlayerStep` stays void; `@chatdom/world/movement` exports `bodyStuck(state, world)` and `embeddedSolids` so the
  room can see the case. The frozen room never asks for a placement after a step, and `RealmRoomHandle` has no
  recovery request port, so that is recorded as a `needs:` for main/realm-server rather than a new return type.
