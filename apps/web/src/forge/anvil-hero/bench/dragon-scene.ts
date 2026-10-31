import * as THREE from 'three';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { rasterizeBlueprint } from '@chatdom/voxel';
import { DRAGON_EMITTER, DRAGON_SIZE } from '@chatdom/content/anvil-hero';
import { checkMountedDragon, mountSleepingDragon } from './roof';
import type { BenchStyle, BenchView } from './params';

const CELL = .125;
/** From the exported nose anchor to the middle of the dragon's envelope, whatever the sculpt's nose. */
const EMITTER_TO_CENTRE = new THREE.Vector3(...DRAGON_SIZE).multiplyScalar(.5).sub(new THREE.Vector3(...DRAGON_EMITTER)).multiplyScalar(CELL);

export interface RoofDragon {
  piece: { blueprint: VoxelBlueprint; position: Vec3 };
  /** World point of the landed smoke, computed exactly as the kingdom's Forge does. */
  emitter: THREE.Vector3;
  /** World middle of the dragon's envelope, for framing. */
  centre: THREE.Vector3;
  /**
   * Which side of the host's ridge the socket chose. Behind the ridge the dragon cannot be seen from
   * the street the house faces, so the bench looks from the lane behind instead of hiding that.
   */
  side: 'street' | 'lane';
}

/** The z of the host's highest roof cell over the dragon's own columns, in host cells. */
function ridgeZ(home: VoxelBlueprint, fromX: number, toX: number): number {
  const asset = rasterizeBlueprint(home), [sx, sy, sz] = asset.size;
  let best = -1, z0 = 0;
  for (let z = 0; z < sz; z++) for (let x = Math.max(0, fromX); x < Math.min(sx, toX); x++) for (let y = sy - 1; y > best; y--) if (asset.voxels[x + sx * (y + sy * z)]) { best = y; z0 = z; break; }
  return z0;
}

/** The forged chimney on a real authored home: the assembler's socket, supports and offset. */
export function placeRoofDragon(style: BenchStyle, host: { blueprint: VoxelBlueprint; position: Vec3; yaw: number }): RoofDragon {
  if (host.yaw !== 0) throw new Error('The dragon bench frames a home facing the square.');
  const mounted = mountSleepingDragon(host.blueprint, style);
  checkMountedDragon(mounted, host.blueprint);
  const origin = new THREE.Vector3(...mounted.socket.origin).multiplyScalar(CELL).add(new THREE.Vector3(...host.position));
  const emitter = new THREE.Vector3(...mounted.emitter).multiplyScalar(CELL).add(new THREE.Vector3(...host.position));
  // The envelope's first cell in the host's frame, from the nose anchor: its columns and its middle decide the side.
  const first = mounted.emitter.map((n, i) => n - DRAGON_EMITTER[i]!);
  const side = first[2]! + DRAGON_SIZE[2] / 2 < ridgeZ(host.blueprint, first[0]!, first[0]! + DRAGON_SIZE[0]) ? 'lane' : 'street';
  return { piece: { blueprint: mounted.blueprint, position: origin.toArray() as Vec3 }, emitter, centre: emitter.clone().add(EMITTER_TO_CENTRE), side };
}

/**
 * The kingdom draws forged pieces with this warm lift over the build material (forge/scene.ts).
 * The bench copies it so the dragon is judged in the light it will live in, and fails if it drifts.
 */
export function createForgedPieceMaterial(clay: THREE.ShaderMaterial): THREE.ShaderMaterial {
  const from = 'vec3 colour=base*edge*light*ao;';
  if (clay.fragmentShader.split(from).length !== 2) throw new Error('The build material changed; the forged-piece light needs main.');
  return new THREE.ShaderMaterial({ glslVersion: clay.glslVersion, uniforms: clay.uniforms, vertexShader: clay.vertexShader,
    fragmentShader: clay.fragmentShader.replace(from, 'vec3 colour=base*edge*(light+vec3(.32,.25,.17))*ao;if(vMaterial==14u)colour+=vec3(1.6,.65,.12)*uNight;') });
}

/** Fixed views of the roof dragon. Square: a standing eye across the street, at least 12 m away. */
export function aimDragon(camera: THREE.PerspectiveCamera, view: BenchView, dragon: RoofDragon, portrait: boolean): number {
  // Behind the ridge, the same framings mirror to the lane: the far flank and its folded wing.
  const c = dragon.centre, s = dragon.side === 'street' ? 1 : -1;
  if (view === 'dragon-close') {
    // From the next roof along, a little above the ridge: the whole flank, head to tail.
    camera.position.set(c.x - 1.6 * s, c.y + .9, c.z + 5.4 * s);
    camera.lookAt(c.x - .1 * s, c.y - (portrait ? .45 : .3), c.z);
  } else {
    // A citizen standing in the street, looking up at the roofline more than 12 m away.
    // The lane's standpoint stays on the meadow and clear of the trees behind the row.
    if (s > 0) camera.position.set(c.x - 7, 1.7, c.z + 23);
    else camera.position.set(c.x + 10, 1.7, c.z - 12);
    camera.lookAt(c.x - 1.4 * s, portrait ? c.y - 4.2 : c.y - 3.4, c.z);
  }
  return Math.hypot(camera.position.x - c.x, camera.position.z - c.z);
}
