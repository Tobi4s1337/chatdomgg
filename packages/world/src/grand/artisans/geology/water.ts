/**
 * Presentation-only water observations from the grand land's canonical half-metre columns.
 * Water and ground store top y + 1; water <= ground or zero is dry. No sample grants collision,
 * creates water, or proves a waterfall: the current GrandLand discards Shaped.fall and drainage edges.
 */
export interface WaterColumns {
  readonly size: number;
  readonly ground: Uint16Array;
  readonly water: Uint16Array;
}
export interface WaterObservation {
  readonly wet: boolean;
  readonly level: number;
  readonly depth: number;
  /** Number of known, dry cardinal neighbours; edges of the supplied field are unknown, not shore. */
  readonly dryNeighbours: number;
  /** Greatest positive level difference to an adjacent wet column, in source cells. */
  readonly largestWetDrop: number;
  /** (dx,dz) to the lowest adjacent wet column, or null. A visual hint, not a flow vector. */
  readonly lowerNeighbour: readonly [number, number] | null;
}

export function createWaterDressSampler(field: WaterColumns) {
  const { size, ground, water } = field;
  if (!Number.isSafeInteger(size) || size <= 0 || ground.length !== size * size || water.length !== size * size) {
    throw new RangeError('water dressing requires complete square ground and water fields');
  }
  return (x: number, z: number): WaterObservation | null => {
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= size || z >= size) return null;
    const i = x + z * size, level = water[i]!, floor = ground[i]!;
    if (level === 0 || level <= floor) return { wet: false, level: 0, depth: 0, dryNeighbours: 0, largestWetDrop: 0, lowerNeighbour: null };
    let dryNeighbours = 0, largestWetDrop = 0;
    let lowerNeighbour: WaterObservation['lowerNeighbour'] = null;
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const n = nx + nz * size, adjacent = water[n]!;
      if (adjacent === 0 || adjacent <= ground[n]!) { dryNeighbours++; continue; }
      const drop = level - adjacent;
      if (drop > largestWetDrop) { largestWetDrop = drop; lowerNeighbour = [dx, dz]; }
    }
    return { wet: true, level, depth: level - floor, dryNeighbours, largestWetDrop, lowerNeighbour };
  };
}

/**
 * Shader dressing for the existing kind-9 material, supplied as a source fragment for the
 * renderer to adopt. WORLD POSITION is in metres; animation time is seconds. This intentionally
 * does not classify every vertical face as a proven waterfall or invent emissive light.
 * Requires GRAND_COMMON's vnoise and skyColour and the existing uTime/uSunDir/uSunColor uniforms.
 */
export const GRAND_WATER_DRESS_GLSL = /* glsl */ `
  vec3 grandDressWater(vec3 base, vec3 light, vec3 cool, float shadow,
                       vec3 view, vec3 n, vec3 world) {
    if (abs(n.y) < .5) {
      // Both falls and exposed banks reach this branch. Keep a deep water body visible;
      // the sparse pale turbulence follows world space and does not repaint a whole cliff white.
      float across = abs(n.x) > .5 ? world.z : world.x;
      float channel = vnoise(vec2(across * .14, world.y * .025));
      float run = vnoise(vec2(across * .38 + channel * .8, world.y * .16 + uTime * .55));
      float foam = smoothstep(.65, .9, run) * (.28 + .12 * channel);
      vec3 body = base * (light * .8 + vec3(.14));
      vec3 pale = mix(base * 1.35, vec3(.60, .76, .78), .48) * (light * .65 + vec3(.35));
      return mix(body, pale, foam);
    }
    vec2 wave = vec2(vnoise(world.xz * .8 + uTime * .6) - .5,
                     vnoise(world.zx * .8 - uTime * .5) - .5);
    vec3 wn = normalize(vec3(wave.x * .35, 1., wave.y * .35));
    vec3 r = reflect(view, wn);
    float fresnel = .04 + .96 * pow(1. - max(dot(-view, wn), 0.), 5.);
    vec3 body = base * (cool * .7 + uSunColor * .18 * shadow);
    return mix(body, skyColour(r, false), fresnel * .85)
      + uSunColor * pow(max(dot(r, uSunDir), 0.), 220.) * 2. * shadow;
  }
`;
