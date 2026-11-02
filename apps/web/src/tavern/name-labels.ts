/** Screen-space label candidates stay anchored to the projected head. */
export interface NameCandidate {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly distance: number;
  readonly width: number;
}

/** Label CSS uses an 18px line box and places its bottom 6px above the head. */
export const NAME_HEIGHT = 18;
export const NAME_GAP = 6;
const EDGE = 4;
const SEPARATION = 4;

export function layoutNames(candidates: readonly NameCandidate[], width: number, height: number): NameCandidate[] {
  const accepted: { candidate: NameCandidate; left: number; right: number; top: number; bottom: number }[] = [];
  const sorted = [...candidates].sort((a, b) => a.distance - b.distance || Math.abs(a.x - width / 2) - Math.abs(b.x - width / 2) || a.id.localeCompare(b.id));
  for (const candidate of sorted) {
    const left = candidate.x - candidate.width / 2, right = candidate.x + candidate.width / 2;
    const bottom = candidate.y - NAME_GAP, top = bottom - NAME_HEIGHT;
    if (![left, right, top, bottom].every(Number.isFinite) || left < EDGE || right > width - EDGE || top < EDGE || bottom > height - EDGE) continue;
    if (accepted.some(other => left < other.right + SEPARATION && right > other.left - SEPARATION && top < other.bottom + SEPARATION && bottom > other.top - SEPARATION)) continue;
    accepted.push({ candidate, left, right, top, bottom });
  }
  return accepted.map(item => item.candidate);
}

/** Measure the exact label font once, then cache widths; font loads invalidate the cache. */
export function createNameMeasurer(host: HTMLElement) {
  const probe = document.createElement('span');
  probe.className = 'gather-citizen-name';
  probe.style.visibility = 'hidden';
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const cache = new Map<string, number>();
  const refresh = () => {
    host.append(probe);
    if (context) context.font = getComputedStyle(probe).font;
    probe.remove();
    cache.clear();
  };
  refresh();
  document.fonts?.addEventListener('loadingdone', refresh);
  return {
    width(name: string) {
      let width = cache.get(name);
      if (width === undefined) {
        // A small rounding allowance covers subpixel glyph and shadow edges.
        width = Math.ceil(context?.measureText(name).width ?? name.length * 15) + 2;
        if (cache.size >= 512) cache.clear();
        cache.set(name, width);
      }
      return width;
    },
    dispose() { document.fonts?.removeEventListener('loadingdone', refresh); probe.remove(); },
  };
}
