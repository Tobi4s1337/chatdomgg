import { createSignal, onCleanup, onMount } from 'solid-js';
import * as THREE from 'three';
import { loadContentCollection, MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, geometryFromChunks, getEnvironment, createWindowLights } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { KingdomPresenceFrameSchema, VOXEL_METRES, type VoxelBlueprint } from '@chatdom/shared';
import './style.css';
import { loadBenchFixture } from './fixtures';

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomContent?: { collection: string; asset: string; angle: string; triangles: number; draws: number; models: number; assetIds: readonly string[]; scene: string; presence: string };
    __chatdomContentError?: string;
    __chatdomContentView?: (angle: string) => void;
  }
}

function assetBounds(blueprint: VoxelBlueprint): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (const box of blueprint.boxes) if (box.material !== 0) {
    bounds.expandByPoint(new THREE.Vector3(...box.from).multiplyScalar(VOXEL_METRES.build));
    bounds.expandByPoint(new THREE.Vector3(...box.to).multiplyScalar(VOXEL_METRES.build));
  }
  if (bounds.isEmpty()) throw new Error('The selected asset has no occupied geometry.');
  return bounds;
}

export function ContentBench() {
  let host!: HTMLDivElement;
  let disposed = false;
  let disposeScene: (() => void) | undefined;
  const [status, setStatus] = createSignal('Preparing the model…');
  const [failed, setFailed] = createSignal(false);
  const params = new URLSearchParams(window.location.search);
  const collection = params.get('collection') ?? 'core';
  const angle = params.get('angle') ?? 'front';
  const [view, setView] = createSignal(angle);
  const assetId = params.get('asset');
  const mode=params.get('scene') ?? 'asset';
  const presence=params.get('presence') ?? 'none';
  const rawHour = Number(params.get('hour') ?? 19);
  const hour = Number.isFinite(rawHour) ? rawHour : 19;

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomContent;
    delete window.__chatdomContentError;
    void (async () => {
      if (!['front', 'side', 'back'].includes(angle)) throw new Error('Choose front, side or back as the viewing angle.');
      const blueprints = await loadContentCollection(collection);
      const blueprint = assetId ? blueprints.find(b => b.id === assetId) : blueprints[0];
      if (!blueprint) throw new Error('The selected model does not exist in this collection.');
      if (!['none','on','off'].includes(presence) || (presence!=='none' && mode!=='windows')) throw new Error('Presence is on/off only in the windows scene.');
      const fixture=await loadBenchFixture(collection,blueprints,blueprint,mode);
      if (disposed) return;
      const pool = new VoxelWorkerPool({ size: 2 });
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#34333c');
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.debug.onShaderError=()=>{ throw new Error('Content shader compilation failed.'); };
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.domElement.setAttribute('aria-label', `Voxel model ${blueprint.id}, ${angle} view`);
      host.append(renderer.domElement);
      const material = createVoxelMaterial(MATERIALS, 'build');
      const grade = getEnvironment(hour);
      material.setEnvironment(grade);
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
      const geometries: THREE.BufferGeometry[]=[];
      const bounds = new THREE.Box3();
      for(const item of fixture.instances) {
        const local=assetBounds(item.blueprint);
        local.applyMatrix4(new THREE.Matrix4().makeRotationY(item.yaw).setPosition(new THREE.Vector3(...item.position).multiplyScalar(VOXEL_METRES.build)));
        bounds.union(local);
      }
      const focus=fixture.focus ? new THREE.Vector3(...fixture.focus).multiplyScalar(VOXEL_METRES.build) : undefined;
      const lights=presence==='none'?undefined:createWindowLights(scene,fixture.instances.map((item,slot)=>({...item,slot,position:item.position.map(v=>v*VOXEL_METRES.build) as [number,number,number]})),{allWindows:true});
      if(lights) {
        lights.setFrame(KingdomPresenceFrameSchema.parse({version:1,kingdomId:'1',epoch:'content-review',sequence:1,asOf:1000,origin:'simulated',streamLive:true,connection:'fresh',windows:fixture.instances.map((_,slot)=>({slot,present:presence==='on',publicName:null,since:0}))}));
        lights.update(1,hour);
      }
      const resize = () => {
        const width = host.clientWidth, height = host.clientHeight;
        renderer.setSize(width, height);
        if (!geometries.length) return;
        const centre=focus ?? bounds.getCenter(new THREE.Vector3());
        const radius=focus ? 5 : bounds.getSize(new THREE.Vector3()).length();
        const direction = focus ? new THREE.Vector3(...(fixture.normal ?? [0,0,1])).add(new THREE.Vector3(.16,.12,0)) : view() === 'side' ? new THREE.Vector3(1.8, .8, -.16) : view() === 'back' ? new THREE.Vector3(-1, .85, -1.5) : new THREE.Vector3(1, .85, 1.5);
        camera.position.copy(centre).add(direction.normalize().multiplyScalar(radius * 2));
        camera.lookAt(centre); camera.updateMatrixWorld(true);
        const projected = new THREE.Box3();
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) projected.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
        const aspect = width / height;
        const halfHeight = focus ? (mode==='windows'?1.4:2.2)*Math.max(1,1/aspect) : Math.max(projected.max.y - projected.min.y, (projected.max.x - projected.min.x) / aspect) * .59;
        camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;camera.top=halfHeight;camera.bottom=-halfHeight;
        camera.updateProjectionMatrix();
        renderer.render(scene,camera);
      };
      window.addEventListener('resize', resize);
      disposeScene = () => { delete window.__chatdomContentView;window.removeEventListener('resize',resize);pool.dispose();geometries.forEach(g=>g.dispose());lights?.dispose();material.dispose();renderer.dispose();renderer.domElement.remove(); };
      setStatus('Carving the model and finding its light…');
      let triangles=0;
      for(const item of fixture.instances) {
        const result=await pool.submit({kind:'blueprint',blueprint:item.blueprint,revision:1,materials:MATERIALS.materials,materialRevision:MATERIALS.revision});
        if(disposed)return;
        if(result?.kind!=='asset'||!result.chunks.length) throw new Error('The voxel worker did not return model geometry.');
        const geometry=geometryFromChunks(result.chunks,'build');geometries.push(geometry);
        const model=new THREE.Mesh(geometry,material.material);
        model.position.set(...item.position).multiplyScalar(VOXEL_METRES.build);model.rotation.y=item.yaw;scene.add(model);
        triangles+=result.chunks.reduce((n,chunk)=>n+chunk.mesh.indices.length/3,0);
      }
      resize();
      await renderer.compileAsync(scene,camera);
      if (disposed) return;
      renderer.render(scene,camera);
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      if (disposed) return;
      renderer.render(scene,camera);
      // Complete the GPU work before publishing readiness; screenshots must see actual shader pixels.
      renderer.getContext().finish();
      host.dataset.asset = blueprint.id;
      host.dataset.scene = mode;
      host.dataset.angle = angle;
      window.__chatdomContent = { collection, asset: fixture.id, angle, triangles, draws: renderer.info.render.calls, models: fixture.instances.length, assetIds: fixture.instances.map(item=>item.blueprint.id), scene: mode, presence };
      window.__chatdomContentView = next => {
        if (!['front','side','back'].includes(next)) throw new Error('Unknown content view.');
        window.__chatdomReady=false;setView(next);resize();renderer.getContext().finish();
        host.dataset.angle=next;
        window.__chatdomContent={collection,asset:fixture.id,angle:next,triangles,draws:renderer.info.render.calls,models:fixture.instances.length,assetIds:fixture.instances.map(item=>item.blueprint.id),scene:mode,presence};
        window.__chatdomReady=true;
      };
      setStatus('');
      window.__chatdomReady = true;
    })().catch(error => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      window.__chatdomContentError = message;
      setStatus(message);setFailed(true);
      console.error(message);
    });
  });
  onCleanup(() => { disposed=true;disposeScene?.();window.__chatdomReady=false; });
  return <section class="content-bench" data-content-collection={collection}>
    <div ref={element => { host=element; }} class="content-bench-stage" />
    <header><span>CHATDOM · CONTENT WORKSHOP</span><strong>{mode==='asset'?(assetId ?? collection):`${collection} · ${mode}`}</strong><small>{view()} · {hour}:00 · {presence==='none'?'unoccupied models':`SIMULATED window presence ${presence.toUpperCase()}`}</small></header>
    {status() && <div class="content-bench-status" role={failed() ? 'alert' : 'status'}><strong>{failed() ? 'The model could not be shown' : 'At the carving bench'}</strong><p>{status()}</p></div>}
  </section>;
}

export default ContentBench;
