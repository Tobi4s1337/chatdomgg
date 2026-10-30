# Spec 38: The founded kingdom is the world you walk

Status: frozen · 2026-10-30
Vision: `chatdom/ChatDom.md` §§2–5, 10; `chatdom/Quality.md` §§2–5, rules 4–11;
`chatdom/Artstyle-Soul-Feel.md` §§2, 6, 10 and Decided.
Parent: specs 33–37. Lane: `realm-server-world`. Worker: `gpt-6.1-sol`, high.

## What and why

Walk opens the community's actual founded town: its castle, oldest streets, homes, plaza and landscape.
Three people can walk together from the plaza toward the water, with the same walls and openings in every
browser. Publishing a home or a forged part changes that same place without losing a neighbour inside it.
Reloading restores the accepted home, never a fresh procedural approximation of its address.

This lane produces the missing founded-world data, physical geometry and first-home furnishing. It hands an
actual current town artifact and renderer installation recipe to integration early. Realm-wiring consumes
that producer and owns build/Forge authority and browser adapters; walking consumes only `CollisionWorld`.
Main/integrator mounts the actual kingdom. Another isolated court cannot complete this work.

## Current state

- `apps/realm/src/allocation/service.ts:83` exports `AllocationService`. Its `currentLayout(kingdomId)` and
  `layoutPlan(kingdomId, revision)` read the adopted revision and exact stored `SettlementPlan`; `adoptLayout`
  already rejects regenerated/moved plots and streets. The original deed placement stays fixed.
- The same file, lines 53–65, exports `FurnishedHome`, `HomeFurnisher` and `AllocationServiceOptions.furnish`.
  `prepare` fixes an installation command once; `install`/`recover` use the existing fenced kingdom writer.
  Without a furnisher the deed remains pending and counted. Preserve that honest failure.
- `apps/realm/src/persistence/kingdom.ts:70` accepts
  `DurableKingdomOptions | ((state: RealmPrivateState) => DurableKingdomOptions | Promise<DurableKingdomOptions>)`.
  `createDurableRealmServices` takes `kingdom(kingdomId, state)` after the original writer lease is acquired and
  its state loaded. This callback may inspect committed state; it never acquires another writer. Opening checks
  its safe lease deadline after loading geometry and after public projection reads.
- `apps/realm/src/ports.ts` supplies actual `RealmRoomEffects.adoptWorld(world, layoutRevision, positions)`:
  positions cover every affected walker. `recoverWalker` and supported clear spawn are existing obligations.
  This is not a grant to edit the room, durable registry or movement solver.
- `packages/shared/src/realm/founded-world.ts` now contains the real receipt and GET route constants.
  `packages/world/src/founded-world/types.ts`, exported by the world root, contains the public scene types below.
  Neither file implements a scene producer, runtime scene validator, collision compiler or HTTP handler.
- Current `apps/web/src/kingdom/scene.ts:41` regenerates a presentation plan. Its settlement/castle recipes
  are in `settlement-content.ts` and `castle-content.ts`; `terrain-worker.ts:18` documents the existing
  half-metre terrain occupancy and conforming metre surface. These browser files are read-only recipes here.
- Existing reviewed factories include `createNativeForgeHost` from `@chatdom/forge`, the actual Hearth/Tide
  home factories, core Grove content, castle modules, street/civic props and `MATERIALS`. Native host resolution
  establishes no ownership. Read current exports and acceptance records before consuming any additional place.
  Specs 27–31 and an isolated content bench do not establish that their generators/sites/assets are accepted.

## Rules

1. **R1 — The adopted plan is the address book.** Resolve `currentLayout`, then load its exact `layoutPlan`.
   Verify kingdom/origin/revision agreement with the loaded authority state and the intended room. Preserve
   every plot ID, slot, placement, cardinal rotation, foundation, street, castle module and landform. No generator
   call, current-date substitution, tier/seed URL override, occupied-plot normalization or home-style rewrite in
   this production path. No founded record means unavailable; never implicitly found a kingdom during entry.
   Cold opening of an already adopted kingdom does not wait for a new Genesis ritual. A SIMULATED adopted plan
   is valid fixture evidence; live founding remains the actual founding consumer's explicit adoption operation.
