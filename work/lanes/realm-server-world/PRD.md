# Lane realm-server-world

Status: frozen · 2026-10-30

Spec: `work/specs/38-founded-kingdom.md` · Branch: `lane/realm-server-world`
Scope: `packages/voxel/src/collision/**`, `apps/realm/src/founded/**`, `apps/api/src/founded/**`, this PRD/progress.
Worker: `gpt-6.1-sol`, high. Follow `$ralph-lane`.

Ready after main commits the contracts/spec and creates `../worktrees/realm-server-world`. Shared receipt/route
exports, public world-scene types and the state-aware durable loader exist; producer implementations do not.
Use the exact exports in spec 38. Never call a prospective sibling API. Realm's existing content/forge/voxel
workspace dependencies are registered; main registers new subpaths only once their implementation exists.
All existing allocation/persistence/auth/room/main,
realm-wiring, movement/camera, browser scene and content folders are read-only. RS05–09 remain realm-server's.
You are not alone in the codebase; preserve other workers' changes and send missing contracts as `needs:`.

Every task is done when its focused checks, `pnpm typecheck`, `pnpm lint` and affected builds are green, its box
is ticked, one progress line is written and one coherent commit is on this lane branch. Use existing movement/
room tests and one producer parity scenario; no new proof framework, screenshot bench or bot matrix. Backend
tasks need no screenshots. Actual town shots and the three-browser WASD plaza→pier tour belong to integration
after the producer is mounted. Any simulated authority/content approval/provider/crowd evidence says SIMULATED.
Missing live approval is pending, never a fake name approval or a reason to install fixture deeds.

## Tasks

- [ ] **FW01 — Hand integration the actual founded town early** · evidence: artifact/log. Load the exact adopted
  plan through AllocationService and assemble/validate/serialize the public `RealmFoundedScene` with accepted
  native home/castle/prop/tree factories and actual committed approved home/attachment overrides. Preserve
  plot IDs, slots, origins, cardinal frames and ordered carvings; no regenerating or copying private state.
  Cold opening uses already adopted provenance without waiting for a new Genesis ritual; unfounded live entry
  refuses. A fixture may explicitly adopt a SIMULATED plan and must keep that origin throughout its evidence.
  Produce a real current town scene artifact labelled SIMULATED when its authority is a fixture, with exact
  hashes/counts/bytes and concrete exports in `founded/README.md`. Include an exact renderer installation recipe
  for consuming this plan/placement list instead of regenerating; main/integrator edits the browser mount.
  Name absent accepted place/site dependencies. Do this before furnishing/HTTP volume. The independent compiler
  worker may start FW02 now with the disjoint voxel write set; the lead commits/ticks tasks one at a time.
- [ ] **FW02 — The same scene is solid in browser and server** · evidence: test/log. Implement the pure indexed
  compiler under voxel `collision/**`, with explicit registry/blueprint placements/sampled terrain inputs and
  `CollisionWorld` output. Resolve final ordered air/solid cells, glass, all cardinal turns, real 0.5 m terrain,
  supported step geometry and blocking unknown bounds. Preserve openings and bounded stable immutable queries;
  no world/content/web/Three/Node imports, dense whole-kingdom fine grid or solver edits. Add the one producer
  parity scenario using FW01's actual serialized town and existing `stepPlayer`/room checks. Record actual CPU/
  memory/counts; give main the exact collision subpath registration once its file exists.
- [ ] **FW03 — Loaded authority resolves a matching safe world** · evidence: test/log. Implement the founded
  provider/store/anchor preparation using `kingdom(kingdomId, state)` under the original held writer. Precache
  costly content, verify exact loaded state/plan and return real `DurableKingdomOptions` with supported spawn.
  Hold manifest readiness until the authority supplies a matching public bootstrap checkpoint. Prepare cold
  entry through the existing registry (no already-joined browser prerequisite), and report any
  missing trusted public-read port to main without fabricating a principal or acquiring another writer.
  Produce stable scene/collision revisions and next-world safe placement for every affected walker after a committed approved
  home/Forge change, preserving clear unaffected poses and interaction leases. Extend the parity scenario with
  a changed home/attachment, stale receipt and affected bystander. Supply exact wiring/adoptWorld/getter/
  bootstrap adoption recipes; missing authority orchestration is `needs:`, never an invented method or second
  publication path. Initial loaded-world work does not wait for RW06/main's later post-publication consumer.
  Do not edit the durable loader, repository, room or realm-wiring.
- [ ] **FW04 — Furnish genuine pending deeds and serve the checked bytes** · evidence: test/log. Implement the
  existing `HomeFurnisher` from reviewed content plus required actual approved naming evidence; missing evidence
  leaves the deed pending through AllocationService's existing stable prepare/install/recover path. Implement
  founded GET handlers using actual route/manifest schemas, an injected current-read port, no-store receipt and exact hash-verified
  immutable scene bytes through the prepared store. Reject corrupt/unready/withdrawn assets; no private state,
  auth shortcuts or public upload/publish endpoint. Add focused handler/furnisher assertions to existing producer
  tests; run spec 38's checks and affected builds. Finish the README with actual imports/signatures, realm/API
  bootstrap composition order, public readiness/adoption/disposal, package registrations, artifact/evidence paths
  and outstanding live/place dependencies. Main/integrator mounts and performs full verify/real-town screenshots
  and three-browser journey; an isolated producer or SIMULATED court is not integrated kingdom acceptance.

## Backlog

Ideas discovered during work go here; do not pick from this list without main's brief.
