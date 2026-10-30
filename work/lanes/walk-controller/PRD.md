# Lane walk-controller

Spec: `work/specs/35-walk-controller.md` · Branch: `lane/walk-controller`
Status: **frozen 2026-10-30.**
Scope: `packages/world/src/movement/**`, `apps/web/src/walk/**`, the explicitly transferred movement/Predict
portion of `apps/web/src/realm/client.ts`, this spec/PRD/progress.
Worker: `gpt-6-astra`, **xhigh** for the core solver; camera/input polish may delegate to `gpt-6.1-terra`, **high**.
Read `AGENTS.md`, `$ralph-lane`, `$chatdom-vision`, `$look`, spec 33 and both cited reference notes.

**Start:** after main commits this handoff and creates the branch/worktree. Main has frozen and demonstrated the
actual shared step and real room/client; three SDK clients and three Playwright browsers moved/reloaded and
full verification passed. Main grants WC06's movement/Predict/collision-revision/input-staging client hunks now;
auth/join/reconnect/storage remain read-only. Scene composition belongs to the integrator; realm wiring
owns complete production collision data. No scene.ts edits, adjacent-owner hunks, shared changes, custom netcode
or replacement town. Preserve other owners' changes. A missing seam is `needs:` while independent work proceeds.

Every task is done when `pnpm typecheck`, `pnpm lint`,
`pnpm exec vitest run packages/world/src/movement apps/web/src/walk` and `pnpm build` pass; changed visible
behavior is captured at 1440×900 and 390×844 and looked at with `view_image`; its box is ticked; one progress
line records checks, exact URL/shot paths, needs and doubts; and one coherent local lane commit exists.
Pure solver tasks use meaningful tests and reuse an unchanged relevant shot instead of generating redundant
images. Final completion requires the real kingdom binding and integrated `pnpm verify`, not only isolated green
checks. Sub-agents never run git; the worker commits only its lane, never pushes. Integrator reviews/merges.

**Disjoint parallel work:** solver work owns movement/**; input owns walk/input/**;
camera owns walk/camera/**. One owner writes walk/index.ts, README and capture script. Serialize WC02→WC03 in
the solver. WC04 and WC05 can proceed independently in their folders. WC06 owns only the granted client hunks,
after main has stopped editing them. The integrator alone calls those modules from kingdom scene/index.

## Tasks

- [x] **WC01 — Put the player camera on a real citizen early.** Create the owned controller entry/lifecycle,
  separate input/camera modules and exact integrator recipe using actual frozen realm render poses. Deliver a
  first camera-relative WASD and shoulder view with free cursor, film offset and dispose/reset behavior. Add a
  compact capture script and README with truthful ready/error checks and the actual entry URL. Ask integrator
  to bind it to the kingdom; record an explicit integration need if unavailable. Do not add a fake kingdom route
  or claim the reference court is the final surface. · evidence: first looked desktop/phone walking pose after
  binding, or clearly marked pending binding plus working module tests; exact integration recipe.
- [ ] **WC02 — Make sweep and slide dependable.** Extend the exact shared step with bounded collision travel,
  deterministic simultaneous contacts and support handling. Prevent thin-wall tunnelling, corner snag loops and
  diagonal speed gain. Add bounded embedded-body recovery and use the frozen adapter's recovery policy;
  an insufficient recovery seam becomes `needs:`, never a new return type. Keep distance tied to actual
  horizontal travel. · evidence: meaningful
  deterministic recording, thin-wall/corner/embedded/mismatch tests; observed real supplied wall collision.
- [ ] **WC03 — Walk half-metre steps and jump once.** Add supported .5 m auto-step trials with headroom,
  horizontal progress and final support checks; retain slide on rejection. Tune shared acceleration/quick stops,
  sprint and grounded jump, document chosen constants and smooth rendered step height separately. No airborne
  climbing or repeated held jump. · evidence: exact-height/too-high/ceiling/grazing/narrow-landing tests; keyboard
  walk/sprint/one-jump route with matching gait distance and safe feet in the real kingdom.
- [ ] **WC04 — Keep every input under control.** Complete keyboard event ownership, camera-relative byte
  quantization, jump pulse, drag orbit, optional labelled lock, wheel and phone thumb/orbit/pinch input.
  E remains reserved for interactions; never bind it to camera orbit.
  Filter lock deltas exactly as spec R8; recover rejection/re-lock cleanly. Clear held/pending/capture state on
  blur, hidden page, menu or disconnect. Preserve editable fields and click-versus-drag events for interaction.
  · evidence: pulse/held/repeat and slow-frame staging checks; warp/rejection/re-lock/blur/menu flow, usable touch.
- [ ] **WC05 — Keep the camera out of the kingdom's solids.** Complete the conservative near-plane/shoulder
  collision sweep, immediate pull-in and .35 s outward recovery against the supplied complete CollisionWorld.
  Separate zoom intent from occlusion. Finish continuous wheel first person, self-visibility, level horizon,
  time-based follow and resize framing. · evidence: newly inserted occluder first-frame and corner/post/roof
  tests at both aspects; looked real street and tight-space view; no clipped first-person wall approach.
- [ ] **WC06 — Adopt Predict and collision revisions without a second protocol.** Within the effective narrow
  client grant, bind the improved shared step, all PLAYER_FIELDS, input pulses and collision revisions through
  the existing real Colyseus adapter. Preserve its auth/reconnect/transport lifecycle. Stage exactly Predict's
  due input count, adopt the frozen safe revision transition/reset policy and document render/takeover order.
  · evidence: two real browsers, slow render, changed-solid/revision flow and recovery; authoritative positions
  and full fields agree; no invented queue, sequence/ack system or silent air fallback.
- [ ] **WC07 — Walk the actual places and hand the camera back.** With integrator binding and realm wiring,
  exercise the actual street, forged/placed parts, furniture, fence, doorway and roof rather than a separate
  collision bench. Supply only module fixes/recipes; integrator owns composition calls. Enter/exit menus,
  Forge/build and an existing camera takeover, then move immediately. Resolve keyboard/touch region conflicts
  with interaction's owner. · evidence: actual kingdom browser route and safe authoritative final body/camera
  positions; a normal player view is the entry view; no held mouse needed and no stuck keys or lost cursor.
- [ ] **WC08 — Judge the walking experience and hand off real evidence.** Run final integrated `pnpm verify`.
  Capture one or two relevant actual-walk views per required size, open each, and correct weak framing or
  clipping. Keep selected final evidence and a short owner manual route in README/progress. Record the real-GPU
  feel/multi-monitor pointer check for Tobias, and keep realm-server's separate actual 300-bot result attributed
  to that lane. · evidence: green integrated verification, two to four selected looked PNGs, exact URL/ports,
  complete movement/menu/occlusion flow and honest remaining feel/GPU doubts.

## Backlog

The worker records discoveries here and never selects them without a new brief.
