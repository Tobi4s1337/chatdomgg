import * as THREE from 'three';
import { MAT, MATERIALS } from '@chatdom/content';
import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';

/** Find a supported, walkable opening between the front wall's solid jambs. */
function entrance(blueprint: VoxelBlueprint) {
  const [width, height, depth] = blueprint.size;
  const scanHeight = Math.min(height, 20), startZ = Math.floor(depth / 2);
  const voxels = new Uint8Array(width * scanHeight * (depth - startZ));
  const index = (x: number, y: number, z: number) => x + width * (y + scanHeight * (z - startZ));
  for (const box of blueprint.boxes) {
    for (let z = Math.max(startZ, box.from[2]); z < Math.min(depth, box.to[2]); z++)
      for (let y = Math.max(0, box.from[1]); y < Math.min(scanHeight, box.to[1]); y++)
        for (let x = Math.max(0, box.from[0]); x < Math.min(width, box.to[0]); x++)
          voxels[index(x, y, z)] = box.material ? 1 : 0;
  }
  const solid = (x: number, y: number, z: number) => !!voxels[index(x, y, z)];
  const unit = VOXEL_METRES.build;
  if (scanHeight < 16) return null;
  for (let z = depth - 1; z >= startZ; z--) {
    const open = (x: number) => {
      if (!solid(x, 2, z) && !solid(x, 1, z)) return false;
      for (let y = 4; y < 16; y++) if (solid(x, y, z)) return false;
      return true;
    };
    for (let x = 1; x < width - 1;) {
      if (!open(x)) { x++; continue; }
      const left = x;
      while (x < width - 1 && open(x)) x++;
      if (x - left >= 6 && x - left <= 24 && solid(left - 1, 8, z) && solid(x, 8, z))
        return { left: left * unit, right: x * unit, front: (z + 1) * unit, bottom: 3 * unit };
    }
  }
  return null;
}

/**
 * A little doorstep belongs to the local plot. Position and yaw are the same reserve-space
 * transform as the house; updating the blueprint replaces the dressing and releases its GPU data.
 * The lamp is a physical fixture, deliberately distinct from the citizen's presence window.
 */
