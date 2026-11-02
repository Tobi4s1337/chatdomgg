import { PILLAR_CAP } from './pillars';

/** Most foam contacts (piles, stones, hulls, weir crests) one surface carries. */
export const CONTACT_CAP = 48;
/** Most basins a course clips itself against where they share a level. */
export const BASIN_CAP = 4;

export const waterVertex = /* glsl */ `
  in vec3 aFlow;
  out vec3 vWorld;
  out vec3 vFlow;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vFlow = aFlow;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/**
 * One water material for basins and courses. Colour is thickness absorption over the real bed (the bed itself shows
 * through the shallows), Fresnel mixes in the sky and, on the reflected plane, the planar pass with soft vertical
 * streaking; elsewhere a bounded set of analytic pillars carries the actual lights. Ripples are filtered by their
 * screen footprint; flow detail is two-phase advected along the supplied course and fades out at each layer's reset.
 */
export const waterFragment = /* glsl */ `
  #define PILLAR_CAP ${PILLAR_CAP}
  #define CONTACT_CAP ${CONTACT_CAP}
  #define BASIN_CAP ${BASIN_CAP}
  out vec4 waterColour;
  #define gl_FragColor waterColour
  in vec3 vWorld;
  in vec3 vFlow;

  #ifdef QUANTIZED_GROUND
  precision highp usampler2D;
  uniform usampler2D uHeight;
  uniform float uGroundScale, uGroundOffset;
  #else
  uniform sampler2D uHeight;
  #endif
  uniform vec2 uOrigin, uSize;
  uniform float uStep, uOutsideGroundHeight;
  uniform float uOpenSea;       // reach of the open sea in metres; 0 when the water has none
  uniform float uOpenSeaMesh;   // 1 on the open sea's own quads, which draw only outside the raster grid
  uniform int uMode;            // 0 basin, 1 course
  uniform vec4 uBasin;          // this basin: centre xz, radii
  uniform float uFeather;       // metres past the outline a basin may still draw
  uniform vec4 uBasins[BASIN_CAP];
  uniform float uBasinLevels[BASIN_CAP];
  uniform int uBasinCount;

  uniform vec3 uWind;           // three wrapped wind phases
  uniform float uWindAmp;
  uniform vec2 uFlowPhase;
  uniform vec2 uFlowOffset0, uFlowOffset1;
  uniform float uFlowPeriod;

  uniform vec3 uZenith, uHorizon, uGlow, uSun, uSunDirection, uAmbient, uFog;
  uniform float uSunIntensity, uAmbientIntensity, uNight, uFogDensity;

  uniform sampler2D uReflection;
  uniform mat4 uReflectMatrix;
  uniform float uReflectValid, uReflectLevel;

  uniform int uPillarCount;
  uniform vec4 uPillarPos[PILLAR_CAP];    // xyz, strength
  uniform vec4 uPillarShape[PILLAR_CAP];  // angular half width, length, kind (0 window, 1 lamp, 2 beacon)

  uniform int uContactCount;
  uniform vec4 uContactA[CONTACT_CAP];    // segment ends a.xz, b.xz
  uniform vec2 uContactB[CONTACT_CAP];    // radius, strength

  float groundTexel(ivec2 p) {
    // Raster coverage extends one cell past the source grid, repeating its final row and column.
    p = clamp(p, ivec2(0), textureSize(uHeight, 0) - ivec2(1));
    #ifdef QUANTIZED_GROUND
    return float(texelFetch(uHeight, p, 0).r) * uGroundScale + uGroundOffset;
    #else
    return texelFetch(uHeight, p, 0).r;
    #endif
  }

  float bedAt(vec2 grid) {
    grid = min(grid, uSize - 1.001);
    ivec2 p = ivec2(floor(grid));
    vec2 f = fract(grid);
    float h00 = groundTexel(p);
    float h10 = groundTexel(p + ivec2(1, 0));
    float h01 = groundTexel(p + ivec2(0, 1));
    float h11 = groundTexel(p + ivec2(1, 1));
    // The terrain mesh's fixed diagonal, so the waterline meets the visible bank exactly.
    return f.x <= f.y ? h00 + f.x * (h11 - h01) + f.y * (h01 - h00) : h00 + f.x * (h10 - h00) + f.y * (h11 - h10);
  }

  float bedHeight(vec2 world) {
    vec2 grid = (world - uOrigin) / uStep;
    vec2 past = max(max(-grid, grid - (uSize - 1.0)), vec2(0.0));
    if (past.x + past.y <= 0.0) return bedAt(grid);
    if (uOpenSea <= 0.0) return uOutsideGroundHeight;
    // The open sea's bed continues from the land's edge and falls to the deep bed: a step at the grid line would
    // read as a broken line through the water, where the shore's coverage term sees a cliff.
    return mix(bedAt(clamp(grid, vec2(0.0), uSize - 1.0)), uOutsideGroundHeight, smoothstep(0.0, 160.0, length(past) * uStep));
  }

  // A wave's slope, faded once its phase changes faster than about a pixel: no subpixel crawl.
  vec2 filteredSlope(vec2 p, vec2 dir, float k, float phase, float amp) {
    float a = dot(p, dir) * k - phase;
    float fade = 1.0 - smoothstep(0.7, 2.6, fwidth(a));
    return dir * (amp * cos(a) * fade);
  }

  // Flow detail: three short crossing ripples, isotropic so a bend never swims.
  vec2 flowSlope(vec2 p) {
    return filteredSlope(p, vec2(0.83, 0.56), 4.1, 0.0, 0.5)
         + filteredSlope(p, vec2(-0.44, 0.9), 5.7, 1.7, 0.34)
         + filteredSlope(p, vec2(0.97, -0.24), 7.9, 4.1, 0.22);
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  float segmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = dot(ab, ab) > 1e-6 ? clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0) : 0.0;
    return length(p - a - ab * t);
  }

  vec3 skyColour(vec3 r) {
    float altitude = clamp(r.y, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.55, altitude), 0.62));
    vec2 flatR = normalize(r.xz + vec2(1e-5)), flatSun = normalize(uSunDirection.xz + vec2(1e-5));
    float toward = pow(max(dot(flatR, flatSun), 0.0), 3.0) * (1.0 - smoothstep(0.0, 0.35, altitude));
    return sky + uGlow * toward * 0.9;
  }

  // The sky dome's own colour just under the horizon toward a flat direction (atmosphere.ts): where the open sea's far
  // reach meets the sky there is no line between them.
  vec3 domeHorizon(vec3 d) {
    vec3 flatD = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-4, 0.0, 0.0));
    vec3 sunFlat = normalize(vec3(uSunDirection.x, 0.0, uSunDirection.z) + vec3(1e-4, 0.0, 0.0));
    float sunward = max(dot(flatD, sunFlat), 0.0);
    vec3 colour = uHorizon + uGlow * (0.35 + 0.65 * sunward * sunward);
    colour += vec3(1.0, 0.74, 0.30) * length(uGlow) * 0.7 * uNight * (1.0 - uNight) * 5.0;
    colour += uSun * pow(max(dot(flatD, normalize(uSunDirection)), 0.0), 14.0) * (1.0 - uNight) * 0.14;
    return colour;
  }

  void main() {
    vec2 xz = vWorld.xz;
    float level = vWorld.y;
    if (uOpenSeaMesh > 0.5) {
      // The open sea also covers the raster's outermost cell: the land's volume ends there in faces at sea level,
      // which this mesh wins (a small polygon offset) instead of shimmering with them. Over open water a pixel drawn
      // twice cannot be seen.
      vec2 cell = (xz - uOrigin) / uStep;
      if (all(greaterThanEqual(cell, vec2(1.0))) && all(lessThan(cell, uSize - 2.0))) discard;
    }
    if (uMode == 0) {
      vec2 e = (xz - uBasin.xy) / uBasin.zw;
      if (length(e) > 1.0 + uFeather / min(uBasin.z, uBasin.w)) discard;
    } else {
      // A course yields to the basin it runs into wherever both lie at one level.
      for (int i = 0; i < BASIN_CAP; i++) {
        if (i >= uBasinCount) break;
        if (length((xz - uBasins[i].xy) / uBasins[i].zw) < 1.0 && abs(uBasinLevels[i] - level) < 0.08) discard;
      }
    }
    float depth = level - bedHeight(xz);
    if (depth <= 0.0) discard;
    float coverage = smoothstep(0.0, max(fwidth(depth), 0.02) * 1.5, depth);

    // ── Ripples: calm wind on still water, advected detail where the course moves. ──
    vec2 flow = vFlow.xy;
    float speed = length(flow);
    float bank = 1.0 - 0.55 * vFlow.z * vFlow.z;
    float lively = clamp(speed / 0.9, 0.0, 1.0) * bank;
    vec2 slope = filteredSlope(xz, vec2(0.91, 0.42), 0.26 * 4.0, uWind.x, 0.034)
               + filteredSlope(xz, vec2(-0.36, 0.93), 0.37 * 4.0, uWind.y, 0.024)
               + filteredSlope(xz, vec2(0.62, -0.78), 0.83 * 4.0, uWind.z, 0.016);
    slope *= uWindAmp * (1.0 - 0.6 * lively);
    vec2 drift0 = flow * uFlowPhase.x * uFlowPeriod, drift1 = flow * uFlowPhase.y * uFlowPeriod;
    float w0 = 1.0 - abs(1.0 - 2.0 * uFlowPhase.x);
    vec2 p0 = xz - drift0 + uFlowOffset0, p1 = xz - drift1 + uFlowOffset1;
    slope += (flowSlope(p0) * w0 + flowSlope(p1) * (1.0 - w0)) * 0.11 * lively;
    // Calm water stays nearly a mirror: roughness only where the surface moves.
    float rough = clamp(length(slope) * 6.0, 0.0, 1.0);
    vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));

    vec3 toEye = cameraPosition - vWorld;
    float distanceToEye = length(toEye);
    vec3 view = toEye / distanceToEye;
    float cosView = max(dot(view, normal), 0.0);
    float fresnel = 0.035 + 0.965 * pow(1.0 - cosView, 5.0);
    fresnel *= mix(1.0, 0.82, uNight);
    vec3 reflected = reflect(-view, normal);

    // ── Body colour: Beer–Lambert through the water's thickness along the view. ──
    float path = depth / max(view.y, 0.22);
    vec3 transmit = exp(-vec3(0.46, 0.15, 0.085) * path);
    float through = dot(transmit, vec3(0.3, 0.5, 0.2));
    vec3 lit = uAmbient * uAmbientIntensity * 0.55 + uSun * max(uSunDirection.y, 0.0) * uSunIntensity * 0.4;
    vec3 shallowTint = vec3(0.16, 0.42, 0.40), deepTint = vec3(0.045, 0.16, 0.27);
    vec3 scatter = mix(shallowTint, deepTint, smoothstep(0.3, 2.6, depth)) * lit;
    // Night keeps a cool body, never a black hole.
    scatter = mix(scatter, vec3(0.022, 0.05, 0.085) + uZenith * 0.12, uNight * 0.7);

    // ── What the water reflects. ──
    vec3 sky = skyColour(reflected);
    vec3 mirror = sky;
    // Water near the reflected plane takes the planar image; a course falling away from it fades to the reduced
    // path over a hand's breadth, so a sloping stream never shows a seam where its level leaves the plane.
    float planar = uReflectValid * (1.0 - smoothstep(0.1, 0.25, abs(level - uReflectLevel)));
    if (planar > 0.0) {
      vec4 projected = uReflectMatrix * vec4(xz.x, uReflectLevel, xz.y, 1.0);
      vec2 uv = projected.xy / projected.w;
      float settle = 1.0 - 0.6 * smoothstep(25.0, 140.0, distanceToEye);
      uv += vec2(normal.x * 0.035, normal.z * 0.075) * settle;
      // Soft vertical streaking: warm panes stretch into rippled pillars, roofs keep their silhouettes.
      float streak = (0.003 + 0.016 * rough) * settle;
      vec4 tex = texture(uReflection, uv) * 0.36
               + (texture(uReflection, uv + vec2(0.0, streak)) + texture(uReflection, uv - vec2(0.0, streak))) * 0.22
               + (texture(uReflection, uv + vec2(0.0, 2.6 * streak)) + texture(uReflection, uv - vec2(0.0, 2.6 * streak))) * 0.1;
      mirror = mix(sky, tex.rgb + sky * (1.0 - tex.a), planar);
    }

    // Analytic pillars: every light on the reduced path; lamps and the beacon always, since their glow is presentation,
    // not scene geometry the planar pass could carry. Windows on the reflected plane come from the planar image.
    vec3 flatForward = normalize(vec3(-view.x, 0.0, -view.z) + vec3(1e-5, 0.0, 0.0));
    vec3 side = vec3(-flatForward.z, 0.0, flatForward.x);
    vec3 pillars = vec3(0.0);
    for (int i = 0; i < PILLAR_CAP; i++) {
      if (i >= uPillarCount) break;
      vec4 shape = uPillarShape[i];
      // Windows on the reflected plane come from the planar image; elsewhere (and as it fades) analytically.
      float share = shape.z < 0.5 ? 1.0 - planar : 1.0;
      if (share <= 0.0) continue;
      vec3 toLight = uPillarPos[i].xyz - vWorld;
      vec3 d = normalize(toLight);
      float across = dot(reflected - d, side) / (shape.x + 0.004 + 0.012 * rough);
      float along = (reflected.y - d.y) / (shape.y * (0.45 + 1.6 * rough));
      float g = exp(-across * across - along * along);
      vec3 warm = shape.z > 1.5 ? vec3(1.0, 0.7, 0.36) * 2.0 : shape.z > 0.5 ? vec3(1.0, 0.6, 0.26) * 1.3 : vec3(1.0, 0.52, 0.2) * 0.95;
      pillars += warm * (uPillarPos[i].w * share) * g / (1.0 + length(toLight) / 60.0);
    }
    mirror += pillars;

    // Restrained sun or moon glint along the true reflected direction.
    float glint = pow(max(dot(reflected, normalize(uSunDirection)), 0.0), 90.0) * min(uSunIntensity, 1.3);
    mirror += uSun * glint * mix(0.9, 0.25, uNight) * (0.4 + rough);

    // ── Foam: only at real contacts and in fast shallow water, broken and advected. ──
    float contact = 0.0;
    for (int i = 0; i < CONTACT_CAP; i++) {
      if (i >= uContactCount) break;
      float edge = segmentDistance(xz, uContactA[i].xy, uContactA[i].zw) - uContactB[i].x;
      contact = max(contact, (1.0 - smoothstep(0.0, 0.32 + 0.3 * uContactB[i].y, max(edge, 0.0))) * uContactB[i].y);
    }
    contact = max(contact, smoothstep(0.7, 1.5, speed) * (1.0 - smoothstep(0.03, 0.2, depth)) * 0.55);
    float grain = noise(p0 * 2.6) * w0 + noise(p1 * 2.6) * (1.0 - w0);
    float grainFade = smoothstep(0.25, 0.9, fwidth(p0.x * 2.6) + fwidth(p0.y * 2.6));
    grain = mix(grain, 0.5, grainFade);
    float foam = contact * smoothstep(1.05 - contact, 1.3 - contact, grain + 0.2) * 0.8;
    vec3 foamColour = vec3(0.9, 0.92, 0.9) * (lit * 1.25 + 0.04);

    // Premultiplied over the bed: what passes through shows the real bed and stones.
    vec3 body = scatter * (1.0 - through);
    vec3 colour = body * (1.0 - fresnel) + mirror * fresnel;
    float alpha = 1.0 - through * (1.0 - fresnel);
    colour = colour * (1.0 - foam) + foamColour * foam;
    alpha = alpha * (1.0 - foam) + foam;
    // Distance haze, matching the voxel fog's share of the scene density.
    float haze = min(0.86, 1.0 - exp(-distanceToEye * uFogDensity));
    colour = mix(colour, uFog * alpha, haze);
    // The open sea's far reach becomes the horizon itself.
    if (uOpenSea > 0.0) colour = mix(colour, domeHorizon(-view) * alpha, smoothstep(uOpenSea * 0.12, uOpenSea * 0.7, length(toEye.xz)));
    // Tone map the straight colour, then premultiply by the shore's coverage-scaled alpha.
    gl_FragColor = vec4(colour / max(alpha, 1e-4), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    alpha *= coverage;
    gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha);
  }
`;