2. **R2 — One complete public scene.** Construct `RealmFoundedScene` by an explicit allowlist, not object-spreading
   private homes/state. Start from accepted native content for the exact plan; replace each committed owned
   home's base with its approved blueprint and retain only its currently attached approved parts. A retained
   displaced part is not still attached. Derive home origins from the approved size and original plot frame;
   transform attachment build-cell origins through that same frame. Never render a second native home beneath
   the replacement. Include every mounted static solid in the placement list: houses, castle, garden edges,
   civic props and trees, and accepted static places when actually mounted. Preserve authored air operations.
   Animated water, cloth and visual effects are not arbitrary static blockers.
3. **R3 — Bytes identify the scene.** Validate each blueprint/material registry, finite transforms, unique
   placement IDs, valid cardinal turns, references, plan/revision consistency and bounded counts before writing.
   Hash exact deterministic serialized blueprint bytes for `assetHash`; deduplicate by hash, never blueprint ID
   alone. Hash exact scene response bytes, before HTTP encoding, for `sceneHash`. Keep original semantic blueprint
   IDs and plot IDs even when two versions share an ID. Bind compiler version, material revision and all geometry
   inputs in the producer's cache/revision identity. `collisionRevision` is a checked uint32, never a truncated
   hash that silently aliases two worlds; one revision cannot name differing physical geometry. Same exact
   scene/restart yields the same receipt. A changed home, attachment, material solidity or adopted layout must
   produce the matching new scene/hash/revision before clients walk it. Revision exhaustion fails explicitly.
4. **R4 — Solidity comes from final cells.** The browser-safe compiler in `packages/voxel/src/collision/**`
   resolves ordered voxel operations first, including material-zero carvings, then uses `VoxelMaterial.solid`.
   Glass remains physical even when it does not occlude faces/light; unknown material IDs fail closed. A whole
   blueprint AABB, every positive source box, render mesh/LOD bounds or occlusion flag cannot substitute for
   final occupied cells. Preserve partial doors, passages and thin geometry under all four cardinal transforms
   at each asset's actual `VOXEL_METRES` lattice (build 0.125 m, avatar 0.0625 m); do not resnap fine hero geometry.
   Coalesce/index final cells as needed without filling an opening. Queries return immutable,
   duplicate-free world-space boxes in stable order and have bounded workspace; no dense kingdom-sized fine grid.
5. **R5 — Real terrain under the feet.** Compile the exact adopted plan's sampled terrain on the existing 0.5 m
   lattice, using `terrainHeight`/its installed version dispatch and the renderer's existing sampling convention.
   Document the half-metre occupancy versus smoothed visible surface relationship; leave grounded visual easing
   to walking. The producer gives server and browser the same terrain adapter and known bounds recipe. The pure
   compiler accepts sampled terrain explicitly and imports no world/content/web/Three/Node modules. It must work
   with current accepted landform versions; an unsupported future version is unavailable rather than flattened.
   Unknown terrain/chunks/outside the known footprint block on both ends. Do not return air at an unloaded edge,
   fill a real water channel to create a crossing, or turn water's visible sheet into a floor. Supported half-metre
   steps remain climbable by the existing solver; tall walls and low ceilings remain obstacles. Keep the existing
   warm materials, softened visible ground and distant horizon when integration consumes the scene.
6. **R6 — Loaded state and public readiness are different.** The opening callback gets the exact committed
   `RealmPrivateState` under the held writer, before the public projection is opened. That state may be ahead of
   the delivered public prefix. Prepare/cache expensive reusable native content outside the critical opening
   window; resolve and verify the exact adopted plan and committed overrides inside it. No unbounded meshing,
   model call, approval request or second writer in this loader. Return the actual `DurableKingdomOptions`
   (`world`, `layoutRevision`, supported `spawn`), plus a documented producer result for the composition owner.
   Do not advertise a ready manifest while its home/attachment versions disagree with the authority-supplied
   `RealmBootstrap.current` at `throughCursor`. A prospective scene may be stored by hash while readiness waits.
   The authority supplies that public checkpoint; the producer never fabricates a principal to call bootstrap.
   Initial scene/compiler/provider work is startable now; a later post-publication consumer is not its prerequisite.
   Cold entry must not deadlock: clients need this receipt before joining with a collision world. The injected
   read/preparation port must be able to request a trusted hold through the existing durable registry even when
   nobody is walking, then obtain the real authority's public checkpoint. Requiring an already connected
   browser to prepare the first manifest is invalid. Any missing public-read/composition port is a precise main
   need for FW03, never permission to invent a principal or open a second writer in the API.
