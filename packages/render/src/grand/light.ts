import * as THREE from 'three';

/**
 * The grand land's hours. Authored, not physical: the sun keeps one path relative to the land (set by the
 * kingdom's orientation), and every hour has its own grade (Artstyle §6.2): a warm sun against a cool sky,
 * long violet shadows at golden hour, lilac over gold at dusk, deep blue at night.
 */
export interface GrandGrade {
  readonly hour: number;
  readonly sunDirection: THREE.Vector3;
  readonly sun: THREE.Color;
  readonly sunIntensity: number;
  readonly sky: THREE.Color;
  readonly ground: THREE.Color;
  readonly shadow: THREE.Color;
  readonly zenith: THREE.Color;
  readonly horizon: THREE.Color;
  readonly glow: THREE.Color;
  readonly fog: THREE.Color;
  readonly fogSun: THREE.Color;
  readonly fogDensity: number;
  readonly cloud: THREE.Color;
  readonly cloudShade: THREE.Color;
  readonly night: number;
  readonly exposure: number;
  readonly stars: number;
}

interface Key {
  hour: number; sun: string; sunIntensity: number; sky: string; ground: string; shadow: string; zenith: string; horizon: string; glow: string;
  fog: string; fogSun: string; fogDensity: number; cloud: string; cloudShade: string; night: number; exposure: number; stars: number;
}

// Colours are sRGB; intensities feed a linear HDR pipeline with AgX at the end.
const KEYS: Key[] = [
  { hour: 0, sun: '#9fb4e8', sunIntensity: 0.32, sky: '#3a4f86', ground: '#141a2c', shadow: '#1c2448', zenith: '#050a22', horizon: '#1a2650', glow: '#000000', fog: '#18244a', fogSun: '#22306a', fogDensity: 0.00042, cloud: '#1c2848', cloudShade: '#101a34', night: 1, exposure: 1.25, stars: 1 },
  { hour: 5.2, sun: '#ffb09a', sunIntensity: 0.4, sky: '#6a6ab0', ground: '#2c2430', shadow: '#3a3a78', zenith: '#2c3470', horizon: '#e6a088', glow: '#a04830', fog: '#8a7aa2', fogSun: '#f0a080', fogDensity: 0.0006, cloud: '#c89aa8', cloudShade: '#6a5a84', night: 0.6, exposure: 1.1, stars: 0.3 },
  { hour: 7, sun: '#ffd8a8', sunIntensity: 2.6, sky: '#8aa6e0', ground: '#4c4030', shadow: '#4a58a8', zenith: '#4c7cc8', horizon: '#f2d6b8', glow: '#b06a3a', fog: '#c6c8d8', fogSun: '#ffd0a0', fogDensity: 0.00048, cloud: '#fff4ea', cloudShade: '#b8b4cc', night: 0, exposure: 1.0, stars: 0 },
  { hour: 12, sun: '#fff2dc', sunIntensity: 3.1, sky: '#8ab4f0', ground: '#58503a', shadow: '#4e68b8', zenith: '#2e6cd0', horizon: '#b4d4f2', glow: '#806040', fog: '#b0cdea', fogSun: '#fff0d8', fogDensity: 0.00032, cloud: '#ffffff', cloudShade: '#b4c4e0', night: 0, exposure: 0.95, stars: 0 },
  { hour: 15.5, sun: '#ffe6bc', sunIntensity: 3.0, sky: '#8aaee8', ground: '#5a4c34', shadow: '#5260b0', zenith: '#3a72cc', horizon: '#d6dcea', glow: '#a07040', fog: '#c2cadc', fogSun: '#ffe2b0', fogDensity: 0.00036, cloud: '#fffaf0', cloudShade: '#bcc0d8', night: 0, exposure: 0.98, stars: 0 },
  // Golden hour: the reference frame. Sun low and amber, sky blue overhead, a gold veil to the horizon.
  { hour: 17.6, sun: '#ffcc84', sunIntensity: 3.3, sky: '#8ea4dc', ground: '#5c4428', shadow: '#5650a8', zenith: '#4a78c4', horizon: '#f4d6a0', glow: '#e09048', fog: '#d6c8b4', fogSun: '#ffd080', fogDensity: 0.00046, cloud: '#fff0d8', cloudShade: '#c4a8b4', night: 0, exposure: 1.02, stars: 0 },
  { hour: 18.7, sun: '#ff9c58', sunIntensity: 2.4, sky: '#8a86c8', ground: '#4a3020', shadow: '#4c4096', zenith: '#5a68b4', horizon: '#f6a868', glow: '#f07a30', fog: '#c09ca8', fogSun: '#ffa058', fogDensity: 0.00055, cloud: '#f4c0a8', cloudShade: '#a07898', night: 0.1, exposure: 1.08, stars: 0 },
  // Dusk: the accepted indigo dusk. Indigo fill from the sky, a thin warm band on the horizon, the sun's last
  // light faint on the peaks; the land goes indigo while the windows wake (GK11).
  { hour: 19.6, sun: '#e0a49a', sunIntensity: 0.42, sky: '#5a62b4', ground: '#1c1c36', shadow: '#2a2c6e', zenith: '#22286c', horizon: '#e4a078', glow: '#8a4432', fog: '#46488a', fogSun: '#b8787a', fogDensity: 0.00056, cloud: '#7c72a8', cloudShade: '#34336a', night: 0.6, exposure: 1.22, stars: 0.2 },
  { hour: 20.8, sun: '#a8b4e8', sunIntensity: 0.38, sky: '#4c5c9a', ground: '#181c30', shadow: '#222a58', zenith: '#121a44', horizon: '#3a3c6c', glow: '#5a2c30', fog: '#283466', fogSun: '#3a3c70', fogDensity: 0.0005, cloud: '#2a3458', cloudShade: '#161e3c', night: 0.9, exposure: 1.25, stars: 0.8 },
  { hour: 24, sun: '#9fb4e8', sunIntensity: 0.32, sky: '#3a4f86', ground: '#141a2c', shadow: '#1c2448', zenith: '#050a22', horizon: '#1a2650', glow: '#000000', fog: '#18244a', fogSun: '#22306a', fogDensity: 0.00042, cloud: '#1c2848', cloudShade: '#101a34', night: 1, exposure: 1.25, stars: 1 },
];

