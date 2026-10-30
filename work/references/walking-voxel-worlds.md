# Reference: walking in voxel worlds

For: deterministic player movement and the walk camera.

- [Voxelize](https://github.com/voxelize/voxelize) · MIT · studied at `7ae1c202c4ed33e6f18ea2e947c5c6f9a373b605`.
- [Ecctrl](https://github.com/pmndrs/ecctrl) · MIT · studied at `e2cab804f9f15661a642e76f52d09f0b2db63f35`.
- [HYTOPIA source](https://github.com/hytopiagg/hytopia-source) · MIT · studied at `44f2a42979999ef76413a6afdad02b416aecc000`.

## What they are

Voxelize sweeps an AABB against voxel collision boxes and trials steps without committing an invalid result. HYTOPIA has a practical third-person boom with obstacle pull-in and separately configurable first-person placement. Ecctrl provides examples of time-based easing and collision mesh integration, but its current camera implementation delegates to Drei camera controls rather than defining a bespoke camera curve.

## What we take

- **Sweep and slide:** Voxelize `packages/physics-engine/src/sweep.ts:21` tests a moving AABB against expanded obstacles, seeks the earliest hit over a swept-volume broadphase (`:135–190`), offsets from contact, and continues with remaining motion (`:192–229`). Handle simultaneous corner contacts deterministically; a finite iteration bound must terminate even with zero-time hits. A sweep alone does not resolve a body already embedded by a world edit or spawn.
- **Step trial:** `packages/physics-engine/src/index.ts:761–889` only tries when grounded and horizontally blocked. Find the obstacle top, reject a too-tall step, sweep up for headroom, replay remaining horizontal movement, require actual progress beyond the blocked position, and sweep down to support before committing. Otherwise keep the ordinary sliding result. Its defaults are graze ratio 4 (`:97`), epsilon `1e-10` (`:67`), and height slop `1e-3` (`:16`); these are reference values, not automatically suitable for our unit scale or determinism. Its graze check suppresses unwanted climbing while skimming a ledge (`:781–790`). Test ceilings, diagonal corners, narrow ledges, unsupported landings, high walls, and obstruction shapes with multiple boxes.
- **Camera occlusion:** HYTOPIA `client/src/core/Camera.ts:579–656` constructs the boom, raycasts target to desired camera, subtracts near-plane padding (`near + 0.1`), and recovers out at 10 units/s versus 20 in. The 0.5 minimum distance and smoothing inward can still clip when space is tighter than that or an obstacle appears suddenly. For Chatdom clamp the rendered camera to a conservative collision distance immediately, then ease outward; account for the near-plane footprint, not just a center ray. Keep desired wheel distance separate from occlusion distance so it recovers when clear. A ray alone may miss a wall touching a frustum corner.
- **Framing and zoom:** HYTOPIA has separate local first-person and yaw-relative third-person offsets (`Camera.ts:553–613`), and scales film offset with zoom to avoid crosshair drift (`:519–535`). Its wheel delta handling (`:408–418`) caps magnitudes, but its 3–10 radial zoom (`:9–12, 440–446`) does not implement our seamless first-person wheel. Establish shoulder placement by the avatar's screen position at both target aspect ratios, not by copying offsets.
- **Easing:** Ecctrl uses `1 - exp(-rate * timestep)` for timestep-independent smoothing (`src/character/Ecctrl.tsx:511`); its example passes collider meshes and `smoothTime` to Drei (`example/EcctrlWrapper.tsx:174–180, 865`). This is a client presentation technique, not part of deterministic player simulation. Its `dynamicCurve` (`src/shared/Math.ts:22–30`) is a generic exponential, not an evidenced camera-specific curve in this revision.
- **Prototype lessons, not implementation:** Lanternmere `SPEC.md:72–76` proposed 4 m/s walk, 7 m/s sprint, 1.2 m jump, and 0.5 m auto-step; these are starting references, not new decisions. `HANDOVER-engine.md:159–183` records Linux pointer-lock warp failures: discard events over 250 px, ignore the first 120 ms after locking, clamp other per-event deltas to ±100, reject non-finite values, bound pitch and wrap yaw. Reset fallback state after later successful locks and clear drag on lost pointer-up/blur. A real-GPU, multi-monitor owner retest was still needed. Its `:202–203` explicitly says its 3.5 m / 0.95 m shoulder framing had not achieved the requested lower-left-third composition.

## What we do differently

Use a pure `stepPlayer(state, input, dt, voxels)` shared by client and server, on an agreed fixed tick, with quantized directional input and no runtime trigonometry in simulation. Define the yaw/direction lookup and rounding, diagonal normalization, collision tie order, numeric representation, and world snapshot semantics in the contract so both executions agree. Camera look, pointer lock and render smoothing remain client-only; input transmits the quantized movement direction and button bits. Support WASD, sprint, jump and a maximum 0.5 m automatic step; jump requires a defined press/hold and grounded policy. Wheel continuously reaches first person, with avatar visibility handled there. Default shoulder framing places the avatar in the lower-left third. On pointer-lock rejection use a clearly bounded drag fallback; reset it on unlock, blur, lost capture and successful re-lock.

Suggested read-only collision boundary: `voxels.boxesAt(x, y, z): readonly Aabb[]`, where integer cell coordinates map to a stable, documented sequence of world-space solid AABBs, including partial blocks. Empty cells return an empty immutable sequence; unloaded cells have an explicit identical client/server policy rather than silently differing. The pure step owns sweep, sliding, support and stepping; voxel queries have no side effects, clocks, render meshes or random ordering. Include collision-relevant world revision in prediction/reconciliation. Define overlap recovery separately; do not mistake a sweep for penetration resolution.

## Leave behind

Rapier/React dependencies, networked entity coupling, cinematic camera controls, the prototype's code and appearance, and any arbitrary constants whose scale or purpose does not match our world. HYTOPIA's center ray and minimum camera distance are insufficient guarantees against occlusion by themselves. No visual or interaction quality claim follows from source inspection alone.

## License

The three repository root licenses are MIT and permit adaptation with their copyright and permission notices retained. If code is adapted, add a source/license header and a `THIRD_PARTY.md` entry as required by the study-reference skill. Asset licenses are separate and were not evaluated; this note proposes techniques only. Lanternmere is an internal, read-only prototype consulted for lessons, not copied.
