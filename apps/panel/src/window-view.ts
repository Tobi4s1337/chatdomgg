/**
 * The You tab's arch looks into the latest painting at the viewer's own lit window. The arch shows a crop of the
 * painting: the image is drawn `zoom` times the arch's width and slid so the window sits as near the centre as the
 * painting's edges allow. Near an edge the crop stops at the edge and the ring moves off-centre instead, so the arch
 * never shows past the painting.
 */

/** Arch height over arch width; the open `.cw-window` frame uses the same ratio (112 × 148, 150 × 198). */
export const WINDOW_VIEW_ASPECT = 1.32;
/** Painting width over arch width. A 640 px painting in a 112 to 150 px arch is drawn at about its own pixel size. */
export const WINDOW_VIEW_ZOOM = 4.2;

export interface WindowViewCrop {
  /** The painting fraction placed at the arch's centre, for `translate(-x * 100%, -y * 100%)` from the centre. */
  readonly centre: { readonly x: number; readonly y: number };
  /** Where the window sits in the arch, 0..1 across and down. */
  readonly ring: { readonly x: number; readonly y: number };
  /** The painted image's width as a fraction of the arch width. */
  readonly zoom: number;
}

const clamp = (value: number, low: number, high: number) => low > high ? .5 : Math.min(high, Math.max(low, value));

export function windowViewCrop(mark: { readonly x: number; readonly y: number }, painting: { readonly width: number; readonly height: number }): WindowViewCrop | null {
  if (!(painting.width > 0) || !(painting.height > 0)) return null;
  if (!Number.isFinite(mark.x) || !Number.isFinite(mark.y) || mark.x < 0 || mark.x > 1 || mark.y < 0 || mark.y > 1) return null;
  const zoom = WINDOW_VIEW_ZOOM;
  // The drawn painting's height, in arch heights.
  const tall = zoom * (painting.height / painting.width) / WINDOW_VIEW_ASPECT;
  const halfX = 1 / (2 * zoom), halfY = 1 / (2 * tall);
  const centre = { x: clamp(mark.x, halfX, 1 - halfX), y: clamp(mark.y, halfY, 1 - halfY) };
  const ring = { x: .5 + (mark.x - centre.x) * zoom, y: .5 + (mark.y - centre.y) * tall };
  return { centre, ring, zoom };
}
