import * as THREE from 'three';
import { createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { MATERIALS } from '@chatdom/content/materials';
import { rasterizeBlueprint, VoxelWorkerPool } from '@chatdom/voxel';
import type { GatherFrame, Vec3 } from '@chatdom/shared';
import { createTavernKit, type TavernKit } from '../../../../packages/content/src/tavern';
import { tavernLight } from './light';
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
  const wood = new THREE.MeshStandardMaterial({ color: '#e6bd7c', roughness: .92 });
  const ballMaterial = new THREE.MeshBasicMaterial({ color: '#ffe7b8' });
  const paddleGeometry = new THREE.BoxGeometry(.2604, .06, .07), ballGeometry = new THREE.BoxGeometry(.0558, .0558, .0252);
  const pongTables = kit.tables.filter(table => tableGame(table.id) === 'pong');
  const turnBoards = createTurnBoards(root, kit.tables);
  const paddles = new THREE.InstancedMesh(paddleGeometry, wood, pongTables.length * 2);
  const balls = new THREE.InstancedMesh(ballGeometry, ballMaterial, pongTables.length);
  const markGeometry = new THREE.BoxGeometry(1, 1, 1), markMaterial = new THREE.MeshBasicMaterial({ color: '#bd955e' });
  const marks = new THREE.InstancedMesh(markGeometry, markMaterial, pongTables.length * 11);
  const boardGeometry = new THREE.BoxGeometry(1.25, .016, .9), boardMaterial = new THREE.MeshStandardMaterial({ color: '#29473f', roughness: 1 });
  const boards = new THREE.InstancedMesh(boardGeometry, boardMaterial, pongTables.length);
  root.add(paddles, balls, marks, boards); const matrix = new THREE.Matrix4();
  let mark = 0;
  for (const [index, table] of pongTables.entries()) {
    matrix.makeTranslation(table.centre[0], table.centre[1] + .008, table.centre[2]); boards.setMatrixAt(index, matrix);
    const line = (x: number, z: number, w: number, d: number) => {
      matrix.makeScale(w, .005, d); matrix.setPosition(table.centre[0] + x, table.centre[1] + .019, table.centre[2] + z);
      marks.setMatrixAt(mark++, matrix);
    };
    line(-.62, 0, .012, .9); line(.62, 0, .012, .9); line(0, -.45, 1.25, .012); line(0, .45, 1.25, .012);
    for (let x = -3; x <= 3; x++) line(x * .17, 0, .07, .012);
  }
  boards.instanceMatrix.needsUpdate = true; boards.computeBoundingSphere();
  marks.instanceMatrix.needsUpdate = true; marks.computeBoundingSphere();
  const projectGames = (frame: GatherFrame) => {
    turnBoards.frame(frame, performance.now());
    let ballCount = 0;
    pongTables.forEach((table, index) => {
      const pong = frame.tables.find(t => t.table === table.id)?.pong;
      for (const seat of [0, 1] as const) {
        // Seat 1 is on the -Z side of the authored table; logical +Y is that player's end.
        matrix.makeTranslation(table.centre[0] + (pong?.paddles[seat] ?? 0) * .62,
          table.centre[1] + .046, table.centre[2] + (seat === 0 ? -.413 : .413));
        paddles.setMatrixAt(index * 2 + seat, matrix);
      }
      if (pong && pong.phase === 'rally') {
        matrix.makeTranslation(table.centre[0] + pong.ball.x * .62, table.centre[1] + .044, table.centre[2] - pong.ball.y * .28);
        balls.setMatrixAt(ballCount++, matrix);
      }
    });
    balls.count = ballCount; balls.instanceMatrix.needsUpdate = true; paddles.instanceMatrix.needsUpdate = true;
    paddles.computeBoundingSphere(); balls.computeBoundingSphere();
  };
  projectGames({ at: 0, tables: [] });
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
    games: projectGames,
    dispose() {
      disposed = true; pool.dispose(); turnBoards.dispose(); scene.remove(root);
      for (const layer of layers.values()) { layer.mesh.geometry.dispose(); layer.material.dispose(); }
      layers.clear(); paddles.dispose(); balls.dispose(); marks.dispose(); boards.dispose(); boardGeometry.dispose(); boardMaterial.dispose(); wood.dispose(); ballMaterial.dispose(); markMaterial.dispose(); markGeometry.dispose(); paddleGeometry.dispose(); ballGeometry.dispose();
    },
  };
}
