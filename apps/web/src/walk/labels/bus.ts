import * as THREE from 'three';
import type { CitizenChatCue } from '@chatdom/shared';

/**
 * Per-canvas speech for the label layer.
 *
 * Why a bus and not a host callback: the host (`kingdom/scene.ts`) only offers speech through a throttled 80 ms
 * callback, while names arrive every frame after the final camera transform. A bubble placed from an older camera
 * than the name beside it steps and lags. The crowd instead projects its speech in `drawLanterns`, which runs every
 * frame right after `camera.updateMatrixWorld()` with the camera that draws, and publishes it here. The label layer
 * mounted beside that canvas joins it with the same frame's names and lays both out once, after the frame's
 * script has finished and before the browser paints.
 *
 * Several kingdom scenes can live on one page (the stream lens and its warming replacement, a raid road, a
 * chronicle), so every frame is keyed by its canvas and a layer accepts only the visible canvas it sits beside.
 */

/** One live line of speech, already projected into the canvas's CSS pixels. */
export interface SpeechAnchor {
  readonly slot: number;
  readonly cueId: string;
  /** Null when the home's own name plate already shows the name. */
  readonly name: string | null;
  readonly parts: CitizenChatCue['parts'];
  /**
   * `walker`: someone walking right now speaks. The layer anchors the bubble at the head of that walker's name
   * label, which the host projects every frame from the drawn head. `home`: a chat-only person speaks from their
   * lit home; `x`, `y` and `distance` are the projected point above their door.
   */
  readonly from: 'walker' | 'home';
  readonly x?: number;
  readonly y?: number;
  readonly distance?: number;
  /** 0 when a wall stands between the camera and the anchor, 1 when the line is clear. */
  readonly visibility?: number;
}

export interface SpeechFrame {
  /** `performance.now()` when the scene published; a layer ignores frames from a canvas that stopped drawing. */
  readonly at: number;
  readonly width: number;
  readonly height: number;
  readonly speech: readonly SpeechAnchor[];
}

type Listener = (canvas: HTMLCanvasElement, frame: SpeechFrame) => void;
const listeners = new Set<Listener>();
const latest = new WeakMap<HTMLCanvasElement, SpeechFrame>();

export function publishSpeech(canvas: HTMLCanvasElement, frame: SpeechFrame): void {
  latest.set(canvas, frame);
  for (const listener of [...listeners]) {
    try { listener(canvas, frame); } catch (error) { console.error('A speech listener failed', error); }
  }
}

export function subscribeSpeech(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function latestSpeech(canvas: HTMLCanvasElement): SpeechFrame | undefined { return latest.get(canvas); }

/** Frames older than this belong to a scene that has stopped drawing (disposed, hidden or replaced). */
export const SPEECH_FRAME_STALE_MS = 400;

/**
 * An always-drawn, empty object that learns which canvas its scene is drawn into. Three calls `onBeforeRender`
 * with the renderer before drawing an object, even one with no vertices, so the scene's canvas is known after its
 * first draw without the host passing it in. An empty geometry issues no draw call.
 */
export type CanvasProbe = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> & { canvas: HTMLCanvasElement | undefined };
export function createCanvasProbe(): CanvasProbe {
  const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  const probe: CanvasProbe = Object.assign(new THREE.Mesh(new THREE.BufferGeometry(), material), { canvas: undefined as HTMLCanvasElement | undefined });
  probe.name = 'speech-canvas-probe';
  probe.frustumCulled = false;
  probe.onBeforeRender = renderer => {
    const element = (renderer as { domElement?: unknown }).domElement;
    if (element && typeof element === 'object') probe.canvas = element as HTMLCanvasElement;
  };
  return probe;
}

export function disposeCanvasProbe(probe: CanvasProbe): void {
  probe.removeFromParent();
  probe.geometry.dispose();
  probe.material.dispose();
  probe.canvas = undefined;
}

const projected = new THREE.Vector3(), viewSpace = new THREE.Vector3();
/** Project a world point the same way the host projects names: CSS pixels of the canvas, top-left origin. */
export function projectToCanvas(point: THREE.Vector3, camera: THREE.Camera, width: number, height: number): { x: number; y: number; distance: number } | null {
  viewSpace.copy(point).applyMatrix4(camera.matrixWorldInverse);
  if (viewSpace.z >= 0) return null; // behind the eye
  projected.copy(point).project(camera);
  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < -1 || projected.z > 1) return null;
  const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
  const distance = point.distanceTo(viewSpace.setFromMatrixPosition(camera.matrixWorld));
  return { x, y, distance };
}
