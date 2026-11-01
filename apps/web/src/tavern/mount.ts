import * as THREE from 'three';
import { createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { MATERIALS } from '@chatdom/content/materials';
import { rasterizeBlueprint, VoxelWorkerPool } from '@chatdom/voxel';
import type { GatherFrame, Vec3 } from '@chatdom/shared';
import { createTavernKit, type TavernKit } from '../../../../packages/content/src/tavern';
import { tavernLight } from './light';

export interface TavernMount {
  readonly kit: TavernKit;
  readonly ready: Promise<void>;
  /** Place local coordinates. Exterior feet leave the shell solid. */
  update(dt: number, feet: Vec3 | null, camera: THREE.Camera, hour: number): void;
  games(frame: GatherFrame): void;
  dispose(): void;
}
/** The portal destination and the development stage mount the same independent interior. */
export function mountTavern(scene: THREE.Scene, options: { style?: 'hearth' | 'tide'; phone?: boolean } = {}): TavernMount {
  const kit = createTavernKit(options.style ?? 'hearth'), pool = new VoxelWorkerPool({ size: 1 });
  const root = new THREE.Group(); root.name = 'gather:tavern'; scene.add(root);
  const sources: Vec3[] = [kit.hearth, ...(!options.phone ? [[3, 3.25, 4.5], [7.625, 3.25, 4.5], [10.5, 3.25, 7.375]] as Vec3[] : [])];
  const light = tavernLight(sources);
  const layers = new Map<string, { mesh: THREE.Mesh; fade: { value: number }; material: ReturnType<typeof createVoxelMaterial> }>();
  let disposed = false, hour = -1;
  const ready = Promise.all(Object.entries(kit.pieces).map(async ([key, blueprint]) => {
    const asset = rasterizeBlueprint(blueprint);
    const result = await pool.submit({ kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (disposed) return;
    if (result?.kind !== 'asset') throw new Error('The tavern could not be prepared.');
    const material = createVoxelMaterial(MATERIALS, 'build'), fade = { value: 1 };
    material.material.uniforms.uPlaceOpacity = fade;
    material.material.fragmentShader = material.material.fragmentShader.replace('void main(){',
      'uniform float uPlaceOpacity;\nvoid main(){\nif (float(BAYER[int(mod(gl_FragCoord.x,4.))+4*int(mod(gl_FragCoord.y,4.))])/16. >= uPlaceOpacity) discard;');
    material.setLight(light); material.setEnvironment(getEnvironment(19));
    const mesh = new THREE.Mesh(geometryFromChunks(result.chunks, 'build'), material.material);
    mesh.name = `tavern:${key}`; root.add(mesh); layers.set(key, { mesh, fade, material });
  })).then(() => undefined);
  // Live miniatures use the same public coordinates as the seated board. Empty table: paddles, no invented ball.
  const table = kit.tables.find(t => t.id === 'west')!;
  const miniature = new THREE.Group(); miniature.position.set(...table.centre); miniature.position.y += .025; root.add(miniature);
  const wood = new THREE.MeshStandardMaterial({ color: '#e6bd7c', roughness: .92 });
  const ballMaterial = new THREE.MeshBasicMaterial({ color: '#ffe7b8' });
  const paddleGeometry = new THREE.BoxGeometry(.28, .06, .07), ballGeometry = new THREE.BoxGeometry(.065, .065, .065);
  const paddles = [0, 1].map(seat => {
    const mesh = new THREE.Mesh(paddleGeometry, wood); mesh.position.set(0, .06, seat === 0 ? .38 : -.38); miniature.add(mesh); return mesh;
  });
  const ball = new THREE.Mesh(ballGeometry, ballMaterial); ball.visible = false; miniature.add(ball);
  return {
    kit, ready,
    update(dt, feet, camera, wantedHour) {
      if (hour !== wantedHour) {
        hour = wantedHour;
        const sky = getEnvironment(hour);
        // This is a sheltered interior world: lanterns carry the key, with soft violet reflected fill.
        const interior = { ...sky, sunIntensity: .12, ambientIntensity: .72, ambient: '#b3a0bd', shadow: '#45364f', night: Math.max(.85, sky.night) };
        for (const layer of layers.values()) layer.material.setEnvironment(interior);
      }
      const inside = !!feet && feet[0] > .5 && feet[0] < 13.5 && feet[2] > .5 && feet[2] < 9.625;
      const dx = camera.position.x - 7, dz = camera.position.z - 5;
      const near = Math.abs(dx) > Math.abs(dz) ? dx > 0 ? 'right' : 'left' : dz > 0 ? 'front' : 'back';
      for (const [key, layer] of layers) {
        const hidden = inside && key === near;
        layer.fade.value = THREE.MathUtils.damp(layer.fade.value, hidden ? 0 : 1, 9, Math.min(.1, dt));
        layer.mesh.visible = layer.fade.value > .005;
      }
    },
    games(frame) {
      const pong = frame.tables.find(t => t.table === 'west')?.pong;
      ball.visible = !!pong && pong.phase !== 'interrupted';
      if (!pong) return;
      paddles.forEach((paddle, i) => { paddle.position.x = pong.paddles[i]! * .62; });
      ball.position.set(pong.ball.x * .62, .07, pong.ball.y * .28);
    },
    dispose() {
      disposed = true; pool.dispose(); scene.remove(root);
      for (const layer of layers.values()) { layer.mesh.geometry.dispose(); layer.material.dispose(); }
      layers.clear(); wood.dispose(); ballMaterial.dispose(); paddleGeometry.dispose(); ballGeometry.dispose();
    },
  };
}