export function createPlotDressing(scene: THREE.Scene, position: Vec3, yaw: number) {
  const group = new THREE.Group();
  group.name = 'local-plot-dressing';
  group.position.set(...position); group.rotation.y = yaw;
  scene.add(group);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const instances: THREE.InstancedMesh[] = [];
  function clear() {
    group.clear();
    for (const mesh of instances.splice(0)) mesh.dispose();
    for (const geometry of geometries.splice(0)) geometry.dispose();
    for (const material of materials.splice(0)) material.dispose();
  }
  function update(blueprint: VoxelBlueprint) {
    clear();
    const door = entrance(blueprint);
    if (!door) return;
    const width = blueprint.size[0] * VOXEL_METRES.build;
    const depth = blueprint.size[2] * VOXEL_METRES.build;
    type Block = { x: number; y: number; z: number; w: number; h: number; d: number; material: number };
    const blocks: Block[] = [];
    const add = (material: number, x: number, y: number, z: number, w: number, h: number, d: number) =>
      blocks.push({ material, x, y, z, w, h, d });
    // A few irregularly laid stones, confined to the land between the facade and plot edge.
    const available = Math.max(0, depth - door.front);
    if (available > .12) {
      const count = Math.max(2, Math.ceil((door.right - door.left + .35) / .38));
      const w = (door.right - door.left + .28) / count;
      const rows = Math.max(1, Math.ceil(available / .34)), rowDepth = available / rows;
      for (let row = 0; row < rows; row++) for (let i = 0; i < count; i++)
        add((i + row) % 3 === 0 ? MAT.stone : MAT.paving, door.left - .14 + w * (i + .5), .035,
          door.front + rowDepth * (row + .5), w - .018, .07, rowDepth - .025);
    }
    // A bracket and caged lamp, offset from the opening so the path remains clear.
    const lampX = Math.min(width - .28, door.right + .26);
    const lampY = Math.max(1.65, door.bottom + 1.65);
    const face = door.front + .04;
    add(MAT.timber, lampX, lampY + .27, face + .04, .10, .10, .22);
    add(MAT.brass, lampX, lampY + .18, face + .14, .30, .08, .25);
    add(MAT.brass, lampX, lampY - .22, face + .14, .32, .09, .27);
    add(MAT.fabricGold, lampX, lampY - .02, face + .14, .22, .35, .18);
    for (const dx of [-.13, .13]) add(MAT.brass, lampX + dx, lampY - .02, face + .14, .045, .37, .22);
    // Tiny tufts frame the threshold without making a hedge or covering the grass.
    if (available > .25) for (const [x, z, petal] of [
      [Math.max(.18, door.left - .54), door.front + available * .35, MAT.petal],
      [Math.min(width - .18, door.right + .65), door.front + available * .65, MAT.blueFlower],
    ] as const) {
      add(MAT.leaf, x, .10, z, .12, .20, .12);
      add(MAT.moss, x + .10, .065, z + .07, .12, .13, .12);
      add(petal, x, .23, z, .10, .08, .10);
    }
    // Use the empty side strips for small beds, leaving every authored column alone.
    // Treat even overhanging source boxes as occupied: this is deliberately conservative
    // for both compiled solid runs and blueprints containing subsequent air cuts.
    const occupied = blueprint.boxes.filter(box => box.material !== 0);
    const clearColumn = (x: number, z: number, w: number, d: number) =>
      x - w / 2 >= 0 && x + w / 2 <= width && z - d / 2 >= 0 && z + d / 2 <= depth &&
      occupied.every(box => x + w / 2 <= box.from[0] * VOXEL_METRES.build ||
        x - w / 2 >= box.to[0] * VOXEL_METRES.build ||
        z + d / 2 <= box.from[2] * VOXEL_METRES.build || z - d / 2 >= box.to[2] * VOXEL_METRES.build);
    const garden = (material: number, x: number, y: number, z: number, w: number, h: number, d: number) => {
      if (clearColumn(x, z, w, d)) add(material, x, y, z, w, h, d);
    };
    for (const x of [.5, width - .5]) {
      const z = door.front - 1.12;
      // Two separate patches and short edging give the garden a lived-in outline.
      for (const offset of [-.34, .18])
        garden(MAT.earth, x, .024, z + offset, .65, .048, .46);
      for (const offset of [-.57, -.09, .41])
        garden(MAT.stone, x, .055, z + offset, .74, .11, .12);
      for (const [dx, dz, flower] of [[-.15, -.34, MAT.petal], [.13, .15, MAT.blueFlower]] as const) {
        garden(MAT.leaf, x + dx, .11, z + dz, .20, .22, .20);
        garden(MAT.moss, x + dx + .11, .07, z + dz + .09, .16, .14, .16);
        garden(flower, x + dx, .245, z + dz, .09, .07, .09);
      }
    }
    const geometry = new THREE.BoxGeometry(1, 1, 1); geometries.push(geometry);
    const matrix = new THREE.Matrix4();
    for (const id of new Set(blocks.map(block => block.material))) {
      const entry = MATERIALS.materials.find(material => material.id === id)!;
      const colour = new THREE.Color(entry.colour).multiplyScalar(id === MAT.fabricGold ? 1 : .64);
      const material = new THREE.MeshBasicMaterial({ color: colour });
      materials.push(material);
      const selected = blocks.filter(block => block.material === id);
      const mesh = new THREE.InstancedMesh(geometry, material, selected.length);
      instances.push(mesh);
      selected.forEach((block, i) => {
        matrix.compose(new THREE.Vector3(block.x, block.y, block.z), new THREE.Quaternion(), new THREE.Vector3(block.w, block.h, block.d));
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true; group.add(mesh);
    }
    // A very small, softly feathered halo stays physically tied to the lantern cage.
    const haloGeometry = new THREE.PlaneGeometry(.85, .85); geometries.push(haloGeometry);
    const haloMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { colour: { value: new THREE.Color(MATERIALS.materials.find(material => material.id === MAT.fabricGold)!.colour) } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 colour; varying vec2 vUv; void main(){vec2 p=(vUv-.5)*2.; float a=exp(-dot(p,p)*5.)*.20; gl_FragColor=vec4(colour,a);}' });
    materials.push(haloMaterial);
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.position.set(lampX, lampY, face + .27); halo.renderOrder = 1; group.add(halo);
  }
  return { group, update, dispose() { clear(); scene.remove(group); } };
}
