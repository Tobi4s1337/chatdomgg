import { onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { parseRaidGuestVisualMark } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createCitizenRenderer, createDefaultCitizenLooks } from '../citizens';
import { createGuestCrest, createGuestInsigniaLayer } from './guest-insignia';
import './guest-insignia.css';

/** Private visual fixture: the same citizen and accessory renderers the host uses. */
export default function GuestInsigniaBench() {
  let canvas!: HTMLCanvasElement, labels!: HTMLDivElement;
  let cleanup = () => {};
  onMount(() => {
    let closed = false;
    const pool = new VoxelWorkerPool({ size: 2 });
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#cbb89a');
    const camera = new THREE.OrthographicCamera(-3, 3, 2, -2, .1, 100);
    camera.position.set(0, 2.7, 10); camera.lookAt(0, .85, 0);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: '#968b73', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.04; scene.add(ground);
    scene.add(new THREE.HemisphereLight('#fff1cf', '#756d5b', 2));
    const light = new THREE.DirectionalLight('#ffe5b7', 2); light.position.set(-3, 7, 5); scene.add(light);
    const avatar = createVoxelMaterial(MATERIALS, 'avatar'), cloth = createVoxelMaterial(MATERIALS, 'build');
    avatar.setEnvironment(getEnvironment(12)); cloth.setEnvironment(getEnvironment(12));
    const looks = createDefaultCitizenLooks();
    const now = 1_700_000_000_000;
    const marks = [
      { raidId: `raid.${'a'.repeat(64)}`, fromKingdomId: '12826', fromName: 'MashaD4', expiresAt: now + 60_000 },
      { raidId: `raid.${'b'.repeat(64)}`, fromKingdomId: '129634568', fromName: 'tobi4s_', expiresAt: now + 60_000 },
    ];
    const poses = [
      { id: 'ash', look: looks[0]!.id, position: [-1.45, 0, 0] as const, heading: -.12, distance: 0, moving: 0, raidGuest: marks[0] },
      { id: 'fern', look: looks[1]!.id, position: [0, 0, 0] as const, heading: .12, distance: 0, moving: 0, raidGuest: marks[1] },
      { id: 'host', look: looks[2]!.id, position: [1.45, 0, 0] as const, heading: -.08, distance: 0, moving: 0 },
    ];
    void (async () => {
      const people = await createCitizenRenderer(scene, { registry: MATERIALS, material: avatar, looks, capacity: 3, pool });
      const insignia = await createGuestInsigniaLayer(scene, cloth.material, pool, () => now);
      if (closed) { people.dispose(); insignia.dispose(); return; }
      for (const [i, name] of ['Ash', 'Fern', 'Rowan'].entries()) {
        const label = document.createElement('span'); label.className = 'guest-bench-label';
        const mark = parseRaidGuestVisualMark(marks[i], now);
        if (mark) { const crest = createGuestCrest(mark); if (crest) label.append(crest); }
        label.append(document.createTextNode(name)); labels.append(label);
      }
      const draw = () => {
        const w = canvas.clientWidth, h = canvas.clientHeight, aspect = w / h;
        const viewWidth = aspect < 1 ? 4.5 : 5.0;
        camera.left = -viewWidth / 2; camera.right = viewWidth / 2; camera.top = viewWidth / aspect / 2; camera.bottom = -camera.top;
        camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
        people.update(poses, camera); insignia.update(poses, camera); renderer.render(scene, camera);
        (window as Window & { __chatdomReady?: boolean; __guestInsignia?: unknown }).__chatdomReady = true;
        (window as Window & { __guestInsignia?: unknown }).__guestInsignia = { count: insignia.count, poses: poses.length };
      };
      draw(); window.addEventListener('resize', draw);
      cleanup = () => { window.removeEventListener('resize', draw); people.dispose(); insignia.dispose(); };
    })().catch(error => { console.error(error); });
    onCleanup(() => { closed = true; cleanup(); pool.dispose(); renderer.dispose(); ground.geometry.dispose(); (ground.material as THREE.Material).dispose(); avatar.dispose(); cloth.dispose(); });
  });
  return <main class="guest-bench"><div class="guest-bench-top"><p>THE RAID GATE <span>✦</span> A WELCOME</p><h1>Among friends</h1><p>Two visitors arrive in their own colours.</p></div><canvas ref={element => { canvas = element; }} aria-label="Three citizens at the gate, two wearing their raiding kingdoms' colours"/><div ref={element => { labels = element; }} class="guest-bench-labels"/><div class="guest-bench-foot">A CREST FOR THE ROAD <span>✦</span> A PLACE AT THE GATE</div></main>;
}
