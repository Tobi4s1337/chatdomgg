import * as THREE from 'three';
import { createVoxelMaterial, geometryFromChunks } from '@chatdom/render';
import { MATERIALS } from '@chatdom/content/materials';
import { rasterizeBlueprint, VoxelWorkerPool } from '@chatdom/voxel';
import type { GatherFrame, Vec3 } from '@chatdom/shared';
import { createTavernKit, type TavernKit } from '../../../../packages/content/src/tavern';
import { tavernInteriorEnvironment, tavernLight, tavernLightSources } from './light';
import { createTurnBoards, tableGame } from '../games/boards';

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
  const light = tavernLight(tavernLightSources(kit.hearth));
  const layers = new Map<string, { mesh: THREE.Mesh; material: ReturnType<typeof createVoxelMaterial> }>();
  let near = 'front';
  let disposed = false, hour = -1;
  const ready = Promise.all(Object.entries(kit.pieces).map(async ([key, blueprint]) => {
    const asset = rasterizeBlueprint(blueprint);
    const result = await pool.submit({ kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (disposed) return;
    if (result?.kind !== 'asset') throw new Error('The tavern could not be prepared.');
    const material = createVoxelMaterial(MATERIALS, 'build');
    // Break the perfectly even voxel wood into quiet, long brush strokes. The strokes live in
    // world space, follow the existing plank direction, and disappear with distance derivatives.
    material.material.fragmentShader = material.material.fragmentShader.replace(
      'if(kind==4.) {float grain=sin(uv.y*22.+sin(uv.x*6.)*.4);edge=.93+.045*grain;float plank=fract(uv.x*4.);edge*=mix(.78,1.,smoothstep(.015,.05,min(plank,1.-plank)));}',
      `if(kind==4.) {
        float board=floor(uv.x*4.);
        float stroke=sin(uv.y*17.+sin(uv.x*8.+board)*.8)+.45*sin(uv.y*37.+board*2.3);
        float broad=sin(uv.y*2.4+board*1.7)*.035;
        edge=.91+.035*stroke+broad;
        float plank=fract(uv.x*4.);edge*=mix(.76,1.,smoothstep(.014,.05,min(plank,1.-plank)));
      }`);
    // The exterior shader's moon bounce is intended for an open street; the sheltered room
    // keeps a subtler violet edge so the baked lantern pools remain the dominant light.
    material.material.fragmentShader = material.material.fragmentShader.replace('indigo*.42+uSun*.18*softMoon', 'indigo*.17+uSun*.06*softMoon');
    material.setLight(light); material.setEnvironment(tavernInteriorEnvironment(19));
    const mesh = new THREE.Mesh(geometryFromChunks(result.chunks, 'build'), material.material);
    mesh.name = `tavern:${key}`; root.add(mesh); layers.set(key, { mesh, material });
  })).then(() => undefined);
  // Live miniatures use the same public coordinates as the seated board. Empty table: paddles, no invented ball.
  const ballMaterial = new THREE.MeshBasicMaterial({ color: '#ffe7b8' });
  const ballGeometry = new THREE.BoxGeometry(.0558, .0558, .0252);
  const pongTables = kit.tables.filter(table => tableGame(table.id) === 'pong');
  const turnBoards = createTurnBoards(root, kit.tables);
  const balls = new THREE.InstancedMesh(ballGeometry, ballMaterial, pongTables.length);
  const markGeometry = new THREE.BoxGeometry(1, 1, 1), markMaterial = new THREE.MeshBasicMaterial({ color: '#bd955e' });
  const marks = new THREE.InstancedMesh(markGeometry, markMaterial, pongTables.length * 11);
  root.add(balls, marks); const matrix = new THREE.Matrix4();
  let mark = 0;
  for (const table of pongTables) {
    const line = (x: number, z: number, w: number, d: number) => {
      matrix.makeScale(w, .005, d); matrix.setPosition(table.centre[0] + x, table.centre[1] + .019, table.centre[2] + z);
      marks.setMatrixAt(mark++, matrix);
    };
    line(-.62, 0, .012, .9); line(.62, 0, .012, .9); line(0, -.45, 1.25, .012); line(0, .45, 1.25, .012);
    for (let x = -3; x <= 3; x++) line(x * .17, 0, .07, .012);
  }
  marks.instanceMatrix.needsUpdate = true; marks.computeBoundingSphere();
  const projectGames = (frame: GatherFrame) => {
    turnBoards.frame(frame, performance.now());
    let ballCount = 0;
    pongTables.forEach(table => {
      const pong = frame.tables.find(t => t.table === table.id)?.pong;
      if (pong && pong.phase === 'rally') {
        matrix.makeTranslation(table.centre[0] + pong.ball.x * .62, table.centre[1] + .044, table.centre[2] - pong.ball.y * .28);
        balls.setMatrixAt(ballCount++, matrix);
      }
    });
    balls.count = ballCount; balls.instanceMatrix.needsUpdate = true;
    balls.computeBoundingSphere();
  };
  projectGames({ at: 0, tables: [] });
  return {
    kit, ready,
    update(_dt, feet, camera, wantedHour) {
      if (hour !== wantedHour) {
        hour = wantedHour;
        const interior = tavernInteriorEnvironment(hour);
        for (const layer of layers.values()) layer.material.setEnvironment(interior);
      }
      const inside = !!feet && feet[0] > .5 && feet[0] < 13.5 && feet[2] > .5 && feet[2] < 9.625;
      // A walking/seated camera already inside needs the enclosing walls and the exit doorway.
      // Cut a wall only for an exterior study/overlook looking into the occupied room.
      const outside = camera.position.x < .625 || camera.position.x > 13.375 || camera.position.z < .625 || camera.position.z > 9.375;
      const dx = camera.position.x - 7, dz = camera.position.z - 5;
      // Hysteresis prevents two walls flashing as a camera crosses the diagonal.
      const xDominant = near === 'left' || near === 'right';
      if (xDominant ? Math.abs(dz) > Math.abs(dx) + .5 : Math.abs(dx) > Math.abs(dz) + .5) {
        near = xDominant ? (dz > 0 ? 'front' : 'back') : (dx > 0 ? 'right' : 'left');
      } else if (xDominant) near = dx > 0 ? 'right' : 'left';
      else near = dz > 0 ? 'front' : 'back';
      for (const [key, layer] of layers) layer.mesh.visible = !(inside && outside && key === near);
    },
    games: projectGames,
    dispose() {
      disposed = true; pool.dispose(); turnBoards.dispose(); scene.remove(root);
      for (const layer of layers.values()) { layer.mesh.geometry.dispose(); layer.material.dispose(); }
      layers.clear(); balls.dispose(); marks.dispose(); ballMaterial.dispose(); markMaterial.dispose(); markGeometry.dispose(); ballGeometry.dispose();
    },
  };
}
