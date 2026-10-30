import { createSignal, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import type { WalkInput } from '@chatdom/shared/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createCitizenRenderer, createDefaultCitizenLooks } from '../citizens';
import { connectReferenceRealm, type RealmClient, type RealmWalkerPose } from '../realm/client';
import { createWalkController, type WalkController, type WalkDebug } from '../walk';
import './style.css';

type DebugRealm = { ready: boolean; poses: readonly RealmWalkerPose[]; setInput: (input: Partial<WalkInput> | null) => void; client?: RealmClient };
declare global { interface Window { __chatdomRealm?: DebugRealm; __chatdomWalk?: Readonly<WalkDebug> } }

export default function RealmReference() {
  let host!: HTMLDivElement;
  let labels!: HTMLDivElement;
  let stop = () => {};
  const [status, setStatus] = createSignal('Opening the court…');
  const [error, setError] = createSignal(false);
  onMount(() => {
    window.__chatdomReady = false;
    const debug: DebugRealm = { ready: false, poses: [], setInput: () => {} };
    window.__chatdomRealm = debug;
    let cancelled = false;
    let frame = 0;
    let client: RealmClient | undefined;
    let walk: WalkController | undefined;
    let citizen: Awaited<ReturnType<typeof createCitizenRenderer>> | undefined;
    const scene = new THREE.Scene();
    const environment = getEnvironment(19);
    scene.background = new THREE.Color(environment.fog);
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 150);
    camera.position.set(8, 5, 17); camera.lookAt(0, 1, 6);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.setAttribute('aria-label', 'A small dusk court with connected visitors');
    host.append(renderer.domElement);
    const material = createVoxelMaterial(MATERIALS, 'avatar');
    material.setEnvironment(environment);
    material.material.fragmentShader = material.material.fragmentShader.replace('float sky=mix(.24,1.,vSky);', 'float sky=mix(.72,1.,vSky);').replace('vec3 colour=base*edge*light*ao;', 'vec3 colour=base*edge*(light+vec3(.4,.32,.25))*ao;');
    scene.add(new THREE.HemisphereLight(0xffd9aa, 0x504654, 2));
    const sun = new THREE.DirectionalLight(0xffc98a, 2); sun.position.set(-8, 15, 12); scene.add(sun);
    const objects: THREE.Mesh[] = [];
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, colour: string) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: colour, roughness: 1 }));
      mesh.position.set(x, y, z); scene.add(mesh); objects.push(mesh);
    };
    box(0, -.3, 0, 36, .6, 36, '#656a58');
    box(0, -.08, 3, 18, .16, 20, '#817d6d');
    // Slightly varied stones make the court read as a laid surface without
    // adding collision geometry or changing the shared ground datum.
    const pavingGeometry = new THREE.BoxGeometry(.95, .025, .95);
    const pavingMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    const paving = new THREE.InstancedMesh(pavingGeometry, pavingMaterial, 18 * 20);
    const tileMatrix = new THREE.Matrix4();
    const tileColours = ['#a9a18e', '#9d9989', '#b3a995', '#969382'];
    let tile = 0;
    for (let z = -7; z < 13; z++) for (let x = -9; x < 9; x++) {
      tileMatrix.makeTranslation(x + .5, -.012, z + .5); paving.setMatrixAt(tile, tileMatrix);
      paving.setColorAt(tile, new THREE.Color(tileColours[Math.abs((x * 13 + z * 7) % tileColours.length)]!)); tile++;
    }
    scene.add(paving);
    const shadowGeometry = new THREE.CircleGeometry(.34, 20); shadowGeometry.rotateX(-Math.PI / 2);
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#302c2a', transparent: true, opacity: .23, depthWrite: false });
    const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, 64); shadows.count = 0; shadows.frustumCulled = false; scene.add(shadows);
    // The two obstacles match the reference world's collision boxes.
    box(-2, .75, -1, 2, 1.5, 2, '#a49b88');
    box(4, .25, -1.5, 2, .5, 3, '#9c9380');
    for (let x = -8; x <= 8; x += 4) {
      box(x, .12, 11.5, 3.75, .24, .32, '#c5af88');
      box(x, .12, -7, 3.75, .24, .32, '#c5af88');
    }
    let override: Partial<WalkInput> | null = null;
    debug.setInput = input => { override = input; };
    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight;
      if (!width || !height) return;
      if(walk)walk.resize(width,height);
      else {
        camera.aspect = width / height;
        camera.lookAt(0, 1, 6); camera.updateProjectionMatrix();
      }
      renderer.setSize(width,height);
    };
    window.addEventListener('resize', resize); resize();
    const looks = createDefaultCitizenLooks();
    const drawLabels = (poses: readonly RealmWalkerPose[]) => {
      labels.replaceChildren();
      for (const pose of poses) {
        if(pose.self&&(walk?.selfOpacity??1)<.05)continue;
        const point = new THREE.Vector3(pose.x, pose.y + 1.9, pose.z).project(camera);
        if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) continue;
        const label = document.createElement('span');
        label.className = 'realm-reference-name'; label.textContent = pose.self ? `${pose.name} · you` : pose.name;
        label.style.left = `${(point.x + 1) * 50}%`; label.style.top = `${(1 - point.y) * 50}%`;
        labels.append(label);
      }
    };
    stop = () => {
      cancelled = true; cancelAnimationFrame(frame); window.removeEventListener('resize', resize);
      walk?.dispose(); client?.dispose(); citizen?.dispose(); material.dispose();
      for (const mesh of objects) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
      pavingGeometry.dispose(); pavingMaterial.dispose(); paving.dispose(); shadowGeometry.dispose(); shadowMaterial.dispose(); shadows.dispose();
      renderer.dispose(); renderer.domElement.remove(); delete window.__chatdomRealm; delete window.__chatdomWalk; window.__chatdomReady = false;
    };
    void (async () => {
      const people = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity: 64 });
      if (cancelled) { people.dispose(); return; }
      citizen = people;
      const connected = await connectReferenceRealm();
      if (cancelled) { connected.dispose(); return; }
      client = connected; debug.client = connected;
      // The existing reference smoke hook can supply explicit input; the same real client still ticks once.
      walk=createWalkController({camera,surface:renderer.domElement,hud:host,collision:REFERENCE_WORLD,realm:{selfId:connected.selfId,room:connected.room,
        get predicted(){return connected.predicted;},
        clearInput:()=>connected.clearInput(),
        tick:(now,input)=>connected.tick(now,{...input,...override})}});
      window.__chatdomWalk=walk.debug;
      resize();
      setStatus('Connected');
      const draw = (now: number) => {
        if (cancelled || !client || !citizen) return;
        const poses = walk!.frame(now);
        debug.poses = poses;
        citizen.update(poses.map(pose => ({ id: pose.id, look: looks.find(look => look.id === pose.look)?.id ?? looks[0]!.id, position: [pose.x, pose.y, pose.z], heading: pose.yaw * Math.PI * 2 / 256, distance: pose.distance, moving: Math.min(1, pose.speed / 1.2), speed: pose.speed, time: now / 1000, opacity:pose.self?walk!.selfOpacity:1 })), camera);
        shadows.count = 0;
        for (const pose of poses) { tileMatrix.makeTranslation(pose.x, .012, pose.z); shadows.setMatrixAt(shadows.count++, tileMatrix); }
        shadows.instanceMatrix.needsUpdate = true;
        renderer.render(scene, camera); drawLabels(poses);
        if (!debug.ready) { debug.ready = true; window.__chatdomReady = true; }
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
      connected.room.onLeave(() => { if (!cancelled) { walk?.release();window.__chatdomReady=false;setError(true); setStatus('Connection closed. Refresh to return to the court.'); debug.ready = false; cancelAnimationFrame(frame); } });
    })().catch(reason => { if (!cancelled) { setError(true); setStatus(`Could not enter the court: ${reason instanceof Error ? reason.message : String(reason)}`); } });
  });
  onCleanup(() => stop());
  return <main class="realm-reference"><div class="realm-reference-scene" ref={element=>{host=element;}}><div class="realm-reference-labels" ref={element=>{labels=element;}} /></div><header class="realm-reference-header"><p>CHATDOM · THE COURT</p><h1>Meet at dusk</h1><span class="realm-reference-sim">SIMULATED</span></header><div class="realm-reference-info"><p classList={{ 'realm-reference-error': error() }} role="status">{status()}</p><p>W A S D to walk · Shift to run · Space to jump · Drag to look · Wheel to zoom</p><p>Each visitor is another connected browser.</p></div></main>;
}
