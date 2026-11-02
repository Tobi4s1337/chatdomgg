import * as THREE from 'three';
import { getEnvironment } from '@chatdom/render';
import {
  PORTRAIT_FIXTURES, earnedOffers, seedLook, subLapsed, twitchDefaultLook, wearPiece, type CitizenLook,
} from '../../../../packages/content/src/avatar-style';
import { BENCH_RECORDS } from './bench-records';
import { citizenGlassMaterial, citizenMaterial, citizenObject } from './portrait-renderer';

/*
 * Full-body lineup (spec 49 acceptance): twenty invented citizens standing on a cobbled square in the
 * kingdom's own light for the hour. `?view=stream` frames them at stream distance (a citizen is about a tenth of
 * a 1080p frame tall); `?view=close` frames them large enough to judge clothes. `?set=fixtures|seeded|earned`,
 * `?hour=19.25` (dusk by default).
 */
declare global { interface Window { __chatdomReady?: boolean } }

const params = new URLSearchParams(location.search);
const view = params.get('view') === 'close' ? 'close' : 'stream';
const hour = Number(params.get('hour') ?? 19.25);
const set = params.get('set') === 'seeded' ? 'seeded' : params.get('set') === 'earned' ? 'earned' : 'fixtures';

/**
 * `?set=earned`: twenty invented people from the bench's earning records, each in their Twitch default look
 * wearing a different handful of what they have earned (ribbons, hood, pins, scarf, capes, forged hat), so the
 * pieces can be judged at the size chat sees them. Lapsed subscribers wear theirs dimmed.
 */
function earnedLineup(): { name: string; look: CitizenLook; dim: boolean }[] {
  const personas = [BENCH_RECORDS.veteran, BENCH_RECORDS.regular, BENCH_RECORDS.lapsed, BENCH_RECORDS.veteran];
  const names = ['#8A2BE2', '#1E90FF', '#2E8B57', '#FF7F50', '#DAA520'];
  return Array.from({ length: 20 }, (_, i) => {
    const e = personas[i % personas.length]!;
    let look = twitchDefaultLook({ personId: `bench-earner-${i + 1}`, nameColour: names[i % names.length]!, entitlements: e });
    const owned = earnedOffers(e).filter(o => o.unlocked);
    // A different selection per person: walk the owned pieces with a stride so neighbours differ.
    for (let k = 0; k < 3; k++) {
      const offer = owned[(i * 3 + k * (i % 3 + 1)) % owned.length];
      if (offer) look = wearPiece(look, offer.piece);
    }
    return { name: `Earner ${i + 1}`, look, dim: subLapsed(e) };
  });
}
const people: readonly { name: string; look: CitizenLook; dim?: boolean }[] = set === 'seeded'
  ? Array.from({ length: 20 }, (_, i) => ({ name: `Viewer ${i + 1}`, look: seedLook(`bench-viewer-${i + 1}`) }))
  : set === 'earned' ? earnedLineup() : PORTRAIT_FIXTURES;
const title = { seeded: 'Twenty seeded default looks', earned: 'Twenty people wearing what they earned', fixtures: 'Twenty hand-made citizens' }[set];
document.querySelector('#what')!.textContent = `${title} · ${view === 'stream' ? 'stream distance' : 'close'} · hour ${hour}`;

const env = getEnvironment(hour);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = env.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// The sky: the hour's zenith over its horizon, with the warm glow low toward the sun.
{
  const canvas = Object.assign(document.createElement('canvas'), { width: 4, height: 256 });
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, env.zenith); g.addColorStop(.62, env.horizon); g.addColorStop(1, new THREE.Color(env.horizon).lerp(new THREE.Color(env.glow), .5).getStyle());
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  scene.background = texture;
}
scene.fog = new THREE.Fog(env.fog, view === 'stream' ? 30 : 14, view === 'stream' ? 90 : 60);
scene.add(new THREE.HemisphereLight(env.ambient, env.shadow, env.ambientIntensity * 3));
// Sky bounce from the open square in front of them, so faces read at every hour, as the kingdom's crowd does.
const bounce = new THREE.DirectionalLight(env.ambient, .55);
bounce.position.set(-4, 6, 20);
scene.add(bounce);
const key = new THREE.DirectionalLight(env.sun, env.sunIntensity * 2.4);
key.position.set(...env.sunDirection.map(v => v * 30) as [number, number, number]);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 80 });
key.shadow.bias = -.0004; key.shadow.normalBias = .03;
scene.add(key, key.target);

// A cobbled square: half-metre setts in three stone tones with a little height jitter.
{
  const size = .5, nx = 110, nz = 100;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size * .94, .12, size * .94), new THREE.MeshStandardMaterial({ roughness: .9 }), nx * nz);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const stones = ['#8a8279', '#7a736c', '#968c80', '#6f6a66'];
  let i = 0;
  for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) {
    const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453 % 1;
    m.makeTranslation((x - nx / 2 + .5) * size, -.06 + Math.abs(h) * .02, (z - nz + 40) * size);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(stones[Math.floor(Math.abs(h) * 997) % stones.length]!));
    i++;
  }
  mesh.receiveShadow = true;
  // Mortar under the setts.
  const mortar = new THREE.Mesh(new THREE.PlaneGeometry(nx * size, nz * size), new THREE.MeshStandardMaterial({ color: '#4a443f', roughness: 1 }));
  mortar.rotation.x = -Math.PI / 2;
  mortar.position.set(0, -.1, (40 - nz / 2) * size - size / 2);
  mortar.receiveShadow = true;
  scene.add(mesh, mortar);
}

// Lanterns on posts: the warm sources that carry dusk in the kingdom.
const lanterns = view === 'stream' ? [[-9, -3], [0, -6], [9, -3]] : [[-6.5, -2.5], [6.5, -2.5]];
for (const [x, z] of lanterns as [number, number][]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(.18, 2.6, .18), new THREE.MeshStandardMaterial({ color: '#3b2a20', roughness: .8 }));
  post.position.set(x, 1.3, z); post.castShadow = true;
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(.38, .42, .38), new THREE.MeshStandardMaterial({ color: '#ffcc7a', emissive: '#ffb25a', emissiveIntensity: 2.4 }));
  lamp.position.set(x, 2.7, z);
  const light = new THREE.PointLight('#ffb062', 26, 14, 1.6);
  light.position.set(x, 2.6, z + .3);
  scene.add(post, lamp, light);
}

// The citizens, in two staggered rows, each turned a little toward the camera.
const material = citizenMaterial(), glass = citizenGlassMaterial();
const perRow = 10, spacing = view === 'stream' ? 1.55 : 1.25;
people.forEach(({ look, dim }, i) => {
  const row = Math.floor(i / perRow), col = i % perRow;
  const citizen = citizenObject(look, { dim: !!dim }, material, glass);
  citizen.scale.setScalar(1 / 16);
  citizen.position.set((col - (perRow - 1) / 2) * spacing + (row ? spacing / 2 : 0), 0, row ? -1.8 : 0);
  citizen.rotation.y = -.35 + Math.sin(i * 2.3) * .18;
  scene.add(citizen);
});

const camera = new THREE.PerspectiveCamera(view === 'stream' ? 28 : 24, innerWidth / innerHeight, .1, 200);
if (view === 'stream') { camera.position.set(-6, 9.5, 30); camera.lookAt(0, .6, -1); }
else { camera.position.set(-2.5, 2.6, 17.5); camera.lookAt(0, .78, -.9); }

renderer.render(scene, camera);
requestAnimationFrame(() => { renderer.render(scene, camera); window.__chatdomReady = true; });