7. **R7 — Adoption is one authority operation.** After a committed approved build/Forge change, the producer
   prepares the next immutable scene/world and safe placement candidates. Wiring serializes publication and
   invokes the actual effects/handle composition; the producer never approves, charges coal, writes domain facts
   or broadcasts success. Keep unaffected walkers in place when supported and clear. Validate every affected
   current pose against the next world; choose bounded supported, non-overlapping clear anchors with egress for
   those displaced by geometry. Cover every affected walker in the map passed to `adoptWorld`, including nearby
   people other than the maker. Do not release interaction leases to solve a collision. Recheck the authority's
   current revision/poses before adoption; stale preparation is discarded/rebuilt. Collision, handle getters,
   bootstrap, receipt and renderer must switch coherently. While their versions differ, hold movement, reload
   the current receipt and resync; never let prediction run against stale geometry. Existing `adoptWorld` is the
   seam, not a nonexistent `DurableKingdom.updateWorld` method. Missing orchestration support is `needs:` to main.
8. **R8 — Furnish a deed, never mint one.** Implement the existing `HomeFurnisher` with actual reviewed native
   content for `deed.placement` and exact content digest/revision. Resolve approved maker/kingdom names and their
   real approval ID through a required injected source; no constant `names:1`, inferred approval, invented
   anonymous permission, test citizen or display-name-as-verdict fallback. Missing approval/content leaves the
   deed pending through existing allocation behavior. Keep `prepare` retry bytes stable; `install`/`recover` stay
   with AllocationService and the one writer. This lane does not implement Genesis, choose a founding plan, issue
   tenure evidence, grant rights or provide an authentication bypass.
9. **R9 — Serve only the approved allowlist.** Implement GET handlers under `apps/api/src/founded/**` using
   `REALM_FOUNDED_ROUTES`. The manifest is `no-store` and only becomes available when the current prepared scene
   is authority-adopted and matches its public checkpoint. Resolve that current receipt through an injected
   current-read port defined in this owned module; main/integrator supplies its actual cross-process composition
   after the implementation exists. Do not guess a server URL/port or create another REST authority. The scene
   endpoint validates the hash parameter and returns the exact checked bytes whose SHA-256 it names. Use a
   bounded configured immutable asset store/read
   port shared by the producer and handler, with atomic writes and exact-byte verification; no process-local map
   as restart durability, cross-app private-state serialization or a browser-authored upload route. Missing,
   corrupt, withdrawn or unready assets fail explicitly. Preserve the host's actual withdrawal/access policy;
   immutable bytes do not authorize bypassing a veil. Names/rights/sessions/deeds/judge receipts/wishes and private
   drafts never enter the scene, a generic log or an error reply. These geometry GETs do not issue entry tickets.
10. **R10 — Honest town evidence.** Label any fixture authority, seeded community, simulated sign-in/provider or
    synthetic walkers **SIMULATED** throughout evidence and visible host UI. Do not fabricate first founding,
    live naming approval, deeds, Twitch sessions or people. Accepted current static places only: no stand-in
    pier, generic bench-as-place, guessed generator API or hand-drawn destination to finish a checkbox. The final
    three-browser plaza→pier journey remains required of integration; a missing accepted site/content/provider
    is recorded as a concrete dependency, not quietly replaced by a court or reported as demonstrated.

## Contracts

Consume the actual exports; main owns all changes to shared/world boundary types:

| Export / file | Meaning |
|---|---|
| `REALM_FOUNDED_ROUTES`, `RealmFoundedManifestSchema`, `RealmFoundedManifest` from `@chatdom/shared/realm` | GET `/api/realm/founded/:kingdomId` and `/api/realm/founded/scenes/:sceneHash`; strict v1 receipt with `kingdomId`, `origin`, `layoutRevision`, uint32 `collisionRevision`, SHA-256 `sceneHash` |
| `RealmFoundedBlueprint`, `RealmFoundedPlacement`, `RealmFoundedScene` from `@chatdom/world` | Blueprint `{assetHash, blueprint}`; placement `{id, assetHash, position, rotation, plotId?}`; scene is receipt minus `sceneHash`, plus exact `plan`, `materials`, `assets`, `placements`. These are types, not runtime validation or authority |
| `CollisionWorld`, `SolidBox`, `WALK_BODY` from `@chatdom/shared/realm` | Immutable revision, stable solid queries, 0.28 m radius/1.75 m body/0.5 m step; unknown blocks |
| `AllocationService`, `HomeFurnisher`, `FurnishedHome`, `Deed` in realm `allocation/` | Exact adopted plan, genuine pending installation, reviewed initial content and approved attribution |
| `createDurableRealmServices`, `DurableKingdomOptions` in realm `persistence/` | `kingdom(kingdomId, state)` resolves geometry after acquire/load; no new writer |
| `RealmRoomEffects` in realm `ports.ts` | Atomic `adoptWorld` and checked `placeWalker`; composition/authority owns the call |
| `RealmBootstrap`, `RealmPublicDelivery` in shared `realm/messages.ts` | Current approved public views, public `throughCursor`/`cursor` distinct from private fact sequence; no ritual replay |

