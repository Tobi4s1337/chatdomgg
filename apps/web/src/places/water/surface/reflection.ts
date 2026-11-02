import * as THREE from 'three';
import { mirrorCamera } from './mirror';

/** The renderer surface the reflection pass touches; `THREE.WebGLRenderer` satisfies it. */
export interface ReflectionRenderer {
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  setRenderTarget(target: THREE.WebGLRenderTarget | null, activeCubeFace?: number, activeMipmapLevel?: number): void;
  getViewport(target: THREE.Vector4): THREE.Vector4;
  setViewport(viewport: THREE.Vector4): void;
  getScissor(target: THREE.Vector4): THREE.Vector4;
  setScissor(scissor: THREE.Vector4): void;
  getScissorTest(): boolean;
  setScissorTest(enabled: boolean): void;
  getClearColor(target: THREE.Color): THREE.Color;
  getClearAlpha(): number;
  setClearColor(colour: THREE.ColorRepresentation, alpha?: number): void;
  getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  getContext(): { checkFramebufferStatus(target: number): number; readonly FRAMEBUFFER: number; readonly FRAMEBUFFER_COMPLETE: number };
  readonly extensions: { has(name: string): boolean };
  clippingPlanes: THREE.Plane[];
  localClippingEnabled: boolean;
  autoClear: boolean;
  readonly shadowMap: { autoUpdate: boolean; needsUpdate: boolean };
  readonly xr: { enabled: boolean };
  readonly info: { readonly render: { readonly calls: number; readonly triangles: number } };
}

/**
 * W-M3, the host's reflection frame: called once per frame before the normal render, with the actual renderer,
 * scene and camera. `frame` is the host's frame counter; a second call with the same frame reuses the first pass.
 * `exclusions` are hidden for the pass and restored after it (the sky dome that follows the real camera, overlays).
 */
export interface ReflectionFrame {
  readonly renderer: ReflectionRenderer;
  readonly scene: THREE.Object3D;
  readonly camera: THREE.Camera;
  readonly frame: number;
  readonly exclusions?: readonly THREE.Object3D[];
}

export type ReflectionReason = 'reduced' | 'below' | 'shared' | 'recursive' | 'unavailable';
export interface ReflectionReport { readonly rendered: boolean; readonly valid: boolean; readonly reason: ReflectionReason | null }

export interface ReflectionDiagnostics {
  /** 'full' while the planar pass works; 'reduced' when asked for or after a failed target. */
  mode: 'full' | 'reduced';
  /** Why the full path is not in use, kept for display outside the scene. */
  failure: string | null;
  passes: number;
  recursions: number;
  frame: number | null;
  size: [number, number];
  format: 'rgba16f' | 'rgba8' | null;
  /** Colour plus depth attachment bytes of the reflection target. */
  targetBytes: number;
  /** Draw calls and triangles of the last reflection pass alone. */
  pass: { calls: number; triangles: number };
}

export interface PlanarReflectionOptions {
  /** Target size as a share of the drawing buffer, (0, 0.5]. */
  readonly scale?: number;
  /** Longest target edge in pixels. */
  readonly maxEdge?: number;
}

export const REFLECTION_SCALE = 0.5;
export const REFLECTION_MAX_EDGE = 1024;

/**
 * One mirrored-camera pass into a half-resolution target, for a single water plane per frame. Every piece of
 * renderer state the pass changes is restored in `finally`, objects it hides come back with their own visibility,
 * and a pass started from inside a pass is refused. A target the device cannot render to turns the path to
 * 'reduced' with a recorded failure instead of leaving black water.
 */