const wrap = (hour: number) => (Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 17.6);

/**
 * Sun direction for an hour. `azimuth` is the land's sunset bearing in radians (world XZ). The sun rises
 * opposite it, arcs through the high sky, and sits about 9° up at golden hour; at night the moon stands
 * high over the far side, so the land keeps a key light.
 */
export function grandSunDirection(hour: number, azimuth: number): THREE.Vector3 {
  const h = wrap(hour);
  const day = (h - 6.2) / (19.2 - 6.2);
  if (day >= 0 && day <= 1) {
    const elevation = Math.sin(day * Math.PI) * 1.02 + 0.03;
    const bearing = azimuth + Math.PI * (1 - day);
    return new THREE.Vector3(Math.cos(bearing) * Math.cos(elevation), Math.sin(elevation), Math.sin(bearing) * Math.cos(elevation)).normalize();
  }
  const moonBearing = azimuth + Math.PI * 0.62;
  return new THREE.Vector3(Math.cos(moonBearing) * 0.62, 0.78, Math.sin(moonBearing) * 0.62).normalize();
}

export function grandGrade(hour: number, azimuth: number): GrandGrade {
  const h = wrap(hour);
  const index = KEYS.findIndex(key => key.hour > h);
  const a = KEYS[Math.max(0, index - 1)]!, b = KEYS[index]!;
  const u = (h - a.hour) / (b.hour - a.hour), t = u * u * (3 - 2 * u);
  const c = (key: keyof Key) => new THREE.Color(a[key] as string).lerp(new THREE.Color(b[key] as string), t);
  const n = (key: keyof Key) => (a[key] as number) + ((b[key] as number) - (a[key] as number)) * t;
  return {
    hour: h, sunDirection: grandSunDirection(h, azimuth), sun: c('sun'), sunIntensity: n('sunIntensity'), sky: c('sky'), ground: c('ground'),
    shadow: c('shadow'), zenith: c('zenith'), horizon: c('horizon'), glow: c('glow'), fog: c('fog'), fogSun: c('fogSun'), fogDensity: n('fogDensity'),
    cloud: c('cloud'), cloudShade: c('cloudShade'), night: n('night'), exposure: n('exposure'), stars: n('stars'),
  };
}

/**
 * The uniform block every grand material shares by reference: light, haze, shadow and the land's maps.
 * Materials put these objects in their `uniforms`, so one update reaches the terrain, sea, clouds and sky.
 */
