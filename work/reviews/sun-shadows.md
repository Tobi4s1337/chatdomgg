# Cached directional shadow review — 2026-10-30

Astra xhigh designed and built `packages/render/src/sun-shadows.ts`; main reviewed its public renderer APIs,
source transforms, ownership and actual depth proof. This module is a green checkpoint; kingdom look integration
and final acceptance remain in PLAN §10.

- One texel-snapped orthographic map fits bounded world space. Presence and presentation camera movement do not
  redraw it. Explicit caster/resolution changes and a 0.0005 rad sun change invalidate it.
- Casters share geometry and exact source vertex shaders, including displaced terrain. Instance placements are
  copied before presentation culling changes them. Disposal releases owned maps, materials and matrices.
- R8 colour plus unsigned-integer depth uses 20 MiB at 2048 and 5 MiB at 1024, plus copied instance matrices.
  The receiver filters depth comparisons and corrects the receiver plane; warm fields remain separate.
- Four unit cases exercise projection, snapshot isolation, caching/resizing, renderer state restoration/failure
  and ownership. Typecheck and scoped lint pass.
- Independent Chrome/SwiftShader proof compiled the real shaders, reported complete framebuffers (36053) at
  both sizes and GL error 0. A shadow pixel measured RGB 38 versus 174 in sunlight. An unchanged direction did
  not redraw; resizing retained the uniform object and changed the depth image to 1024.
- Main and the architect inspected `work/evidence/kingdom/sun-depth-proof.png`.

The reference is installed Three 0.186.1 (`WebGLShadowMap`, `DepthTexture`, render targets and renderer state).
The implementation is original code using public APIs. The existing Three credit covers the dependency.
Real-GPU frame times, especially while changing the hour, remain unmeasured. No software fps claim is made.
