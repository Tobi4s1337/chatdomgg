/** Keep a measured caption within its own picture while staying as close as possible to the world anchor. */
export function boundCaptionPoint(anchor: { x: number; y: number }, box: { width: number; height: number },
  viewport: { width: number; height: number }, margin = 12): { x: number; y: number } {
  const clamp = (value: number, low: number, high: number) => high < low ? (low + high) / 2 : Math.max(low, Math.min(high, value));
  return { x: clamp(anchor.x, box.width / 2 + margin, viewport.width - box.width / 2 - margin),
    y: clamp(anchor.y, box.height + margin, viewport.height - margin) };
}
