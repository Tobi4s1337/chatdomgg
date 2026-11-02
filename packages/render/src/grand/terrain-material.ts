import * as THREE from 'three';
import { GRAND_COMMON, type GrandUniforms } from './light';
import { LAND_MIST_GLSL, NO_MIST, type LandMistUniforms } from './mist';

/**
 * Shading for the grand land's packed quads (see packages/voxel/src/grand/quad-mesher.ts for the words).
 * Detail lives here, not in geometry, so greedy rectangles stay large: per-voxel colour jitter from a hash
 * of the cell, a slow macro tint, face shading, edge bevels near the camera, strata and snow from the
 * material table, waterfalls and still water, emissive glows. Light is a warm sun through a soft shadow
 * map and drifting cloud shadows against cool sky light, darkened by baked corner AO and a height-field
 * sky occlusion; aerial perspective takes the distance.
 */
export const GRAND_QUAD_VERTEX = /* glsl */ `
  precision highp float; precision highp int;
  uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
  uniform float uLodScale;
  in vec3 position;
  in uvec2 aQuad;
  out vec3 vWorld; out float vAo; flat out vec3 vNormal; flat out uint vMaterial;
  void main(){
    uint a = aQuad.x, b = aQuad.y;
    uint face = (a >> 25u) & 7u;
    vec3 cell = vec3(float(a & 31u), float((a >> 5u) & 31u), float((a >> 10u) & 31u));
    float w = float(((a >> 15u) & 31u) + 1u), h = float(((a >> 20u) & 31u) + 1u);
    uint slot = b >> 16u;
    vec3 chunk = vec3(float(slot & 15u), float((slot >> 4u) & 15u), float((slot >> 8u) & 15u)) * 32.;
    int axis = int(face >> 1u);
    bool positive = (face & 1u) == 0u;
    int c = gl_VertexID & 3;
    if (((a >> 28u) & 1u) == 1u) c = (c + 1) & 3;
    if (!positive) c = (4 - c) & 3;
    float du = (c == 1 || c == 2) ? w : 0., dv = (c >= 2) ? h : 0.;
    vec3 uAxis = axis == 0 ? vec3(0,1,0) : axis == 1 ? vec3(0,0,1) : vec3(1,0,0);
    vec3 vAxis = axis == 0 ? vec3(0,0,1) : axis == 1 ? vec3(1,0,0) : vec3(0,1,0);
    vec3 n = axis == 0 ? vec3(1,0,0) : axis == 1 ? vec3(0,1,0) : vec3(0,0,1);
    vec3 p = chunk + cell + uAxis * du + vAxis * dv;
    if (positive) p += n; else n = -n;
    vec4 world = modelMatrix * vec4(p, 1.);
    vWorld = world.xyz;
    vNormal = n;
    vAo = float(((b >> 8u) >> (2u * uint(c))) & 3u) / 3.;
    vMaterial = b & 255u;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  precision highp float; precision highp int; precision highp sampler2DShadow;
  uniform vec3 cameraPosition;
  uniform sampler2D uPalette, uCloudMap, uSkyAo;
  uniform sampler2DShadow uShadowMap;
  uniform mat4 uShadowMatrix;
  uniform float uShadowTexel, uShadowOn, uShadowSoft, uCloudTile, uCloudHeight, uCloudShadow, uLandMetres, uSeaLevel, uClipBelow, uVoxel, uLodScale, uWindow;
  uniform vec2 uCloudOffset;
  in vec3 vWorld; in float vAo; flat in vec3 vNormal; flat in uint vMaterial;
  out vec4 outColour;
  ${GRAND_COMMON}
  ${LAND_MIST_GLSL}
  const vec2 POISSON[12] = vec2[12](vec2(-.326,-.406), vec2(-.840,-.074), vec2(-.696,.457), vec2(-.203,.621), vec2(.962,-.195), vec2(.473,-.480),
    vec2(.519,.767), vec2(.185,-.893), vec2(.507,.064), vec2(.896,.412), vec2(-.322,-.933), vec2(-.792,-.598));
  float sunShadow(vec3 world, vec3 n){
    if (uShadowOn < .5) return 1.;
    vec3 p = world + n * (uVoxel * uLodScale * 0.6) + uSunDir * 0.15;
    vec4 s = uShadowMatrix * vec4(p, 1.);
    vec3 c = s.xyz * .5 + .5;
    if (any(lessThan(c, vec3(0.))) || any(greaterThan(c, vec3(1.)))) return 1.;
    float spin = hash12(gl_FragCoord.xy) * 6.2831;
    mat2 r = mat2(cos(spin), sin(spin), -sin(spin), cos(spin));
    float sum = 0.;
    for (int i = 0; i < 12; i++) sum += texture(uShadowMap, vec3(c.xy + r * POISSON[i] * uShadowTexel * uShadowSoft, c.z - 0.0004));
    return sum / 12.;
  }
  float cloudShadow(vec3 world){
    vec3 s = normalize(uSunDir);
    vec2 p = world.xz + s.xz / max(s.y, .12) * (uCloudHeight - world.y);
    float cover = texture(uCloudMap, (p - uCloudOffset) / uCloudTile).r;
    return 1. - uCloudShadow * smoothstep(.25, .75, cover);
  }
  void main(){
    if (vWorld.y < uClipBelow) discard;
    vec4 swatch = texelFetch(uPalette, ivec2(int(vMaterial), 0), 0);
    vec3 base = swatch.rgb;
    int kind = int(swatch.a + .5);
    vec3 n = vNormal;
    float cellSize = uVoxel * uLodScale;
    vec3 cell = floor(vWorld / cellSize - n * .5);
    float distanceToEye = length(cameraPosition - vWorld);
    float pixel = distanceToEye * 0.0011;
    float near = 1. - smoothstep(cellSize * 1.5, cellSize * 6., pixel);
    // Colour inside a colour: a hundred shades of one material, then a slow drift across the land.
    float jitterAmount = kind == 6 ? .2 : kind == 4 ? .14 : kind == 1 ? .09 : kind == 5 ? .05 : kind == 8 ? .12 : .1;
    float j = hash13(cell + 17.3);
    base *= 1. + jitterAmount * (j - .5);
    float macro = vnoise(vWorld.xz / 48.) - .5;
    base *= 1. + macro * (kind == 1 ? .16 : .08);
    if (kind == 1) base = mix(base, base * vec3(1.06, 1.03, .86), smoothstep(.1, .4, macro));
    if (kind == 6) { float sun = vnoise(cell.xz * .35 + cell.y * .2); base *= .92 + .16 * sun; }
    // Classic face shading under real light: it keeps voxels reading as voxels at a distance.
    float faceShade = n.y > .5 ? 1. : n.y < -.5 ? .62 : abs(n.x) > .5 ? .86 : .9;
    // Bevel: a sanded edge catches the light near the camera.
    vec3 f = fract(vWorld / cellSize + 1e-3);
    vec2 inFace = abs(n.x) > .5 ? f.yz : abs(n.y) > .5 ? f.xz : f.xy;
    float edge = min(min(inFace.x, 1. - inFace.x), min(inFace.y, 1. - inFace.y));
    float bevel = (1. - smoothstep(.0, .09, edge)) * near;
    vec2 skyUv = vWorld.xz / uLandMetres;
    vec2 occluder = texture(uSkyAo, skyUv).rg;
    float sky = 1. - .5 * smoothstep(0., 7., occluder.r - vWorld.y) - .32 * smoothstep(0., 30., occluder.g - vWorld.y);
    sky = clamp(sky, .25, 1.);
    float ao = mix(.38, 1., vAo);
    float diffuse = max(dot(n, uSunDir), 0.);
    if (kind == 6) diffuse = max((dot(n, uSunDir) + .35) / 1.35, 0.);
    float shadow = diffuse > 0. ? sunShadow(vWorld, n) * cloudShadow(vWorld) : 0.;
    vec3 skyLight = mix(uGroundColor, uSkyColor, .5 + .5 * n.y) * (.55 + .45 * sky);
    vec3 cool = mix(uShadowTint, skyLight, .55 + .45 * sky) * .9;
    vec3 light = uSunColor * diffuse * shadow + cool * ao * sky;
    vec3 colour = base * faceShade * light * (1. + bevel * .16);
    vec3 view = normalize(vWorld - cameraPosition);
    if (kind == 5 || kind == 12) {
      // Snow: blue in the shade, a cold glitter in the sun.
      colour += uSunColor * pow(max(dot(reflect(view, n), uSunDir), 0.), 40.) * .25 * shadow * hash13(cell * 1.7);
      colour = mix(colour, colour * vec3(.86, .92, 1.08), (1. - shadow) * .5);
    }
    if (kind == 9) {
      if (abs(n.y) < .5) {
        // A waterfall: white water running down the face.
        float column = hash12(floor(vWorld.xz / cellSize));
        float run = fract(vWorld.y * .55 + uTime * 1.6 + column * 3.1);
        float foam = smoothstep(.2, .85, run) * (.6 + .4 * column);
        colour = mix(base * light * .8, vec3(.92, .96, 1.) * (light + .25), .45 + .5 * foam);
      } else {
        vec2 wave = vec2(vnoise(vWorld.xz * .8 + uTime * .6) - .5, vnoise(vWorld.zx * .8 - uTime * .5) - .5);
        vec3 wn = normalize(vec3(wave.x * .35, 1., wave.y * .35));
        vec3 r = reflect(view, wn);
        float fresnel = .04 + .96 * pow(1. - max(dot(-view, wn), 0.), 5.);
        vec3 body = base * (cool * .7 + uSunColor * .18 * shadow);
        colour = mix(body, skyColour(r, false), fresnel * .85) + uSunColor * pow(max(dot(r, uSunDir), 0.), 220.) * 3. * shadow;
      }
    }
    if (kind == 10) colour = base * (2.4 + 1.2 * uNight) + colour * .3;
    if (kind == 7 && near > 0.) colour *= 1. - .08 * near * step(.5, fract(vWorld.y / cellSize * .5 + hash12(cell.xz)));
    vec4 mist = landMist(vWorld); colour = mix(colour, mist.rgb, mist.a);
    colour = aerial(colour, vWorld, cameraPosition);
    outColour = vec4(colour, 1.);
  }
`;

