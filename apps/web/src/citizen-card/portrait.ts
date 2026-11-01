import { PORTRAIT, type CitizenLook } from '@chatdom/content/avatar-style';
import { createPortraitRenderer } from '../avatar-builder/portrait-renderer';
import { defaultCitizenRecipe } from '../citizens/default-look';

/** Optional portrait generation for a host; the card receives finished bytes through CardHost.assetUrl. */
export interface PortraitRequest {
  readonly id: string;
  /** Their saved look, or a default citizen look (or one of the card's legacy fixture aliases) by name. */
  readonly look: CitizenLook | string;
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
const ALIASES: Readonly<Record<string, string>> = { 'citizen-a': 'hearth', 'common-short-cloak-tide': 'sun' };
const recipe = (look: CitizenLook | string): CitizenLook => typeof look === 'string' ? defaultCitizenRecipe(ALIASES[look] ?? look) : look;

/**
 * Renders each request to a PNG for the card's arched window. The renderer's bust is square and the window is
 * taller than it is wide, so the bust is drawn over the portrait's own Twitch-purple ground carried across the whole
 * window, scaled and placed by its measured silhouette: the top of the hair sits a little under the crown of the
 * arch, the figure stands on the sill, and it is centred on itself. Head and shoulders fill the window rather than
 * floating low in a field of purple. Unknown looks and GPU or encoding failures are reported to the caller.
 */
export async function paintPortraits(requests: readonly PortraitRequest[], options: PortraitOptions = {}): Promise<Map<string, Blob>> {
  if (options.signal?.aborted) throw aborted();
  const width = options.width ?? 500, height = options.height ?? 620;
  const looks = new Map(requests.map(request => [request.id, recipe(request.look)] as const));
  const renderer = createPortraitRenderer();
  try {
    const portraits = new Map<string, Blob>();
    for (const request of requests) {
      if (options.signal?.aborted) throw aborted();
      const size = Math.max(width, height);
      const bust = renderer.render(looks.get(request.id)!, size, { transparent: true });
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error(`The portrait of ${request.id} could not be painted.`);
      // The portrait's ground: lilac at the top left to deep violet at the bottom right, as on every portrait.
      const ground = context.createLinearGradient(0, 0, width, height);
      ground.addColorStop(0, PORTRAIT.gradient.from);
      ground.addColorStop(.5, PORTRAIT.gradient.mid);
      ground.addColorStop(1, PORTRAIT.gradient.to);
      context.fillStyle = ground;
      context.fillRect(0, 0, width, height);
      const place = sit(bust, width, height);
      context.drawImage(bust, place.x, place.y, place.size, place.size);
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

/** Where the top of the hair sits, as a share of the window's height: just under the crown of the arch. */
const CROWN = .14;
/** Never enlarged so far that the voxels go soft. */
const MOST = 1.6;

/**
 * The bust's placement in the window, from its silhouette (the opaque pixels of the transparent render): scaled so
 * the figure fills the window from just under the arch's crown down to the sill, and centred on the figure itself.
 */
export function sit(bust: HTMLCanvasElement, width: number, height: number): { x: number; y: number; size: number } {
  const size = bust.width;
  const pixels = bust.getContext('2d')!.getImageData(0, 0, size, size).data;
  let top = size, left = size, right = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pixels[(y * size + x) * 4 + 3]! < 24) continue;
      if (y < top) top = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  // An empty render keeps the plain framing: the square across the full width, standing on the sill.
  if (right < 0) return { x: 0, y: height - width, size: width };
  const scale = Math.min(MOST * width / size, (height * (1 - CROWN)) / (size - top));
  const drawn = size * scale;
  const middle = (left + right + 1) / 2 * scale;
  return { x: width / 2 - middle, y: height - drawn, size: drawn };
}
