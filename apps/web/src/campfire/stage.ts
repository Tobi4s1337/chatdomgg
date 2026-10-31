import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content/materials';
import { createAtmosphere, createVoxelMaterial, getEnvironment, type Environment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { mountCampfireClearing, type CampfireClearing, type SeatScreenAnchor } from './clearing';
import type { CampfirePublicView } from './ports';

/*
 * A standalone stage for the clearing: renderer, sky, camera and the shared voxel materials. The
 * kingdom mounts `mountCampfireClearing` into its own scene instead; this stage exists for the
 * bench and the public stream entry, which have no kingdom scene to attach to.
 */

export type StageFraming = 'page' | 'stream';

export interface ScreenAnchor extends SeatScreenAnchor { readonly x: number; readonly y: number; readonly visible: boolean }

export interface CampfireStage {
  readonly ready: Promise<void>;
  readonly clearing: CampfireClearing;
  render(view: CampfirePublicView, atMs: number): Promise<void>;
  resize(width: number, height: number): void;
  /** Seat anchors in CSS pixels for nameplates over the canvas. */
  project(): readonly ScreenAnchor[];
  dispose(): void;
}

/** The hour the clearing is lit at: the live hours' night, deeper once the fire is banked. */
export function hourFor(view: CampfirePublicView): number {
  return view.lifecycle === 'closed' ? 23.2 : 21.8;
}

export function createCampfireStage(host: HTMLElement, options: { framing: StageFraming; label: string }): CampfireStage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.debug.onShaderError = () => { throw new Error('A campfire shader failed to compile.'); };
  renderer.domElement.className = 'campfire-canvas';
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', options.label);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, .1, 900);
  const atmosphere = createAtmosphere(scene);
  const pool = new VoxelWorkerPool({ size: 2 });
  const materials = { build: createVoxelMaterial(MATERIALS, 'build'), avatar: createVoxelMaterial(MATERIALS, 'avatar'), terrain: createVoxelMaterial(MATERIALS, 'terrain') };
  const clearing = mountCampfireClearing({ scene, pool, materials });
  let width = 1, height = 1, hour = -1, environment: Environment = getEnvironment(21.8), radius = -1;

  const frame = (): void => {
    const aspect = width / height;
    const ring = clearing.arrangement().radius + .75;
    const portrait = aspect < .8;
    camera.fov = portrait ? 56 : options.framing === 'stream' ? 34 : 36;
    // The frame's top edge sits a few degrees above the horizon so the Wilds and the kingdom show.
    const top = portrait ? 9 : 10;
    const elevation = portrait ? 25 : options.framing === 'stream' ? 13 : 15;
    const azimuth = .16;
    const halfWide = Math.atan(Math.tan(camera.fov * Math.PI / 360) * aspect);
    // Fit the whole ring across the frame, with a margin; portrait lets the far sides crop a little.
    const fill = portrait ? 1.02 : options.framing === 'stream' ? .78 : .74;
    const distance = Math.max(5.5, ring / Math.tan(halfWide * fill)) + ring * .5;
    const elevationRad = elevation * Math.PI / 180;
    camera.position.set(Math.sin(azimuth) * distance * Math.cos(elevationRad), .55 + distance * Math.sin(elevationRad), Math.cos(azimuth) * distance * Math.cos(elevationRad));
    const pitch = (top - camera.fov / 2) * Math.PI / 180;
    const ahead = new THREE.Vector3(-Math.sin(azimuth), 0, -Math.cos(azimuth));
    camera.lookAt(camera.position.clone().add(ahead.multiplyScalar(Math.cos(pitch))).add(new THREE.Vector3(0, Math.sin(pitch), 0)));
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  };

  return {
    ready: clearing.ready, clearing,
    async render(view, atMs) {
      const wanted = hourFor(view);
      if (wanted !== hour) {
        hour = wanted;
        environment = getEnvironment(hour);
        for (const m of Object.values(materials)) m.setEnvironment(environment);
        clearing.distance.setEnvironment(environment);
      }
      await clearing.update(view, atMs);
      if (clearing.arrangement().radius !== radius) { radius = clearing.arrangement().radius; frame(); }
      atmosphere.update(hour, atMs / 1000, camera, clearing.beacon, view.lifecycle === 'closed' ? .45 : .8);
      renderer.render(scene, camera);
    },
    resize(w, h) {
      width = Math.max(1, w); height = Math.max(1, h);
      renderer.setSize(width, height, false);
      frame();
    },
    project() {
      return clearing.anchors().map(anchor => {
        const p = anchor.head.clone().project(camera);
        return { ...anchor, x: (p.x + 1) / 2 * width, y: (1 - p.y) / 2 * height, visible: p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05 };
      });
    },
    dispose() {
      clearing.dispose(); atmosphere.dispose(); pool.dispose();
      for (const m of Object.values(materials)) m.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
