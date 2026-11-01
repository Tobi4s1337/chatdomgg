import * as THREE from 'three';
import type { Environment } from '@chatdom/render';
import type { SkyGlow } from './view';

/**
 * The town under the sky moment: the hour's grade, answered by the sky. The renderer lights every voxel surface from
 * the grade's sky fill (`ambient`, `ambientIntensity`), its key light (`sun`, the moon after dusk) and its shadow
 * tint; this bends those few values and nothing else, so the moment lands on the same lighting model the town
 * already has. Warm windows, lamps and the beacon come from the light fields and are never touched: when the sky
 * deepens they read brighter by contrast, which is the point.
 *
 * - `night` (Skyfire's dimming, up to 0.55): the sky fill and moonlight sink with the painted sky, toward indigo.
 * - `hush` (the lamps' held breath before a staged climax, up to 0.45): the sky fill dips a little more.
 * - `colour`/`strength` (the aurora's green, a burst's flash; strength up to 0.6): the moonlight and the sky fill
 *   take the light's hue, so roofs and walls facing the sky go green under the aurora and flash with a shell.
 *
 * Pure: the same grade and glow give the same result. With no glow (or an empty one) it returns the grade as is.
 * Direction, exposure, fog and the sky itself are left alone: the sky's own answer is drawn by the moment's veil.
 */
export function skyLitEnvironment(grade: Environment, glow: SkyGlow | null | undefined): Environment {
  if (!glow) return grade;
  const night = clamp(glow.night ?? 0, 0, 0.6), hush = clamp(glow.hush ?? 0, 0, 0.5), strength = clamp(glow.strength, 0, 0.6);
  if (night < 1e-3 && hush < 1e-3 && strength < 1e-3) return grade;
  const light = new THREE.Color().setRGB(...glow.colour);
  const peak = Math.max(light.r, light.g, light.b);
  if (peak > 1e-6) light.multiplyScalar(1 / peak); else light.setRGB(0, 0, 0);
  const dusk = new THREE.Color(INDIGO);
  // The dusk is drawn down first (toward indigo, never grey), then the moment's own light colours what is left: under
  // the aurora the key light is mostly its green, so roofs facing the sky go cool and green rather than just brighter.
  const ambient = new THREE.Color(grade.ambient).lerp(dusk, night * 0.8).lerp(light, strength * 0.9);
  const sun = new THREE.Color(grade.sun).lerp(dusk, night * 0.7).lerp(light, Math.min(0.9, strength * 2));
  const shadow = new THREE.Color(grade.shadow).lerp(dusk, night * 0.6).lerp(light.clone().multiplyScalar(0.5), strength * 0.5);
  return {
    ...grade,
    ambient: `#${ambient.getHexString()}`,
    sun: `#${sun.getHexString()}`,
    shadow: `#${shadow.getHexString()}`,
    // The sky fill sinks with the sky and the hush, then the moment's own light lifts it back a little.
    ambientIntensity: grade.ambientIntensity * (1 - 0.45 * night) * (1 - 0.5 * hush) * (1 + 0.4 * strength),
    // The moonlight carries the aurora onto the roofs: it dims with the dusk, then the glow gives some of it back.
    sunIntensity: grade.sunIntensity * (1 - 0.45 * night) + strength * 0.45,
  };
}

/** A deep blue-violet: where the sky fill goes as the dusk is drawn down. */
const INDIGO = '#2a2f63';

function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low;
}
