/**
 * A dev-only bench for judging the lantern path home: a dusk street of stand-in houses curving away to your door, the
 * trail lit along it. Served by the web dev server at /src/play/lantern/bench.html; never a route, never in the build.
 * The houses and street are plain three.js stand-ins for the voxel town; only the lanterns are the real thing.
 *
 * Query: t=<ms> freezes the kindling at that time · hour=<0..24> (default 19.6, dusk) · walk=<metres> stands you that
 * far along the route · view=door looks at your door from close by · reduced=1.
 * Sets window.__chatdomReady once the frame is settled.
 */
import * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';
import { getEnvironment } from '@chatdom/render';
import { trailStops } from '../map/route';
import { createLanternTrail } from './trail';

const query = new URLSearchParams(location.search);
const frozen = query.has('t') ? Number(query.get('t')) : null;
const hour = Number(query.get('hour') ?? 19.6);
const walk = Number(query.get('walk') ?? 0);
const view = query.get('view') ?? 'walker';
const reduced = query.get('reduced') === '1';
const environment = getEnvironment(hour);

// A deterministic little random for the stand-in town.
let seed = 7;
const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/** Gentle swells in the land, so the pools are seen to lie on the ground rather than on a flat plane. */
const heightAt = (x: number, z: number) => 0.35 * Math.sin(x * 0.07 + 0.4) * Math.cos(z * 0.05) + 0.12 * Math.sin(z * 0.11 + x * 0.03);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = environment.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(environment.fog, 0.014);
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 600);

