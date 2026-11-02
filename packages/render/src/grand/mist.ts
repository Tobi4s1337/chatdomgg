import * as THREE from 'three';

/**
 * The sea mist over the land a kingdom has not opened yet (GW13). One shader chunk shared by every surface of the
 * land (terrain, groves, rivers, lakes and the open sea), so the mist lies as one weather over all of it: thick and
 * pale in the valleys, thinning so the high crowns stand out of it, its edge rolling with a slow drift instead of
 * stopping at a line. It reads a clearness mask (255 clear, 0 under mist) laid over the land's columns, and when a
 * milestone opens more of the land it lifts from the previous mask to the next.
 *
 * The mask is data the land already has (`packages/world/src/grand/reveal.ts`); nothing here decides what is open.
 */
export const LAND_MIST_GLSL = /* glsl */ `
  uniform sampler2D uMistMask, uMistMaskFrom;
  uniform vec4 uMistRect;
  uniform float uMistOn, uMistLift, uMistOutside, uMistOutsideFrom, uMistDeck, uMistTime;
  uniform vec3 uMistColour;
  float mistHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float mistValue(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(mistHash(i), mistHash(i + vec2(1., 0.)), f.x), mix(mistHash(i + vec2(0., 1.)), mistHash(i + vec2(1., 1.)), f.x), f.y);
  }
  float mistBillow(vec2 p) { return mistValue(p) * .55 + mistValue(p * 2.3 + 5.2) * .3 + mistValue(p * 5.1 - 2.7) * .15; }
  float mistClear(vec2 uv) {
    bool inside = all(greaterThanEqual(uv, vec2(0.))) && all(lessThan(uv, vec2(1.)));
    float to = inside ? texture(uMistMask, uv).r : uMistOutside;
    float from = inside ? texture(uMistMaskFrom, uv).r : uMistOutsideFrom;
    // The lift rolls back from the open edge: thin mist goes first, the thick heart of it last. Never below either mask.
    return max(min(from, to), mix(from, to, clamp(uMistLift * 1.35 - (1. - to) * .35, 0., 1.)));
  }
  /**
   * The mist over a surface point: rgb its colour, a its cover (0 clear, 1 whole). Under the deck it hides the land
   * outright; crowns above it show through. Its edge is warped by slow noise, so it never follows the mask's cells.
   */
  vec4 landMist(vec3 world) {
    if (uMistOn < .5) return vec4(0.);
    vec2 drift = vec2(uMistTime * .9, uMistTime * .55);
    float clear = mistClear((world.xz - uMistRect.xy) / uMistRect.zw);
    float billow = mistBillow((world.xz + drift) * .011);
    // Open land (clear 1) carries no mist at all; through the feathered band the billows break the edge into wisps.
    float edge = smoothstep(0., 1., (1. - clear) * (.7 + billow * .6));
    float deck = 1. - smoothstep(uMistDeck - 4., uMistDeck + 42., world.y);
    float cover = smoothstep(0., .5, edge) * mix(.3, 1., deck);
    // Lit tops and cool hollows, so the mist reads as a sea of cloud and not a colour laid on the land.
    vec3 shade = uMistColour * vec3(.74, .77, .88);
    vec3 colour = mix(shade, uMistColour * 1.04, smoothstep(.25, .8, billow));
    return vec4(colour, cover);
  }
`;

/** The colour the mist takes from the hour: the fog's own colour, lifted toward lit cloud by day. */
export function landMistColour(target: THREE.Color, fog: THREE.Color, sun: THREE.Color, night: number): THREE.Color {
  const day = 1 - Math.min(1, Math.max(0, night));
  // Cloud, not haze: whiter than the fog by day, its colour only at night, warmed by a low sun.
  target.copy(fog).lerp(new THREE.Color(0.9, 0.9, 0.92), 0.6 * day);
  return target.lerp(sun.clone().multiplyScalar(0.85), 0.16 * day);
}

export interface LandMistUniforms {
  uMistMask: THREE.IUniform<THREE.Texture>;
  uMistMaskFrom: THREE.IUniform<THREE.Texture>;
  uMistRect: THREE.IUniform<THREE.Vector4>;
  uMistOn: THREE.IUniform<number>;
  uMistLift: THREE.IUniform<number>;
  uMistOutside: THREE.IUniform<number>;
  uMistOutsideFrom: THREE.IUniform<number>;
  uMistDeck: THREE.IUniform<number>;
  uMistTime: THREE.IUniform<number>;
  uMistColour: THREE.IUniform<THREE.Color>;
}

/**
 * Feather a clearness mask outward into the mist: a two-pass box blur of `radius` cells, never below the mask itself.
 * Open cells stay exactly open, so softening the edge never hides land that is open; and like the mask it is
 * pointwise monotone (a clearer mask always feathers to a clearer one).
 */
