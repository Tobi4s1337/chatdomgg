import * as THREE from 'three';

/**
 * Draws each distinct program once, before the kingdom opens, in the state its first real frame draws it in.
 *
 * Linking a program early is not enough. On the 5080 the first real frame still waited about 85 ms on each of nine
 * programs, including programs linked 2.5 s earlier: the driver finishes a program for the state it is drawn in (the
 * vertex formats it reads, the target it writes), and only at its first draw. So while the land and the homes still
 * arrive, this draws one object per distinct program with its own geometry, buffers and material into the frame's
 * own target, through a one-pixel viewport and on a camera layer nothing else is on, so nothing visible is drawn.
 *
 * One program at a time, and the next only once a GPU fence says the last has finished, so the page's main thread
 * never waits on the driver: the work happens while it waits on the network and its workers anyway.
 */

/** The renderer surface the warmer uses (WebGLRenderer; a fake in tests). */
export interface WarmRenderer {
  autoClear: boolean;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  compileAsync(object: THREE.Object3D, camera: THREE.Camera, scene?: THREE.Scene | null): Promise<THREE.Object3D>;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  setRenderTarget(target: THREE.WebGLRenderTarget | null, activeCubeFace?: number, activeMipmapLevel?: number): void;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  getViewport(target: THREE.Vector4): THREE.Vector4;
  setViewport(x: number, y: number, width: number, height: number): void;
  getContext(): WebGLRenderingContext | WebGL2RenderingContext;
}

export interface ProgramWarmerOptions {
  readonly renderer: WarmRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  /** The target the frame's main pass draws into (the composer's HDR target), or null when it draws to the canvas. */
  readonly target: () => THREE.WebGLRenderTarget | null;
  /** False once the scene has opened (its first frame takes over) or closed. */
  readonly live: () => boolean;
  /** The camera layer reserved for the warm draw; nothing else in the scene may use it. */
  readonly layer?: number;
  /** How long a program may stay unlinked or a fence unsignalled before the warmer moves on. */
  readonly patienceMs?: number;
}

export interface ProgramWarmerStats {
  /** Distinct programs drawn so far. */
  warmed: number;
  /** Distinct programs found and still waiting their turn. */
  queued: number;
  /** Extra one-off warm tasks run (the post stack's passes). */
  tasks: number;
  /** Warm draws that failed and were dropped (the frame draws them as before). */
  failed: number;
  /** Times a link or a fence outlasted the patience and the warmer went on without it. */
  impatient: number;
  /** Main-thread milliseconds spent issuing warm draws. */
  issueMs: number;
}

export interface ProgramWarmer {
  /** Look for programs not drawn yet (cheap; scans at most once per task). */
  request(): void;
  /** Run `draw` once in turn with the program draws (its GPU work is fenced like theirs). */
  task(draw: () => void): void;
  stats(): Readonly<ProgramWarmerStats>;
  dispose(): void;
}

type Drawable = THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;

const DRAW_COUNT = { mesh: 3, line: 2, points: 1 } as const;
const SCAN_INTERVAL_MS = 100;

function drawable(object: THREE.Object3D): object is Drawable {
  const o = object as Partial<THREE.Mesh & THREE.Points & THREE.Line & THREE.Sprite & THREE.BatchedMesh>;
  return !o.isBatchedMesh && !!(o.isMesh || o.isPoints || o.isLine || o.isSprite);
}