/** `mist` is the land's sea mist (GW13); without one the land is all open. */
export function createGrandTerrainMaterial(uniforms: GrandUniforms, palette: THREE.DataTexture, mist: LandMistUniforms = NO_MIST.uniforms): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...uniforms, ...mist, uPalette: { value: palette }, uLodScale: { value: 1 } },
    vertexShader: GRAND_QUAD_VERTEX,
    fragmentShader: fragment,
  });
}

/** Depth-only twin for the sun's shadow map: identical vertex positions, nothing shaded. */
export function createGrandDepthMaterial(): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uLodScale: { value: 1 } },
    vertexShader: GRAND_QUAD_VERTEX,
    fragmentShader: /* glsl */ `precision highp float; out vec4 outColour; void main(){ outColour = vec4(1.); }`,
  });
}

/** sRGB hex palette (RGBA float, alpha = kind) to a linear 256×1 texture. */
export function grandPaletteTexture(table: Float32Array): THREE.DataTexture {
  const linear = new Float32Array(table.length);
  for (let i = 0; i < table.length; i += 4) {
    for (let c = 0; c < 3; c++) { const v = table[i + c]!; linear[i + c] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
    linear[i + 3] = table[i + 3]!;
  }
  const texture = new THREE.DataTexture(linear, 256, 1, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}