export function featherMistMask(mask: Uint8Array, cells: number, radius = 2): Uint8Array {
  let a = Float32Array.from(mask), b = new Float32Array(a.length);
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    for (let row = 0; row < cells; row++) {
      let sum = 0;
      const at = (i: number) => from[horizontal ? row * cells + Math.min(cells - 1, Math.max(0, i)) : Math.min(cells - 1, Math.max(0, i)) * cells + row]!;
      for (let i = -radius; i <= radius; i++) sum += at(i);
      for (let i = 0; i < cells; i++) {
        to[horizontal ? row * cells + i : i * cells + row] = sum / (2 * radius + 1);
        sum += at(i + radius + 1) - at(i - radius);
      }
    }
  };
  for (let round = 0; round < 2; round++) { pass(a, b, true); pass(b, a, false); }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(mask[i]!, Math.round(a[i]!));
  return out;
}

function maskTexture(mask: Uint8Array, cells: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(mask, cells, cells, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1; texture.needsUpdate = true;
  return texture;
}

export interface LandMist {
  /** Shared uniform objects: spread into every land material that includes `LAND_MIST_GLSL`. */
  readonly uniforms: LandMistUniforms;
  /**
   * Lay a stage's clearness mask over the land. `rect` is the mask's world origin and size (x, z, width, depth);
   * `outside` is how clear the world beyond the land's columns is (the open sea): 1 only once the whole land is.
   * With `lift` the mist rolls back from the previous mask over that many seconds; without it the mask is laid at once.
   */
  set(mask: Uint8Array, cells: number, rect: readonly [number, number, number, number], outside: number, lift?: number): void;
  /** Advance the drift and any lift. Returns true while the mist is still lifting. */
  update(seconds: number, colour: { fog: THREE.Color; sun: THREE.Color; night: number }): boolean;
  /** The world height the cloud deck sits at. */
  setDeck(y: number): void;
  readonly lifting: boolean;
  dispose(): void;
}

export function createLandMist(): LandMist {
  const clear = maskTexture(new Uint8Array([255]), 1);
  const uniforms: LandMistUniforms = {
    uMistMask: { value: clear }, uMistMaskFrom: { value: clear }, uMistRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uMistOn: { value: 0 }, uMistLift: { value: 1 }, uMistOutside: { value: 1 }, uMistOutsideFrom: { value: 1 },
    uMistDeck: { value: 40 }, uMistTime: { value: 0 }, uMistColour: { value: new THREE.Color(0.9, 0.9, 0.92) },
  };
  let current: THREE.DataTexture = clear, previous: THREE.DataTexture | null = null, liftSeconds = 0, lifted = 1;
  const owned = new Set<THREE.Texture>([clear]);
  return {
    uniforms,
    set(mask, cells, rect, outside, lift) {
      if (!Number.isInteger(cells) || cells < 1 || mask.length !== cells * cells || !rect.every(Number.isFinite) || rect[2] <= 0 || rect[3] <= 0)
        throw new RangeError('The land mist needs one clearness byte per cell over a finite rectangle');
      const texture = maskTexture(featherMistMask(mask, cells), cells);
      owned.add(texture);
      if (previous && previous !== current) { previous.dispose(); owned.delete(previous); }
      const animate = lift !== undefined && lift > 0 && uniforms.uMistOn.value > 0.5;
      previous = animate ? current : null;
      if (!animate && current !== clear) { current.dispose(); owned.delete(current); }
      uniforms.uMistMaskFrom.value = animate ? current : texture;
      uniforms.uMistOutsideFrom.value = animate ? uniforms.uMistOutside.value : outside;
      uniforms.uMistMask.value = texture; uniforms.uMistOutside.value = outside;
      uniforms.uMistRect.value.set(...rect); uniforms.uMistOn.value = 1;
      current = texture; liftSeconds = animate ? lift! : 0; lifted = animate ? 0 : 1; uniforms.uMistLift.value = lifted;
    },
    update(seconds, colour) {
      uniforms.uMistTime.value += Math.max(0, seconds);
      landMistColour(uniforms.uMistColour.value, colour.fog, colour.sun, colour.night);
      if (lifted >= 1) return false;
      lifted = Math.min(1, lifted + Math.max(0, seconds) / liftSeconds);
      // Ease in and out: the mist starts to stir, rolls back, then settles.
      uniforms.uMistLift.value = lifted * lifted * (3 - 2 * lifted);
      if (lifted >= 1 && previous) { uniforms.uMistMaskFrom.value = current; uniforms.uMistOutsideFrom.value = uniforms.uMistOutside.value; previous.dispose(); owned.delete(previous); previous = null; }
      return lifted < 1;
    },
    setDeck(y) { if (Number.isFinite(y)) uniforms.uMistDeck.value = y; },
    get lifting() { return lifted < 1; },
    dispose() { for (const texture of owned) texture.dispose(); owned.clear(); },
  };
}

/** A mist that never falls: what a material shades with when its land is all open. Never call `set` on it. */
export const NO_MIST: Pick<LandMist, 'uniforms'> = { uniforms: createLandMist().uniforms };
