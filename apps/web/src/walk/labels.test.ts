import { expect, it } from 'vitest';
import { layoutWalkLabels, type WalkLabelAnchor } from './labels';
const label = (id: string, x: number, patch: Partial<WalkLabelAnchor> = {}): WalkLabelAnchor => ({ id, x, y: 200, distance: 4, width: 80, height: 26, self: false, speaking: false, ...patch });
it('keeps nearby speech readable without detaching labels or covering the phone HUD', () => {
  const anchors = [label('far', 100, { distance: 20 }), label('self', 110, { self: true }), label('speaker', 115, { speaking: true, height: 64 }), label('hud', 300), label('edge', 380)];
  const result = layoutWalkLabels(anchors, { width: 390, height: 844 }, [{ left: 260, top: 150, right: 360, bottom: 240 }]);
  expect(result.map(p => p.anchor.id)).toEqual(['speaker']);
  expect(result[0]!.anchor).toBe(anchors[2]);
  expect(result[0]!.bounds).toEqual({ left: 75, right: 155, top: 136, bottom: 200 });
});
it('is stable under input order, deduplicates, and caps names and speech in a crowded frame', () => {
  const anchors = Array.from({ length: 30 }, (_, i) => label(String(i).padStart(2, '0'), 60 + i % 10 * 130, { y: 100 + Math.floor(i / 10) * 150, speaking: i < 7 }));
  const viewport = { width: 1440, height: 900 };
  const selected = layoutWalkLabels([...anchors, anchors[0]!], viewport);
  expect(selected).toHaveLength(12);
  expect(selected.filter(p => p.anchor.speaking)).toHaveLength(3);
  expect(selected.map(p => p.anchor.id)).toEqual(layoutWalkLabels([...anchors].reverse(), viewport).map(p => p.anchor.id));
});
it('rejects invalid coordinates and distant speech rather than leaving stale labels', () => {
  const input = [label('nan', NaN), label('far', 100, { speaking: true, distance: 29 }), label('wide', 150, { width: 500 })];
  expect(layoutWalkLabels(input, { width: 390, height: 844 })).toEqual([]);
  expect(layoutWalkLabels([label('one', 100)], { width: 0, height: 0 })).toEqual([]);
});
