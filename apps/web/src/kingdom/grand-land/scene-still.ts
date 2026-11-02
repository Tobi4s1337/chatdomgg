/** What a still is encoded as. The panel's stills are WebP; quality trades bytes for detail. */
export interface SceneStillOptions { readonly type?: 'image/webp' | 'image/jpeg' | 'image/png'; readonly quality?: number }

type StillCanvas = Pick<HTMLCanvasElement, 'width' | 'height' | 'toBlob'> & { getContext(kind: '2d'): Pick<CanvasRenderingContext2D, 'drawImage'> | null };
interface Pending {
  readonly width: number; readonly type: string; readonly quality: number;
  readonly resolve: (blob: Blob) => void; readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** A still waits this long for the scene's next drawn frame (a hidden or still-loading scene draws none). */
export const SCENE_STILL_TIMEOUT_MS = 15_000;
const MIN_WIDTH = 16;

/**
 * Stills of the frame the scene actually draws, for the panel's live picture. A request asks the scene for one more
 * draw and is answered inside that same task, straight after the post stack presents: the drawing buffer is read
 * before the browser may clear it, so the renderer needs no preserved buffer and nothing is drawn twice. The copy is
 * scaled to `width` (never above the canvas) with the canvas's aspect, then encoded off the render path.
 */
export function createSceneStills(source: Pick<HTMLCanvasElement, 'width' | 'height'> & CanvasImageSource, hooks: {
  /** Ask the render loop to draw on its next frame even when nothing changed. */
  requestDraw(): void;
  createCanvas?: () => StillCanvas;
  timeoutMs?: number;
}) {
  const pending: Pending[] = [];
  let disposed = false;
  const make = hooks.createCanvas ?? (() => document.createElement('canvas') as StillCanvas);
  const fail = (entry: Pending, message: string) => { clearTimeout(entry.timer); entry.reject(new Error(message)); };
  return {
    /** Resolves with the next drawn frame; rejects when the scene closes or draws nothing in time. */
    still(width: number, options: SceneStillOptions = {}): Promise<Blob> {
      if (disposed) return Promise.reject(new Error('The kingdom view has closed'));
      if (!Number.isFinite(width) || width < MIN_WIDTH) return Promise.reject(new RangeError(`A still needs a width of at least ${MIN_WIDTH} pixels`));
      const quality = options.quality ?? .85;
      if (!Number.isFinite(quality) || quality <= 0 || quality > 1) return Promise.reject(new RangeError('A still quality is in (0, 1]'));
      return new Promise<Blob>((resolve, reject) => {
        const entry: Pending = { width: Math.round(width), type: options.type ?? 'image/webp', quality, resolve, reject,
          timer: setTimeout(() => {
            const index = pending.indexOf(entry);
            if (index >= 0) { pending.splice(index, 1); reject(new Error('The kingdom drew no frame for the still')); }
          }, hooks.timeoutMs ?? SCENE_STILL_TIMEOUT_MS) };
        pending.push(entry);
        hooks.requestDraw();
      });
    },
    /** Call in the same task as the frame's final present. Cheap when nothing is waiting. */
    drawn() {
      if (!pending.length) return;
      for (const entry of pending.splice(0)) {
        clearTimeout(entry.timer);
        if (!source.width || !source.height) { entry.reject(new Error('The kingdom view has no size')); continue; }
        const width = Math.max(MIN_WIDTH, Math.min(source.width, entry.width)), height = Math.max(1, Math.round(source.height * width / source.width));
        const copy = make(); copy.width = width; copy.height = height;
        const context = copy.getContext('2d');
        if (!context) { entry.reject(new Error('This browser cannot copy the kingdom view')); continue; }
        context.drawImage(source, 0, 0, width, height);
        copy.toBlob(blob => { if (blob && blob.size) entry.resolve(blob); else entry.reject(new Error('The kingdom still could not be encoded')); }, entry.type, entry.quality);
      }
    },
    get waiting() { return pending.length; },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of pending.splice(0)) fail(entry, 'The kingdom view has closed');
    },
  };
}