The lane creates its own implementation exports under its owned `index.ts` files and records their real
signatures in `apps/realm/src/founded/README.md` as soon as FW01 lands. The compiler's input is explicit registry,
resolved blueprint placements, collision revision and bounded sampled terrain; it returns `CollisionWorld`.
Use local structural types so `voxel` has no dependency cycle with `world`/`forge`. Do not install call sites or
import a prospective function from another lane. Main registers a new package subpath/dependency only when its
implementation exists; a direct relative source import inside this lane's tests is acceptable meanwhile.

## Scope

Write only:

- `packages/voxel/src/collision/**`: pure compiler/index/tests; no voxel root/barrel/manifest or movement edits.
- `apps/realm/src/founded/**`: scene assembly/validation/bytes/store adapter, loaded-state provider, safe-anchor
  preparation, actual HomeFurnisher, focused parity test and installation README.
- `apps/api/src/founded/**`: narrow read handlers/adapter. No API bootstrap, auth or manifest edits.
- `work/lanes/realm-server-world/{PRD.md,progress.txt}`.

Everything else is read-only, including `packages/shared`, world contracts, realm allocation/persistence/ingress/
outbox/limits/diagnostics, `ports.ts`, room/server/main files, realm-wiring, walking, browser scene/content, package
manifests, lockfile and root scripts. You are not alone; preserve other workers' changes. Supply exact composition
recipes to main/integrator. No git from sub-agents; the lane worker commits only `lane/realm-server-world`.

## Acceptance

