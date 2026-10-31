import { createPortraitRenderer } from '../avatar-builder/portrait-renderer';
import { defaultCitizenRecipe } from '../citizens/default-look';

/** Optional portrait generation for a host; the card receives finished bytes through CardHost.assetUrl. */
export interface PortraitRequest {
  readonly id: string;
  /** A default citizen look, or one of the card's legacy fixture aliases. */
  readonly look: string;
}

export interface PortraitOptions {
  /** Output size in pixels; the card's window is 25:31. */
  readonly width?: number;
  readonly height?: number;
  /** Retained for callers; portraits use the avatar builder's reference lighting. */
  readonly hour?: number;
  readonly signal?: AbortSignal;
}

const aborted = () => new DOMException('The portrait sitting was cancelled.', 'AbortError');

/** Renders each request to a PNG. Unknown looks and GPU or encoding failures are reported to the caller. */
export async function paintPortraits(requests: readonly PortraitRequest[], options: PortraitOptions = {}): Promise<Map<string, Blob>> {
  if (options.signal?.aborted) throw aborted();
  const width = options.width ?? 500, height = options.height ?? 620;
  const aliases: Record<string, string> = { 'citizen-a': 'hearth', 'common-short-cloak-tide': 'sun' };
  const looks = new Map(requests.map(request => {
    const id = aliases[request.look] ?? request.look;
    return [request.look, defaultCitizenRecipe(id)] as const;
  }));
  const renderer = createPortraitRenderer();
  try {
    const portraits = new Map<string, Blob>();
    for (const request of requests) {
      if (options.signal?.aborted) throw aborted();
      const size = Math.max(width, height);
      const square = renderer.render(looks.get(request.look)!, size);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error(`The portrait of ${request.id} could not be painted.`);
      context.drawImage(square, (size - width) / 2, (size - height) / 2, width, height, 0, 0, width, height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (options.signal?.aborted) throw aborted();
      if (!blob) throw new Error(`The portrait of ${request.id} could not be encoded.`);
      portraits.set(request.id, blob);
    }
    return portraits;
  } finally {
    renderer.dispose();
  }
}