export function createPlanarReflection(options: PlanarReflectionOptions = {}) {
  const scale = options.scale ?? REFLECTION_SCALE, maxEdge = options.maxEdge ?? REFLECTION_MAX_EDGE;
  if (!(scale > 0 && scale <= 0.5)) throw new RangeError('Reflection scale must lie in (0, 0.5]');
  if (!(Number.isInteger(maxEdge) && maxEdge >= 16)) throw new RangeError('Reflection edge must be an integer of at least 16');
  const mirror = new THREE.PerspectiveCamera();
  mirror.matrixAutoUpdate = true;
  // Scene owners may select a lighter set for the reflection (the grand land draws its outer land coarser).
  mirror.userData.chatdomReflection = true;
  const textureMatrix = new THREE.Matrix4();
  let target: THREE.WebGLRenderTarget | null = null;
  let rendering = false, valid = false, level = 0;
  const diagnostics: ReflectionDiagnostics = {
    mode: 'full', failure: null, passes: 0, recursions: 0, frame: null, size: [0, 0], format: null, targetBytes: 0, pass: { calls: 0, triangles: 0 },
  };
  const saved = { viewport: new THREE.Vector4(), scissor: new THREE.Vector4(), clear: new THREE.Color(), buffer: new THREE.Vector2() };
  const hidden: THREE.Object3D[] = [];

  function ensureTarget(renderer: ReflectionRenderer): THREE.WebGLRenderTarget {
    const buffer = renderer.getDrawingBufferSize(saved.buffer);
    let w = Math.max(16, Math.round(buffer.x * scale)), h = Math.max(16, Math.round(buffer.y * scale));
    const over = Math.max(w, h) / maxEdge;
    if (over > 1) { w = Math.max(16, Math.round(w / over)); h = Math.max(16, Math.round(h / over)); }
    if (!target) {
      // Half float keeps warm panes brighter than white for the pillars; without a renderable half float we keep 8 bits.
      const half = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
      target = new THREE.WebGLRenderTarget(w, h, {
        type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
      });
      target.texture.name = 'water-reflection';
      diagnostics.format = half ? 'rgba16f' : 'rgba8';
    } else if (target.width !== w || target.height !== h) target.setSize(w, h);
    diagnostics.size = [w, h];
    diagnostics.targetBytes = w * h * ((diagnostics.format === 'rgba16f' ? 8 : 4) + 4);
    return target;
  }

  function fail(reason: string): void {
    diagnostics.mode = 'reduced'; diagnostics.failure = reason; valid = false;
    target?.dispose(); target = null; diagnostics.targetBytes = 0; diagnostics.size = [0, 0];
  }

  return {
    diagnostics: diagnostics as Readonly<ReflectionDiagnostics>,
    textureMatrix,
    /** The target's texture, or null when there is none (reduced path). */
    get texture(): THREE.Texture | null { return target?.texture ?? null; },
    /** True once this frame's pass rendered a usable image at `level`. */
    get valid(): boolean { return valid && diagnostics.mode === 'full'; },
    get level(): number { return level; },
    /** Chooses the path. Reduced frees the target (its bytes leave the budget); full tries again on the next frame. */
    setMode(mode: 'full' | 'reduced'): void {
      if (mode === 'full' && diagnostics.mode === 'reduced') diagnostics.failure = null;
      diagnostics.mode = mode;
      if (mode === 'reduced') { valid = false; target?.dispose(); target = null; diagnostics.targetBytes = 0; diagnostics.size = [0, 0]; }
    },
    render(frame: ReflectionFrame, planeLevel: number, own: readonly THREE.Object3D[]): ReflectionReport {
      if (rendering) { diagnostics.recursions++; return { rendered: false, valid: false, reason: 'recursive' }; }
      if (diagnostics.mode !== 'full') { valid = false; return { rendered: false, valid: false, reason: 'reduced' }; }
      // One pass per host frame, shared by every water plane: a second plane that frame takes the reduced path.
      if (diagnostics.frame === frame.frame) return { rendered: false, valid: valid && level === planeLevel, reason: 'shared' };
      diagnostics.frame = frame.frame; level = planeLevel;
      if (!mirrorCamera(frame.camera, planeLevel, mirror, textureMatrix)) { valid = false; return { rendered: false, valid: false, reason: 'below' }; }
      const { renderer, scene } = frame;
      const state = {
        target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
        scissorTest: renderer.getScissorTest(), alpha: renderer.getClearAlpha(), planes: renderer.clippingPlanes,
        local: renderer.localClippingEnabled, autoClear: renderer.autoClear, shadowAuto: renderer.shadowMap.autoUpdate,
        shadowNeeds: renderer.shadowMap.needsUpdate, xr: renderer.xr.enabled,
      };
      renderer.getViewport(saved.viewport); renderer.getScissor(saved.scissor); renderer.getClearColor(saved.clear);
      rendering = true; valid = false;
      try {
        for (const object of [...own, ...(frame.exclusions ?? [])]) if (object.visible) { object.visible = false; hidden.push(object); }
        const into = ensureTarget(renderer);
        renderer.setRenderTarget(into);
        const gl = renderer.getContext();
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`reflection target incomplete (0x${status.toString(16)})`);
        // The mirror view never re-renders shadow maps or nests XR; the oblique projection does the clipping.
        renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
        renderer.clippingPlanes = []; renderer.autoClear = false;
        // Transparent black: where nothing was drawn the water keeps its own sky.
        renderer.setClearColor(0x000000, 0); renderer.clear(true, true, false);
        const info = renderer.info as ReflectionRenderer['info'] & { autoReset?: boolean };
        const before = { calls: info.render.calls, triangles: info.render.triangles };
        renderer.render(scene, mirror);
        // three resets its counters at each render unless the host turned that off.
        const reset = info.autoReset !== false;
        diagnostics.pass = { calls: info.render.calls - (reset ? 0 : before.calls), triangles: info.render.triangles - (reset ? 0 : before.triangles) };
        diagnostics.passes++; valid = true;
        return { rendered: true, valid: true, reason: null };
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
        return { rendered: false, valid: false, reason: 'unavailable' };
      } finally {
        for (const object of hidden) object.visible = true;
        hidden.length = 0;
        renderer.setRenderTarget(state.target, state.face, state.mip);
        renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(state.scissorTest);
        renderer.setClearColor(saved.clear, state.alpha);
        renderer.clippingPlanes = state.planes; renderer.localClippingEnabled = state.local; renderer.autoClear = state.autoClear;
        renderer.shadowMap.autoUpdate = state.shadowAuto; renderer.shadowMap.needsUpdate = state.shadowNeeds; renderer.xr.enabled = state.xr;
        rendering = false;
      }
    },
    dispose(): void { target?.dispose(); target = null; diagnostics.targetBytes = 0; },
  };
}
export type PlanarReflection = ReturnType<typeof createPlanarReflection>;