Use existing movement/room/allocation tests and one meaningful producer parity test with several assertions.
Do not create a new proof framework, bot runner, duplicated movement suite or screenshot bench. Focused checks:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/voxel/src/collision apps/realm/src/founded apps/api/src/founded packages/world/src/movement apps/realm/src/persistence/kingdom.test.ts apps/realm/src/allocation/allocation.test.ts
pnpm --filter @chatdom/realm build
pnpm --filter @chatdom/api build
```

Run only test paths that exist at that task. The producer parity scenario serializes a real current town using
the installed reviewed content and an exact adopted-plan fixture labelled SIMULATED; decodes the same immutable
bytes as a browser would; compiles both sides; and compares stable queries and the existing `stepPlayer` outcome.
Exercise one carved doorway, solid glass, cardinal placement, a half-metre terrain step, unknown edge and an actual
approved home/attachment override, then a changed revision with safe placement for an affected bystander. Prove
that the old receipt cannot acquire new bytes and private fields do not escape. Reuse existing movement helpers
and fixtures instead of retesting every solver behavior here. Verify API exact-byte/hash/readiness handling and
furnisher missing-approval/pending retry in these focused producer/adapter tests.

FW01 produces an actual immutable town artifact plus a concrete renderer recipe before furnishing/HTTP volume.
Record its path/hash, byte/count/workspace/build-time measurements and real exports in progress/README; an SVG or
a fixture court is insufficient. Backend-only tasks require no screenshot. Once main/integrator mounts this
producer into the actual kingdom, run existing serial capture tooling and inspect 1440×900 and 390×844 web shots
with `$look`/`view_image`; include 1920×1080 only if stream composition changed. Do not invent a root screenshot
command before it exists. Main/integrator owns `pnpm verify` and the three-browser WASD tour through the actual
kingdom: same receipt/world, plaza→pier, reload, accepted build/Forge revision and safe bystanders. Inspect warm
windows, usable doorways, real ground, horizon and touch/shoulder framing. Missing live providers remain explicit;
SIMULATED tour evidence does not establish live Twitch founding/sign-in/approval.

## Quality bar

The result is the same handmade toy kingdom at dusk, lit by its people, with a horizon worth walking toward.
Walking moves through the town already being built, with its authored homes and retained IDs. Geometry feels
physical without sealing carved doors, fitting a shell around empty interiors or making every slope a wall.
No flat debug floor, boxed-in court, generic place substitutes, new UI harness, fabricated audience or copied
prototype. Data production does not justify replacing the accepted renderer/material/light/horizon work.

## References

- `work/references/walking-voxel-worlds.md`: final collision shapes, deterministic queries, supported half-metre
  steps and explicit overlap recovery; use the already implemented solver rather than another physics engine.
- `work/references/colyseus-realm.md`: one writer, actual SDK prediction, revision matching and independent public
  delivery/reconnect semantics; no second ack/sequence system.
- Specs 33–37: fixed authority/effects/client seams and existing lane ownership. Specs 27–31 describe place/content
  ownership; consume only accepted concrete exports and exact adopted sites, never their prospective signatures.
- `work/PLAN.md` §§2–4, 10: immutable content, current accepted realm work, actual `/?walk=1` still unproven.

## Not now

This lane does not author new places, landscape generators, home families, art, avatars, interactions, interiors,
Genesis, auth/OIDC/tickets, tenure/deeds, approvals/judges, build/Forge authority, Twitch ingress, transport,
Postgres fencing/recovery, district/load runners, movement/camera, browser mounting, deployments or server config.
These are ownership boundaries. Their missing consumers remain blockers to the complete kingdom journey.

## Decisions

- **2026-10-30 — Transfer only the missing founded-world volume.** Main must amend spec 34/realm-server's PRD
  scope and current-state notes to name spec 38 as producer owner, without reopening accepted RS01–04. Transfer
  exact-plan public scene assembly, immutable scene read serving, production `HomeFurnisher`, collision compiler
  and founded-world loader implementation to `realm-server-world`. RS05–09 remain wholly with `realm-server`:
  reconnect/revocation, limits, district decoder handoff, 300 actual SDK clients, persistence recovery/shutdown.
  Keep its current allocation/persistence/auth/bootstrap files with that lane; give no overlapping write grant.
  Native generation is allowed only in the explicitly SIMULATED adoption fixture used for evidence; production
  assembly never regenerates an adopted layout. Store and reload approved scene bytes rather than silently
  replacing a founded world's geometry because a content factory was upgraded.
  Main/integrator composes exported producer factories in realm/API entrypoints after review. This lane does not
  edit the parent PRD/spec to make that transfer itself.
- **2026-10-30 — Consumers are separate.** Main must amend spec 36/realm-wiring's dependency/current-state prose
  to consume this producer's actual scene/world/manifest exports; wiring keeps live entry/browser adapters,
  public-prefix installation, build/Forge authority and committed revision orchestration. Walking's immutable
  `CollisionWorld` seam remains unchanged. Main/integrator owns root/browser mounts, handle/effects adoption
  consistency and final tour. Post-publication orchestration remains RW06/main's existing `adoptWorld` consumer;
  freeze its additional needs only when that consumer starts. Initial founded-world work does not wait for it.
  Do not hand any of those folders to the producer to make it appear self-contained.
- **2026-10-30 — Exports exist before calls.** Shared receipt/routes and world scene types exist at freeze.
  The state-aware loader and realm workspace dependencies on existing content/forge/voxel factories exist.
  The producer functions, voxel collision subpath and HTTP handlers do not yet
  exist. When implemented, main registers `@chatdom/voxel/collision` to `src/collision/index.ts` and only the real
  workspace dependencies needed by realm/API consumers, updating the lockfile itself. Root scripts stay as-is
  unless a concrete delivered script needs registration. There is no guessed package API in a shipped call site.
- **2026-10-30 — Parallel writes, early artifact.** FW01's scene author owns realm `founded/scene*`/validation/
  serialization and README; an independent compiler worker owns only voxel `collision/**` and can start FW02
  concurrently. After the first actual artifact/exports, furnish/read-handler workers may own realm
  `founded/furnish*` and API `founded/**`; the provider/adoption author owns realm `founded/provider*`/anchors/
  store. The lead alone owns the founded barrel/parity test/PRD and reviews every result. Use Sol high for scene,
  provider and furnishing judgement; Terra medium for the narrow parity/API test assistance if needed. Follow
  the lane protocol: one task is committed/ticked at a time; sub-agents never run git or edit another write set.
- **2026-10-30 — Current accepted town first, real destinations required.** FW01 must be immediately consumable
  by integration using current accepted factories and exact founded IDs. It cannot wait for all place lanes.
  A pier/path/site absent from the adopted accepted data is a named upstream dependency; never invent it or
  finish plaza→pier acceptance at a substitute. Current scene production can proceed while that dependency and
  real live naming/provider evidence are supplied.