export function createGrandUniforms() {
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  blank.needsUpdate = true;
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSkyColor: { value: new THREE.Color() },
    uGroundColor: { value: new THREE.Color() },
    uShadowTint: { value: new THREE.Color() },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uFogColor: { value: new THREE.Color() },
    uFogSun: { value: new THREE.Color() },
    uFogDensity: { value: 0.0004 },
    uFogBase: { value: 24 },
    uNight: { value: 0 },
    uStars: { value: 0 },
    uCloudColor: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uShadowMap: { value: null as THREE.Texture | null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowTexel: { value: 1 / 2048 },
    uShadowOn: { value: 0 },
    uShadowSoft: { value: 1.6 },
    uCloudMap: { value: blank as THREE.Texture },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudTile: { value: 3072 },
    uCloudHeight: { value: 260 },
    uCloudShadow: { value: 0.5 },
    uSkyAo: { value: blank as THREE.Texture },
    uLandMetres: { value: 768 },
    uSeaLevel: { value: 24 },
    uClipBelow: { value: -1e6 },
    uVoxel: { value: 0.5 },
    uWindow: { value: 0 },
  };
}
export type GrandUniforms = ReturnType<typeof createGrandUniforms>;

export function applyGrade(uniforms: GrandUniforms, grade: GrandGrade): void {
  const lin = (c: THREE.Color) => c.clone().convertSRGBToLinear();
  uniforms.uSunDir.value.copy(grade.sunDirection);
  uniforms.uSunColor.value.copy(lin(grade.sun)).multiplyScalar(grade.sunIntensity);
  uniforms.uSkyColor.value.copy(lin(grade.sky));
  uniforms.uGroundColor.value.copy(lin(grade.ground));
  uniforms.uShadowTint.value.copy(lin(grade.shadow));
  uniforms.uZenith.value.copy(lin(grade.zenith));
  uniforms.uHorizon.value.copy(lin(grade.horizon));
  uniforms.uGlow.value.copy(lin(grade.glow));
  uniforms.uFogColor.value.copy(lin(grade.fog));
  uniforms.uFogSun.value.copy(lin(grade.fogSun));
  uniforms.uFogDensity.value = grade.fogDensity;
  uniforms.uNight.value = grade.night;
  uniforms.uStars.value = grade.stars;
  uniforms.uCloudColor.value.copy(lin(grade.cloud));
  uniforms.uCloudShade.value.copy(lin(grade.cloudShade));
}

/** GLSL shared by grand materials: hashes, the sky and aerial perspective. Needs the uniform block above. */
export const GRAND_COMMON = /* glsl */ `
  uniform vec3 uSunDir, uSunColor, uSkyColor, uGroundColor, uShadowTint, uZenith, uHorizon, uGlow, uFogColor, uFogSun, uCloudColor, uCloudShade;
  uniform float uFogDensity, uFogBase, uNight, uStars, uTime;
  float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
  // The sky seen along a direction: zenith over horizon, a gold veil toward the sun, the disc itself.
  vec3 skyColour(vec3 d, bool disc){
    float y = d.y;
    vec3 base = mix(uHorizon, uZenith, pow(clamp(y, 0., 1.), 0.55));
    base = mix(base, uFogColor * 0.9, smoothstep(0.02, -0.25, y));
    float sun = max(dot(d, uSunDir), 0.);
    vec3 glow = uGlow * (pow(sun, 6.) * 0.9 + pow(sun, 32.) * 1.6) * (1. - 0.6 * smoothstep(0.1, 0.6, y));
    vec3 col = base + glow + uFogSun * pow(sun, 3.) * 0.18 * (1. - smoothstep(0., 0.35, y));
    if (disc) col += uSunColor * smoothstep(0.9993, 0.99965, sun) * 6. * (1. - uNight);
    return col;
  }
  // Analytic height fog with sun in-scatter (Quilez, "Better fog"), toward a sky-coloured horizon.
  vec3 aerial(vec3 col, vec3 world, vec3 eye){
    vec3 rd = world - eye; float dist = length(rd); rd /= max(dist, 1e-3);
    float b = 0.012;
    float h = max(eye.y - uFogBase, 0.);
    float dy = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
    float optical = uFogDensity * exp(-b * h) * (1. - exp(-b * dy * dist)) / (b * dy);
    optical += uFogDensity * 0.22 * dist;
    float fog = 1. - exp(-optical);
    float sun = max(dot(rd, uSunDir), 0.);
    vec3 tint = mix(uFogColor, uFogSun, pow(sun, 7.) * 0.85);
    tint = mix(tint, skyColour(normalize(vec3(rd.x, max(rd.y, 0.02), rd.z)), false), 0.35);
    return mix(col, tint, clamp(fog, 0., 0.97));
  }
`;