// Sky: lilac above, the last gold at the horizon toward the sun.
const sunDirection = new THREE.Vector3(...environment.sunDirection);
const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { zenith: { value: new THREE.Color(environment.zenith) }, horizon: { value: new THREE.Color(environment.horizon) },
    glow: { value: new THREE.Color(environment.glow) }, sun: { value: new THREE.Vector3(-0.9, 0.05, -0.4).normalize() } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 zenith, horizon, glow, sun; varying vec3 vDir;
    void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, zenith, pow(smoothstep(0.0, 0.55, h), 0.8));
      c += glow * pow(max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), sun), 0.0), 3.0) * (1.0 - smoothstep(0.0, 0.25, h)) * 1.4;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` }));
scene.add(sky);

scene.add(new THREE.HemisphereLight(new THREE.Color(environment.ambient), new THREE.Color(environment.shadow), environment.ambientIntensity * 2.8));
const key = new THREE.DirectionalLight(new THREE.Color(environment.sun), environment.sunIntensity * 1.6);
key.position.copy(sunDirection).multiplyScalar(50);
scene.add(key);

// The route: a street curving gently left then right, about 62 m to your door.
const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.5, 0, -16), new THREE.Vector3(-2.5, 0, -32),
  new THREE.Vector3(1, 0, -46), new THREE.Vector3(7, 0, -57), new THREE.Vector3(11, 0, -61),
]);
const points: Vec3[] = curve.getSpacedPoints(48).map(p => [p.x, heightAt(p.x, p.z), p.z]);
let length = 0;
for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![2] - points[i - 1]![2]);
const route = { points, length };
const stops = trailStops(route);
const pointAt = (metres: number) => curve.getPointAt(THREE.MathUtils.clamp(metres / length, 0, 1));
const tangentAt = (metres: number) => curve.getTangentAt(THREE.MathUtils.clamp(metres / length, 0, 1)).setY(0).normalize();

// Ground: dark turf, with the street laid on it as a cobbled ribbon.
function cobbles(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#3a3633'; g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) {
    const shade = 92 + Math.floor(random() * 40), warm = Math.floor(random() * 10);
    g.fillStyle = `rgb(${shade + warm},${shade + 2},${shade - 4 + Math.floor(random() * 8)})`;
    const x = col * 16 + (row % 2) * 8 + 1.5, y = row * 16 + 1.5;
    g.beginPath(); g.roundRect(x, y, 13, 13, 3.5); g.fill();
    g.fillStyle = 'rgba(255,240,220,0.08)'; g.fillRect(x + 2, y + 1.5, 9, 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
const land = new THREE.PlaneGeometry(240, 240, 120, 120).rotateX(-Math.PI / 2);
const landPosition = land.getAttribute('position');
for (let i = 0; i < landPosition.count; i++) landPosition.setY(i, heightAt(landPosition.getX(i), landPosition.getZ(i)) - 0.03);
land.computeVertexNormals();
scene.add(new THREE.Mesh(land, new THREE.MeshStandardMaterial({ color: '#4c5a40', roughness: 1 })));

const STREET = 4.6;
const streetPositions: number[] = [], streetUv: number[] = [], streetIndex: number[] = [];
const rows = 160;
for (let i = 0; i <= rows; i++) {
  const metres = (i / rows) * (length + 4) - 2;
  const p = pointAt(Math.max(0, metres)).add(tangentAt(Math.max(0, metres)).multiplyScalar(Math.min(0, metres)));
  const t = tangentAt(Math.max(0, metres)), right = new THREE.Vector3(-t.z, 0, t.x);
  for (const side of [-1, 1]) {
    const x = p.x + right.x * side * STREET / 2, z = p.z + right.z * side * STREET / 2;
    streetPositions.push(x, heightAt(x, z) + 0.012, z);
    streetUv.push((side + 1) / 2 * STREET / 1.6, metres / 1.6);
  }
  if (i < rows) { const a = i * 2; streetIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
}
const street = new THREE.BufferGeometry();
street.setAttribute('position', new THREE.Float32BufferAttribute(streetPositions, 3));
street.setAttribute('uv', new THREE.Float32BufferAttribute(streetUv, 2));
street.setIndex(streetIndex);
street.computeVertexNormals();
scene.add(new THREE.Mesh(street, new THREE.MeshStandardMaterial({ map: cobbles(), roughness: 0.92, color: '#b8b0a6' })));

// Stand-in houses along both sides, facing the street, some windows lit.
const plasters = ['#d9c7a8', '#c9b49a', '#e2d3b8', '#b9a48c', '#d4bfa3'], roofs = ['#6a3a32', '#4e4a5a', '#7a4a2c', '#3f4a5c'];
const windowMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.5, 0.16).multiplyScalar(1.5) });
const darkWindow = new THREE.MeshStandardMaterial({ color: '#283044', roughness: 0.4 });
const doorMaterial = new THREE.MeshStandardMaterial({ color: '#4a2f1d', roughness: 0.9 });
function house(x: number, z: number, facing: number, width: number, depth: number, height: number, lights: boolean, door = true): THREE.Group {
  const group = new THREE.Group();
  const plaster = new THREE.MeshStandardMaterial({ color: plasters[Math.floor(random() * plasters.length)]!, roughness: 1 });
  const roof = new THREE.MeshStandardMaterial({ color: roofs[Math.floor(random() * roofs.length)]!, roughness: 1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), plaster);
  body.position.y = height / 2 - 0.3; group.add(body);
  const pitch = depth * 0.55;
  const shape = new THREE.Shape([new THREE.Vector2(-depth / 2 - 0.35, 0), new THREE.Vector2(depth / 2 + 0.35, 0), new THREE.Vector2(0, pitch)]);
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: width + 0.5, bevelEnabled: false }), roof);
  gable.rotation.y = Math.PI / 2; gable.position.set(-width / 2 - 0.25, height - 0.3, 0); group.add(gable);
  // Front faces +z in the house frame.
  for (const wx of [-width * 0.28, width * 0.28]) for (const wy of [1.3, height - 0.5]) {
    if (wy > height - 0.6 && random() < 0.4) continue;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.78), lights && random() < 0.55 ? windowMaterial : darkWindow);
    pane.position.set(wx + (door && wy < 2 ? (wx < 0 ? -0.3 : 0.3) : 0), wy, depth / 2 + 0.01); group.add(pane);
  }
  if (door) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.95, 0.08), doorMaterial); d.position.set(0, 0.97 - 0.3, depth / 2 + 0.02); group.add(d); }
  group.position.set(x, heightAt(x, z), z);
  group.rotation.y = facing;
  scene.add(group);
  return group;
}
for (let metres = 3; metres < length - 8; metres += 8.5 + random() * 3) for (const side of [-1, 1]) {
  if (random() < 0.15) continue;
  const p = pointAt(metres), t = tangentAt(metres), right = new THREE.Vector3(-t.z, 0, t.x).multiplyScalar(side);
  const depth = 4.2 + random(), offset = STREET / 2 + 2.6 + depth / 2 + random() * 0.8;
  const facing = Math.atan2(-right.x, -right.z);
  house(p.x + right.x * offset, p.z + right.z * offset, facing, 4.4 + random() * 1.6, depth, 3.1 + random() * 1.4, true);
}

// Your home at the end of the route, its door on the step where the route ends.
const end = points[points.length - 1]!;
const endTangent = tangentAt(length);
const outward: [number, number] = [-endTangent.x, -endTangent.z];
const homeDepth = 5;
const homeFront = 0.32;
house(end[0] - outward[0] * (homeFront + homeDepth / 2), end[2] - outward[1] * (homeFront + homeDepth / 2), Math.atan2(outward[0], outward[1]), 5.6, homeDepth, 4.2, false);

// You: a small stand-in figure on the street.
const feetPoint = pointAt(walk);
const feet: [number, number, number] = view === 'door' ? [end[0] + outward[0] * 6, 0, end[2] + outward[1] * 6] : [feetPoint.x, 0, feetPoint.z];
feet[1] = heightAt(feet[0], feet[2]);
const walker = new THREE.Group();
const cloth = new THREE.MeshStandardMaterial({ color: '#3d5a8a', roughness: 1 }), skin = new THREE.MeshStandardMaterial({ color: '#e0b48e', roughness: 1 });
const part = (w: number, h: number, d: number, y: number, m: THREE.Material, x = 0) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, 0); walker.add(mesh); };
part(0.16, 0.5, 0.18, 0.25, cloth, -0.1); part(0.16, 0.5, 0.18, 0.25, cloth, 0.1); part(0.46, 0.55, 0.28, 0.78, cloth); part(0.4, 0.4, 0.38, 1.27, skin);
walker.position.set(...feet);
const heading = view === 'door' ? new THREE.Vector3(-outward[0], 0, -outward[1]) : tangentAt(walk);
walker.rotation.y = Math.atan2(heading.x, heading.z);
scene.add(walker);

if (view === 'door') {
  const side = new THREE.Vector3(-heading.z, 0, heading.x);
  camera.position.set(feet[0] - heading.x * 4.5 - side.x * 2.2, feet[1] + 2.2, feet[2] - heading.z * 4.5 - side.z * 2.2);
  camera.lookAt(end[0], end[1] + 1.4, end[2]);
} else {
  camera.position.set(feet[0] - heading.x * 5.5, feet[1] + 3.6, feet[2] - heading.z * 5.5);
  const ahead = pointAt(walk + 16);
  camera.lookAt(ahead.x, heightAt(ahead.x, ahead.z) + 0.4, ahead.z);
}

const trail = createLanternTrail({ scene, groundAt: heightAt, reducedMotion: () => reduced });
trail.setDoor({ position: end, outward });
trail.light(stops, 0);

const ready = window as Window & { __chatdomReady?: boolean; __lanterns?: unknown };
ready.__lanterns = { trail, stops: stops.length, length };
if (frozen !== null) {
  // Walk the clock up to the frozen time so eased values (the door) arrive as they would live.
  for (let now = 0; now < frozen; now += 16) trail.frame(now, feet, hour);
  trail.frame(frozen, feet, hour);
  renderer.render(scene, camera);
  requestAnimationFrame(() => { renderer.render(scene, camera); ready.__chatdomReady = true; });
} else {
  const start = performance.now();
  const loop = () => {
    const now = performance.now() - start;
    trail.frame(now, feet, hour);
    renderer.render(scene, camera);
    if (now > 2500) ready.__chatdomReady = true;
    requestAnimationFrame(loop);
  };
  loop();
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.render(scene, camera); });
