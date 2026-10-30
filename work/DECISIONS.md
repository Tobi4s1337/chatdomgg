# Cross-cutting decisions

## 2026-10-30 — Foundation map

Authority: the founder's first-build brief, AGENTS.md and the current vision. No product code is introduced here.

1. **Build the whole vision through dependencies, not reduced releases.** PLAN maps complete responsibilities and
   contracts. Main owns shared/world authority, voxel/character/build cores and integration. Bounded work becomes a
   separately scoped lane. Atlas is first because its public data/rendering boundary does not need a game room.
   The plan is not itself a frozen protocol: actual schemas and tests precede each worker's spec and worktree.
2. **Use the full Tech §17 layout as folders become necessary.** Include baker, taster, surveyor, anim and chalk,
   which the shorter AGENTS diagram omits. Main owns root wiring and shared registration points. No empty app tree
   this turn. Skill templates already in `.agents/` are agent resources, not product implementation.
3. **Reimplement prototypes.** Preserve useful event/beat, grammar, meshing, camera and tile techniques, with
   source pointers in `references/prototypes.md`. Do not transplant their state, moderation, controls or assets
   wholesale. External prior-art study with source/license notes precedes implementation specs.
4. **Durability means accepted work survives.** Quality rule 7 and ChatDom's nothing-lost principle override Tech
   §12's permissive loss of a batch of non-economic history where that history includes accepted player work.
   Durably commit before acknowledging acceptance or broadcasting a durable result; retain pending client edits
   until acknowledged. Retries must be idempotent. Transient bubbles/poses may be lost; purchases, items, edits,
   seats and persistent progress may not. Details and latency evidence belong in the realtime/storage contract.
5. **Soft push cannot become overlap.** Quality rule 4 overrides Tech §6.3's slide-through wording. Design bounded
   separation/avoidance and reachable exits, including crowd pressure at doors. Do not turn collision off after
   0.6 seconds. Likewise validate movement against solid occupancy before relaying impossible positions; client
   prediction remains immediate. Prove capacity and feel before freezing the algorithm.
6. **Visibility is part of a contract.** Public/stream/owner/moderator/recorder projections are distinct. A hash
   does not grant publication permission. Veils and identity erasure invalidate dependent bakes, images, cards,
   Chronicles and recordings as well as live scenes. Immutable storage cannot imply irrevocable public display.
7. **Replay has three different uses.** Still-only Chronicles are the public lasting record. A labelled
   missed-climax replay is an in-app rendering under Monarch §6.4. Studio capture/rendering is internal tooling,
   subject to explicit opt-in, retention and redaction, never an automatic public video/clip product.
8. **Pins and measurements are evidence to verify.** Tech's version table and hardware timings describe the
   earlier environment. The available host is Node 22 with software rendering; Tech targets Node 24. During
   scaffolding verify package existence/compatibility, the three.js material path under WebGL2/OBS and runtime
   availability before freezing the lockfile. Do not silently change the intended stack or claim inherited fps.
9. **Skill instructions cannot undo the art direction.** The broad `chatdom-art` skill description mentions
   interiors/UI/Atlas images; the later Artstyle decision restricts generated raster art to boards and concept
   frames. Shared interiors are voxel rooms, UI is crafted in code, and the Atlas uses composed stamps plus
   approved drawings from real kingdoms. Follow the vision when selecting asset workflows.

## Questions retained, not silently answered

PLAN §9 owns the active question list: light form; sound/music and hero animation authorship; spell budget;
device/browser floor; shared league brackets and pool/score policy; Safety §7's missing social/privacy design;
Twitch provider/retention/Bits rulings; Atlas edition/coverage; raid receiving/adoption/recording choices; and the
accessibility/photosensitivity decision. These do not block planning or unrelated contracts. They do block claiming
the affected behavior is complete or activating a feature that requires their answer.

Apparent scout conflicts checked against the primary text: Tech §7.2 already includes optional shoutout-read
scope and lists six tier-one scopes. Those are not unresolved mismatches in the current file. Dates/counts in the
Atlas's historical Surveyor notes still need fresh observation before they can be cited as operational evidence.

## 2026-10-30 — Founder steers the scaffold

- Presence is the citizen’s own window, warm while present and named up close; the castle beacon is the kingdom’s light. This resolves older open light-form questions.
- Sound uses CC0/permissive sources plus procedural audio. Credit every source in THIRD_PARTY.md; no silent actions. Hero animation authorship remains separate.
- Freeze small tested contracts only at their first consumer. Identity/event envelope and Atlas now; world/voxel next, aimed at the dusk kingdom with windows lighting. No fourteen-group prerequisite.
- Node 22.23.4 is the supplied runtime. Postgres 18 and Valkey are available via ignored .env; no need for Node 24 for the scaffold. Local Surveyor is the real-data input; do not alter its existing service.

- **First interchange frozen after review:** identity/event primitives and Atlas interchange v1 only, after independent Astra high review and 22 tests. New Atlas binary/sidecar formats are our contract, not existing Surveyor endpoints. Exporter visibility/tombstone/atomicity checks remain publication gates.
- **Survey preview:** real observations may be drawn on a labelled immutable draft while edition founding age/taxonomy/founder gates remain unmet. The existing collector is read-only; a new adapter writes only its owned derived store.

## 2026-10-30 — One citizen, one presence window

The ordered first window anchor of each home is its citizen's presence window. It lights and names that person;
other panes remain authored glass. This makes the promised first arrival literally one warm window before the
town ripples on. The content bench explicitly lights every anchor to inspect placement, separate from the
production presence policy. The designated anchor remains stable through home-tier growth like the other
reserved anchors. No shared blueprint schema changes are required.


## 2026-10-30 — Inhabited visits and explicit arrival replay

A normal SIMULATED visit opens with the scenario's existing citizens present, through the same world reducer
and window contract. Its camera and environmental animation remain live; it does not require a fixed capture
time. “Let them in” explicitly resets that local scenario for the dark 0 → 1 named window → whole-town replay.
Real Herald mode derives every presence from its configured source and never manufactures this simulated crowd.
The designated one-person/one-window anchor remains; density comes from actual scenario presence and better
frontages, not extra windows pretending to be citizens.

Readiness means the complete geometry has rendered with initial published light from all three volumes.
It does not require a live worker queue to become idle. Until loading completes, identical frames are skipped
even without a fixed time; the first meaningful frame still renders before the public flag and loading gate change.
