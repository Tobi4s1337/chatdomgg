# Kingdom HDR post stack

For `packages/render/src/post-stack.ts`; design and first core, 2026-10-31.

The world stays a handmade toy kingdom. Its light must keep a warm colour and a source-sized halo, while
contact shade holds feet, furniture and homes to the ground. This follows `chatdom/Quality.md` §§2.5, 2.8, 4 and
`chatdom/Artstyle-Soul-Feel.md` §§6, 16. The stack consumes existing shared metre coordinates and presentation
environment data; it does not alter frozen shared schemas, presence authority, or material identities.

## Studied references

- [Three.js post-processing guide](https://threejs.org/manual/pages/post-processing.html) and
  [EffectComposer](https://threejs.org/docs/pages/EffectComposer.html), MIT, installed version **0.186.1**.
  Read the actual installed sources before implementing: `examples/jsm/postprocessing/EffectComposer.js:52`
  owns ping-pong HDR targets; `RenderPass.js:139` renders original materials; `OutputPass.js:88` selects one
  exposure/tone-map/output transfer; `UnrealBloomPass.js:100` builds its five-level separable bloom pyramid.
  `src/renderers/WebGLRenderer.js:2378` and `:2387` select linear working colour and disable material tone
  mapping for an ordinary offscreen target. We use these addons as dependencies; no upstream code copied.
- [Dennis Gustafsson: From screen space to voxel space](https://blog.voxagon.se/2018/10/17/from-screen-space-to-voxel-space.html)
  describes coarse versus exact voxel traversal and the memory tradeoff. Take the division of responsibility:
  existing voxel fields establish offscreen lighting/occlusion; screen depth adds fine visible contact.
  Do not infer that screen-space AO supplies GI or that his GPU timing transfers to Chatdom.
- [Lighting reference study](magic-lighting.md), researched in parallel by the reference scout: source-sized
  bloom, sky-coloured height fog, sparse shafts, preserved window readability. Complementary, BSL and
  Teardown supplied visual/algorithmic references only; none of their implementation was copied.

## Data model and integration

`createPostStack(renderer, scene, perspectiveCamera, options)` owns only post targets, passes and uniforms.
Options: `quality: low | balanced | high | capture`, `toneMapping: aces | agx`, `fog: material | post`.
`update({environment, hour?, focusDistance?, beacon?, forge?})` accepts the existing environment grade,
optional focus distance in metres, and two world-space light positions with real strengths. The environment
is authoritative for hour-dependent colour/exposure; `hour` is accepted for scene integration, not sampled
again independently. The camera stays caller-owned. Null, non-finite or >=40 m focus disables DOF.

Order each frame: camera/world updates → sun shadows and water reflection → post update/render → DOM UI.
Call `resize(cssWidth, cssHeight, rendererPixelRatio)` after the renderer is resized. Runtime `setQuality`
changes only bounded targets and pass uniforms. `dispose` is idempotent and releases every allocated target
and material, including r186's otherwise omitted bloom high-pass material. Diagnostics report quality,
physical dimensions, estimated texture bytes, HDR support, bloom, AO samples and active focus.

The renderer's target (including cube face/mip), viewport, scissor, XR, clear state, colour-space,
tone-map and exposure are restored in `finally`. Thus an exception cannot poison a following reflection
or scene. Composer draw calls are accumulated into a whole-frame count, rather than reporting only the
final fullscreen triangle. No singleton or global shader mutation is used.

## Hot path

1. **Original scene draw** into linear RGBA16F with a sampled depth attachment. Custom packed voxel
   vertices, terrain displacement, instancing, alpha coverage and all normal materials use their own
   existing shader. Material tone-mapping/colour-space chunks remain: Three disables their conversion
   automatically for these offscreen targets. No normal-material override is safe for our packed meshes.
2. **One contact/air pass** reconstructs view position through the actual inverse camera projection;
   derivatives reconstruct normals. A deterministic 0.65 m screen-space neighbourhood adds up to 22%
   contact darkening. Range rejection avoids distant outline halos; HDR emission is protected. Existing
   mesh AO, grid contact lighting and sun shadows remain the primary grounding offscreen and at distance.
   Optional post fog analytically integrates exponential height density along the visible ray segment;
   its sunward colour comes from the same environment. Optional close DOF uses eight depth-rejected
   samples, blurring only distant background by at most 2.2 physical pixels. High-tier light shafts gather
   real bright HDR samples toward beacon/forge and reject occluded sources and occluded samples. They are
   a restrained screen-space scattering approximation, not shadowed volumetric integration.
3. **Bloom** extracts luminance above 1.05 with a 0.25 soft threshold, blurs a downscaled five-mip pyramid,
   then adds it to HDR at 0.24 strength and 0.18 radius. All visible emissive materials participate,
   including reflected sources, without an object allow-list or second scene draw. Bright specular light
   can bloom too. An emissive material must actually exceed the threshold after transparency blending.
4. **OutputPass**, once, applies environment exposure, ACES (or selectable AgX), and sRGB encoding.
   The contact/air pass has only a mild night-shadow tint and 7.5%-maximum corner vignette. It never clips
   radiance before bloom. No film grain or chromatic aberration muddies the small citizens.

## Budgets

These are targets, **not measured GPU claims**. No network traffic or persistent state is introduced.
Per-frame CPU work is two camera matrices, fixed uniforms and at most two source projections; aim <0.15 ms.
Camera matrices and scratch vectors are reused. No extra geometry draw is required for AO or fog.

| Tier | Maximum scene pixels / DPR | MSAA | AO taps | Bloom input scale | Extra post GPU target | Approx. maximum owned textures |
|---|---:|---:|---:|---:|---:|---:|
| Low / phone | 0.85 M / 1 | 0 | 0 | 0.5 | <=2 ms of 33.3 ms | 22 MiB |
| Balanced / laptop, OBS | 1.45 M / 1.25 | 2 | 8 | 0.65 | <=3 ms of 16.7 ms | 104 MiB |
| High / desktop | 2.10 M / 1.5 | 2 | 12 | 1 | <=4 ms of 16.7 ms | 160 MiB |
| Software capture | 2.10 M / 1 | 0 | 4 | 0.5 | no performance claim | 53 MiB |

Bloom's first actual target is half its input scale, followed by five smaller levels. The estimates include
both RGBA16F+depth ping-pong targets and multisample storage, but exclude driver overhead and the scene's
own water, shadow and voxel resources. Resize caps physical pixels even on very large/high-DPR displays.
Low retains HDR, bloom, grade and the scene's clay/windows/horizon. Capture keeps deterministic real bloom
and a cheaper contact pass. Without float renderability, a single direct scene draw keeps the existing
material fog/lighting and final filmic mapping; diagnostics honestly reports `hdr:false, bloom:false`.

## Decisions and growth

- **ACES default** preserves the shipped scene palette while moving it into genuine HDR. AgX is available
  for a comparative image review; changing the global response before source radiance is judged would
  conflate two visual changes.
- **Material fog default** prevents double fog across current voxel, water and stock materials.
  The post fog implementation is ready, but adoption must switch off material fog only during the main
  view while retaining it for reflections. Transparent geometry does not write scene depth, so a full
  post-fog migration also needs a transparent/fog policy; do not toggle it blindly.
- **No replacement geometry pass** avoids both extra scene cost and incorrect packed-voxel normals.
  Contact shading cannot see offscreen geometry; existing voxel fields are deliberately retained.
- **Keep the complete vision composable.** Real-GPU profiling decides whether to replace the contact pass
  with half-resolution edge-aware AO, and whether to integrate shadow-map/voxel-field volumetric shafts.
  Those upgrades consume this same scene depth, matrices and HDR/output boundary. An interior painterly
  pass belongs before OutputPass. High dynamic range sources, water reflections and every spectacle
  share the same response, independent of citizen count or moment origin.
- **Builders next:** profile the four tier configurations on actual devices; wire renderer quality to the
  existing device/OBS policy; maintain visible diagnostics. **Artisans next:** judge daytime/dusk/night source
  radiance and halo size on window, beacon, Forge, campfire and water shots; tune emission before changing
  global exposure. Keep paid/sub edges equal in brightness to everyone else's light.

## Evidence and doubts

- Focused Vitest: five tests pass for pixel bounds, original geometry/depth routing, one output transform,
  all renderer-state restoration after a failing draw, quality/focus transitions, target disposal, and
  no-float direct fallback. `pnpm typecheck` and scoped ESLint pass.
- Root owns build, scene integration and screenshots. This file's CPU tests do not prove GLSL compiles,
  that contact strength is beautiful, or that the source luminance survives actual transparent blending.
- Need real-GPU frame timings at 1440×900 and 1920×1080 plus a phone at 390×844; software Chrome fps is not
  evidence. Budget pressure could require allocating multisample storage only for the original scene
  target, rather than both composer targets, after measured benefit.