function arrayKind(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): string {
  if ((attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const a = attribute as THREE.InterleavedBufferAttribute;
    return `${a.data.array.constructor.name}/${a.data.stride}+${a.offset}`;
  }
  const a = attribute as THREE.BufferAttribute;
  return `${a.array.constructor.name}${a.gpuType === THREE.IntType ? ':int' : ''}`;
}

/**
 * Everything that picks a program and the driver's variant of it: the material (and its version), the kind of
 * object (instancing, skinning, points, lines), the morph targets, the index type and each attribute's layout.
 * Null for what the warmer leaves to the first frame: multi-material objects and geometry with nothing to draw.
 */
export function programSignature(object: THREE.Object3D): string | null {
  if (!drawable(object)) return null;
  const material = object.material as THREE.Material | THREE.Material[] | undefined;
  if (!material || Array.isArray(material)) return null;
  const geometry = object.geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return null;
  // Packed voxel geometry has no position attribute; its index says what it draws.
  const vertices = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
  if (vertices === 0 || Object.keys(geometry.attributes).length === 0) return null;
  const o = object as Partial<THREE.InstancedMesh & THREE.SkinnedMesh & THREE.Points & THREE.LineSegments & THREE.Sprite>;
  if (o.isInstancedMesh && (o.instanceMatrix?.count ?? 0) === 0) return null;
  const kind = o.isInstancedMesh ? `instanced${o.instanceColor ? '+colour' : ''}${o.morphTexture ? '+morph' : ''}`
    : o.isSkinnedMesh ? 'skinned' : o.isPoints ? 'points' : o.isLineSegments ? 'segments' : o.isLine ? 'line' : o.isSprite ? 'sprite' : 'mesh';
  const attributes = Object.keys(geometry.attributes).sort().map(name => {
    const a = geometry.attributes[name]!;
    return `${name}:${a.itemSize}:${arrayKind(a)}${a.normalized ? ':n' : ''}${(a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute ? ':i' : ''}`;
  }).join(',');
  const morphs = geometry.morphAttributes as Record<string, readonly unknown[] | undefined>;
  const morph = Object.keys(morphs).sort().map(name => `${name}*${morphs[name]?.length ?? 0}`).join(',');
  return `${material.uuid}@${material.version}|${kind}|${geometry.index ? arrayKind(geometry.index) : '-'}|${attributes}|${morph}`;
}

function attached(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (o === root) return true;
  return false;
}

export function createProgramWarmer(options: ProgramWarmerOptions): ProgramWarmer {
  const { renderer, scene, camera } = options;
  const layer = options.layer ?? 31, patience = options.patienceMs ?? 1500;
  const seen = new Set<string>();
  const queue: ({ kind: 'program'; key: string; object: Drawable } | { kind: 'task'; draw: () => void })[] = [];
  const stats: ProgramWarmerStats = { warmed: 0, queued: 0, tasks: 0, failed: 0, impatient: 0, issueMs: 0 };
  const gl = renderer.getContext() as Partial<WebGL2RenderingContext>;
  const fences = typeof gl.fenceSync === 'function' && typeof gl.getSyncParameter === 'function' && typeof gl.deleteSync === 'function';
  const viewport = new THREE.Vector4(), saved = new THREE.Vector4();
  let disposed = false, scanQueued = false, running = false, scannedAt = -Infinity;

  const alive = () => !disposed && options.live();

  function scan() {
    scanQueued = false; scannedAt = performance.now();
    if (!alive()) return;
    scene.traverse(object => {
      const key = programSignature(object);
      if (key === null || seen.has(key)) return;
      seen.add(key); queue.push({ kind: 'program', key, object: object as Drawable });
    });
    stats.queued = queue.length;
    void run();
  }

  const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  /** Wait until the GPU has finished what was issued so far (or the patience runs out). */
  async function settle() {
    if (!fences) { await pause(48); return; }
    const context = gl as WebGL2RenderingContext;
    const sync = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) { await pause(48); return; }
    context.flush();
    const started = performance.now();
    try {
      // getSyncParameter never blocks; its answer refreshes between tasks.
      while (!disposed && context.getSyncParameter(sync, context.SYNC_STATUS) !== context.SIGNALED) {
        if (performance.now() - started > patience) { stats.impatient++; return; }
        await pause(4);
      }
    } finally { context.deleteSync(sync); }
  }

  /** The program must have linked before its first draw, or the draw would wait for the link on the main thread. */
  async function linked(object: Drawable) {
    const target = options.target(), previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    let compiling: Promise<unknown>;
    try { renderer.setRenderTarget(target); compiling = renderer.compileAsync(object, camera, scene); }
    finally { renderer.setRenderTarget(previous, face, mip); }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'late'>(resolve => { timer = setTimeout(() => resolve('late'), patience); });
    try { if (await Promise.race([compiling.then(() => 'linked' as const, () => 'linked' as const), late]) === 'late') stats.impatient++; }
    finally { clearTimeout(timer); }
  }

  /** One draw of `object` alone, through one pixel of the frame's own target. */
  function draw(object: Drawable) {
    const target = options.target(), previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const lights: THREE.Object3D[] = [];
    scene.traverseVisible(o => { if ((o as THREE.Light).isLight && !o.layers.isEnabled(layer)) lights.push(o); });
    const hidden: THREE.Object3D[] = [];
    for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) { hidden.push(o); o.visible = true; }
    const geometry = object.geometry as THREE.BufferGeometry, range = { start: geometry.drawRange.start, count: geometry.drawRange.count };
    const instanced = object as Partial<THREE.InstancedMesh>, count = instanced.isInstancedMesh ? instanced.count! : -1;
    const mask = object.layers.mask, cameraMask = camera.layers.mask, culled = object.frustumCulled, autoClear = renderer.autoClear;
    const sceneHook = scene.onBeforeRender, sceneAfter = scene.onAfterRender, autoUpdate = scene.matrixWorldAutoUpdate;
    const o = object as Partial<THREE.Points & THREE.Line>;
    try {
      geometry.drawRange.count = Math.min(range.count, o.isPoints ? DRAW_COUNT.points : o.isLine ? DRAW_COUNT.line : DRAW_COUNT.mesh);
      if (instanced.isInstancedMesh) instanced.count = 1;
      object.layers.set(layer); camera.layers.set(layer); object.frustumCulled = false;
      for (const light of lights) light.layers.enable(layer);
      // The scene's own pass hooks (the land's per-pass selection) belong to real frames only.
      scene.onBeforeRender = () => {}; scene.onAfterRender = () => {}; scene.matrixWorldAutoUpdate = false;
      renderer.autoClear = false;
      if (target) { saved.copy(target.viewport); target.viewport.set(0, 0, 1, 1); }
      renderer.setRenderTarget(target);
      if (!target) { renderer.getViewport(viewport); renderer.setViewport(0, 0, 1, 1); }
      try { renderer.render(scene, camera); }
      finally { if (target) target.viewport.copy(saved); else renderer.setViewport(viewport.x, viewport.y, viewport.z, viewport.w); }
    } finally {
      renderer.setRenderTarget(previous, face, mip);
      renderer.autoClear = autoClear;
      scene.onBeforeRender = sceneHook; scene.onAfterRender = sceneAfter; scene.matrixWorldAutoUpdate = autoUpdate;
      for (const light of lights) light.layers.disable(layer);
      object.layers.mask = mask; camera.layers.mask = cameraMask; object.frustumCulled = culled;
      if (instanced.isInstancedMesh) instanced.count = count;
      geometry.drawRange.start = range.start; geometry.drawRange.count = range.count;
      for (const o of hidden) o.visible = false;
    }
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      while (alive() && queue.length) {
        const next = queue.shift()!; stats.queued = queue.length;
        if (next.kind === 'program') {
          if (!attached(next.object, scene)) { seen.delete(next.key); continue; }
          await linked(next.object);
          if (!alive()) return;
          // The object may have left (a region swapped level) or changed while it linked.
          if (!attached(next.object, scene) || programSignature(next.object) !== next.key) { seen.delete(next.key); continue; }
        }
        const started = performance.now();
        try {
          if (next.kind === 'program') { draw(next.object); stats.warmed++; } else { next.draw(); stats.tasks++; }
        } catch { stats.failed++; }
        stats.issueMs += performance.now() - started;
        await settle();
      }
    } finally { running = false; }
  }

  return {
    request() {
      if (scanQueued || !alive()) return;
      // A scan walks the whole scene; assets arrive by the hundred, so look at most every SCAN_INTERVAL_MS.
      scanQueued = true; setTimeout(scan, Math.max(0, SCAN_INTERVAL_MS - (performance.now() - scannedAt)));
    },
    task(work) { if (!alive()) return; queue.push({ kind: 'task', draw: work }); stats.queued = queue.length; void run(); },
    stats: () => ({ ...stats }),
    dispose() { disposed = true; queue.length = 0; seen.clear(); stats.queued = 0; },
  };
}
