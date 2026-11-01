import type { LabelRect } from '../labels';

/**
 * Measure caller-selected HUD elements in the label layer's CSS coordinates. Call after layout, or again when
 * the caller's HUD moves or visibility changes. No selectors, global queries, observers or persistent state.
 * The root's bounding box accounts for the stream lens's axis-aligned scale/translation.
 */
export function measureReservedElements(root: HTMLElement, elements: readonly Element[]): LabelRect[] {
  const frame = root.getBoundingClientRect();
  if (!(frame.width > 0 && frame.height > 0 && root.clientWidth > 0 && root.clientHeight > 0)) return [];
  const scaleX = root.clientWidth / frame.width, scaleY = root.clientHeight / frame.height;
  const view = root.ownerDocument.defaultView;
  return elements.flatMap(element => {
    if (!element.isConnected || !element.getClientRects().length) return [];
    const style = view?.getComputedStyle(element);
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0)) return [];
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return [];
    return [{ left: (rect.left - frame.left) * scaleX, top: (rect.top - frame.top) * scaleY,
      right: (rect.right - frame.left) * scaleX, bottom: (rect.bottom - frame.top) * scaleY }];
  });
}
