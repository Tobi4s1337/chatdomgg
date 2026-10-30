/// <reference lib="webworker" />
import { SOFTWARE, TilePainter, type PaintScene, type Stamp } from './paint';
import { TILE_PX, type TileKey } from './pyramid';

/**
 * A land-tile baker. It receives the preview's scene once, loads the stamp sheet itself, and answers each bake
 * request with an ImageBitmap. Nothing here talks to the network except the same-origin stamp sheet.
 */
export interface InitMessage {
  type: 'init';
  scene: Omit<PaintScene, 'stamps'>;
  stampsUrl: string;
  stamps: Stamp[];
}
export interface BakeMessage { type: 'bake'; id: number; key: TileKey; pixelRatio: number }
export type BakeReply = { type: 'baked'; id: number; bitmap: ImageBitmap } | { type: 'failed'; id: number; message: string } | { type: 'ready' };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let painter: TilePainter | null = null;
let ready: Promise<void> | null = null;

scope.onmessage = (event: MessageEvent<InitMessage | BakeMessage>) => {
  const message = event.data;
  if (message.type === 'init') {
    ready = (async () => {
      let image: ImageBitmap | null = null;
      try {
        const response = await fetch(message.stampsUrl);
        if (response.ok) image = await createImageBitmap(await response.blob());
      } catch {
        image = null;
      }
      painter = new TilePainter(
        { ...message.scene, stamps: image ? { image, stamps: message.stamps } : null },
        (width, height) => new OffscreenCanvas(width, height),
      );
      scope.postMessage({ type: 'ready' } satisfies BakeReply);
    })();
    return;
  }
  void (async () => {
    try {
      await ready;
      if (!painter) throw new Error('The baker has no scene.');
      const size = Math.round(TILE_PX * message.pixelRatio);
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d', SOFTWARE);
      if (!ctx) throw new Error('No 2D context.');
      painter.paint(ctx, message.key, message.pixelRatio);
      const bitmap = canvas.transferToImageBitmap();
      scope.postMessage({ type: 'baked', id: message.id, bitmap } satisfies BakeReply, [bitmap]);
    } catch (error) {
      scope.postMessage({ type: 'failed', id: message.id, message: error instanceof Error ? error.message : String(error) } satisfies BakeReply);
    }
  })();
};
