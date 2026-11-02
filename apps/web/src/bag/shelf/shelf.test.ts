import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ItemRecord, KingdomId, PersonId, ShelfPiece } from '@chatdom/shared';
import { createKeepsakeShelf } from '../../../../../packages/content/src/keepsakes/shelf';
import { createStagedShelfSource, stagedPieces, stagedShelf } from './staged';
import {
  baysFor, drawerItems, frameView, keepsakeCount, neighbourSlot, pageOfSlot, pageSpan, placeWords, shelfPages, shelfPlacements, slotAtPoint,
  visitTitle, type FrameInput,
} from './layout';

const record = (over: Partial<ItemRecord> & Pick<ItemRecord, 'id'>): ItemRecord => ({
  version: 1, defId: 'keepsake:mount.copper-perch', branch: 'kept', ownerId: '1' as PersonId, kingdomId: '2' as KingdomId, origin: 'live', place: 'shelf', slot: 0,
  count: 1, storied: true, number: 1, story: { by: { personId: '1' as PersonId, name: 'Juniper' }, kingdomId: '2' as KingdomId, where: 'Willowmere pier', at: 0, line: '' },
  source: { kind: 'fishing', ref: 'r' }, detail: {}, createdAt: 0, revision: 0, ...over,
});

/** Where a frame puts a point on the canvas, through a real three.js camera set up as the scene sets it up. */
function project(frame: ReturnType<typeof frameView>, width: number, height: number, point: readonly [number, number, number]) {
  const camera = new THREE.PerspectiveCamera(frame.fov, frame.full[0] / frame.full[1], .05, 200);
  camera.setViewOffset(frame.full[0], frame.full[1], frame.offset[0], frame.offset[1], width, height);
  camera.position.set(...frame.position);
  camera.lookAt(new THREE.Vector3(...frame.target));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const v = new THREE.Vector3(...point).project(camera);
  return { x: (v.x + 1) / 2 * width, y: (1 - v.y) / 2 * height };
}

describe('the shelf layout', () => {
  it('lists only keepsakes still in the bag for the drawer, newest first', () => {
    const items = [
      record({ id: 'a', place: 'bag', slot: null, createdAt: 10 }),
      record({ id: 'b', place: 'bag', slot: null, createdAt: 30 }),
      record({ id: 'c', place: 'shelf', slot: 4, createdAt: 40 }),
      record({ id: 'd', place: 'bag', slot: null, branch: 'gathered', number: null, defId: 'fish:copper-perch', createdAt: 50 }),
      record({ id: 'e', place: 'bag', slot: null, branch: 'gathered', number: 3, defId: 'fish:moonlit-pike', createdAt: 20 }),
      record({ id: 'f', place: 'away', slot: null, createdAt: 60 }),
    ];
    expect(drawerItems(items).map(item => item.id)).toEqual(['b', 'e', 'a']);
  });

  it('stands one thing per place, in place order, and ignores places off the shelf', () => {
    const placed = shelfPlacements([
      record({ id: 'x', slot: 5 }), record({ id: 'y', slot: 0, number: 0 }), record({ id: 'z', slot: 5 }),
      record({ id: 'bag', place: 'bag', slot: 1 }), record({ id: 'far', slot: 64 }), record({ id: 'neg', slot: -1 }), record({ id: 'none', slot: null }),
    ]);
    expect(placed).toEqual([
      { id: 'y', defId: 'keepsake:mount.copper-perch', slot: 0, number: null },
      { id: 'x', defId: 'keepsake:mount.copper-perch', slot: 5, number: 1 },
    ]);
    const piece: ShelfPiece = { id: 'p', defId: 'keepsake:mount.moonlit-pike', slot: 13, number: 2, story: { name: null, where: 'Willowmere pier', at: 0, line: '' }, detail: {} };
    expect(shelfPlacements([piece])).toEqual([{ id: 'p', defId: piece.defId, slot: 13, number: 2 }]);
  });

  it('draws enough bays for every keepsake and for the highest place used', () => {
    expect(baysFor([])).toBe(1);
    expect(baysFor([0, 1, 2])).toBe(1);
    expect(baysFor(Array.from({ length: 12 }, (_, i) => i))).toBe(1);
    expect(baysFor(Array.from({ length: 12 }, (_, i) => i), 1)).toBe(2);
    expect(baysFor([30])).toBe(3);
    expect(baysFor(Array.from({ length: 64 }, (_, i) => i), 5)).toBe(6);
  });

  it('pages whole pairs of bays on a wide screen and half bays on a phone', () => {
    expect(shelfPages(1, false)).toEqual([{ first: 0, last: 0, part: 'whole' }]);
    expect(shelfPages(3, false)).toEqual([{ first: 0, last: 1, part: 'whole' }, { first: 2, last: 2, part: 'whole' }]);
    const phone = shelfPages(2, true);
    expect(phone.map(page => `${page.first}${page.part}`)).toEqual(['0left', '0right', '1left', '1right']);
    // Slot 0 is the middle tier's left of centre; slot 6 is the middle tier's far left; slot 7 its far right.
    expect(pageOfSlot(phone, 0)).toBe(0);
    expect(pageOfSlot(phone, 1)).toBe(1);
    expect(pageOfSlot(phone, 6)).toBe(0);
    expect(pageOfSlot(phone, 7)).toBe(1);
    expect(pageOfSlot(phone, 12)).toBe(2);
    expect(pageOfSlot(shelfPages(3, false), 30)).toBe(1);
  });

  it('lets half pages overlap a little, and keeps every place on some page', () => {
    const shelf = createKeepsakeShelf(2);
    const pages = shelfPages(2, true);
    const [l0, r0] = [pageSpan(pages[0]!, shelf.bayX), pageSpan(pages[1]!, shelf.bayX)];
    expect(l0[0]).toBe(shelf.bayX[0]![0]);
    expect(r0[1]).toBe(shelf.bayX[0]![1]);
    expect(l0[1]).toBeGreaterThan(r0[0]);
    for (const [n, slot] of shelf.slots.entries()) {
      const [x0, x1] = pageSpan(pages[pageOfSlot(pages, n)]!, shelf.bayX);
      expect(slot.at[0] - slot.width / 2).toBeGreaterThanOrEqual(x0);
      expect(slot.at[0] + slot.width / 2).toBeLessThanOrEqual(x1);
    }
  });

  it('frames the page inside the room the controls leave, and steps back for a longer page', () => {
    const base: FrameInput = {
      width: 1440, height: 900, insets: { top: 110, right: 0, bottom: 170, left: 0 },
      min: [0, 0, 0], max: [2.6, 1.9, .3], fov: 30, elevation: .1, margin: .035,
    };
    const one = frameView(base);
    const two = frameView({ ...base, max: [5.2, 1.9, .3] });
    const near = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));
    expect(near(two.position, two.target)).toBeGreaterThan(near(one.position, one.target));
    expect(two.scale).toBeLessThan(one.scale);

    for (const input of [base, { ...base, max: [5.2, 1.9, .3] as const }, { ...base, width: 390, height: 844, insets: { top: 140, right: 0, bottom: 150, left: 0 } },
      { ...base, insets: { top: 90, right: 420, bottom: 0, left: 0 } }]) {
      const frame = frameView(input);
      const free = { x0: input.insets.left, y0: input.insets.top, x1: input.width - input.insets.right, y1: input.height - input.insets.bottom };
      for (const x of [input.min[0], input.max[0]]) for (const y of [input.min[1], input.max[1]]) {
        const p = project(frame, input.width, input.height, [x, y, input.max[2]]);
        expect(p.x).toBeGreaterThanOrEqual(free.x0 - .5);
        expect(p.x).toBeLessThanOrEqual(free.x1 + .5);
        expect(p.y).toBeGreaterThanOrEqual(free.y0 - .5);
        expect(p.y).toBeLessThanOrEqual(free.y1 + .5);
      }
      // The page's centre sits at the free room's centre.
      const centre = project(frame, input.width, input.height, frame.target);
      expect(centre.x).toBeCloseTo((free.x0 + free.x1) / 2, 0);
      expect(centre.y).toBeCloseTo((free.y0 + free.y1) / 2, 0);
    }
  });

  it('walks focus to the nearest place in the direction of the key', () => {
    // A bay of three rows by four, in shelf cells (y grows upward, row 0 is the bottom shelf).
    const points = [0, 1, 2].flatMap(row => [0, 1, 2, 3].map(col => ({ slot: row * 4 + col, x: col * 100, y: row * 80 })));
    expect(neighbourSlot(points, 5, 'right')).toBe(6);
    expect(neighbourSlot(points, 5, 'left')).toBe(4);
    expect(neighbourSlot(points, 5, 'up')).toBe(9);
    expect(neighbourSlot(points, 5, 'down')).toBe(1);
    expect(neighbourSlot(points, 3, 'right')).toBeNull();
    expect(neighbourSlot(points, 8, 'up')).toBeNull();
    expect(neighbourSlot(points, 0, 'down')).toBeNull();
    expect(neighbourSlot(points, 99, 'left')).toBe(0);
    expect(neighbourSlot([], 0, 'left')).toBeNull();
  });

  it('finds the place under a point, nearest centre where two overlap', () => {
    const rects = [{ slot: 0, x: 0, y: 0, w: 100, h: 100 }, { slot: 1, x: 80, y: 0, w: 100, h: 100 }];
    expect(slotAtPoint(rects, 20, 50)).toBe(0);
    expect(slotAtPoint(rects, 95, 50)).toBe(1);
    expect(slotAtPoint(rects, 300, 50)).toBeNull();
  });

  it('names places, counts and visits in plain words', () => {
    expect(placeWords(0, 1)).toBe('Middle shelf, left of centre');
    expect(placeWords(2, 1)).toBe('Top shelf, left of centre');
    expect(placeWords(4, 1)).toBe('Bottom shelf, left of centre');
    expect(placeWords(13, 2)).toBe('Second section, middle shelf, right of centre');
    expect(keepsakeCount(1)).toBe('1 keepsake');
    expect(keepsakeCount(12)).toBe('12 keepsakes');
    expect(keepsakeCount(0)).toBe('');
    expect(keepsakeCount(NaN)).toBe('');
    expect(visitTitle('Juniper')).toBe('Juniper’s shelf');
    expect(visitTitle('  ')).toBe('A neighbour’s shelf');
    expect(visitTitle(null)).toBe('A neighbour’s shelf');
  });
});

describe('the staged shelf', () => {
  it('stages distinct numbered keepsakes in pride order, with two waiting in the bag', () => {
    const records = stagedShelf(12, 2);
    expect(records).toHaveLength(14);
    expect(new Set(records.map(item => item.defId)).size).toBe(14);
    expect(records.filter(item => item.place === 'shelf').map(item => item.slot).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(drawerItems(records)).toHaveLength(2);
    for (const item of records) {
      expect(item.number).toBeGreaterThan(0);
      expect(item.story.by?.name).toBe('Juniper');
      expect(item.story.where).toBe('Willowmere pier');
      expect(item.story.line).not.toMatch(/undefined|NaN/);
    }
    const pieces = stagedPieces(records);
    expect(pieces).toHaveLength(12);
    expect(JSON.stringify(pieces)).not.toContain('personId');
  });

  it('swaps a taken place, takes a keepsake down and remembers the door', async () => {
    const source = createStagedShelfSource(stagedShelf(3, 1), () => 5);
    let changes = 0;
    source.subscribe(() => { changes++; });
    const at = (slot: number) => source.items().find(item => item.place === 'shelf' && item.slot === slot)?.id;
    const [first, second] = [at(0)!, at(1)!];
    expect(await source.arrange(first, 1)).toEqual({ ok: true });
    expect([at(0), at(1)]).toEqual([second, first]);
    const waiting = drawerItems(source.items())[0]!.id;
    expect(await source.arrange(waiting, 2)).toEqual({ ok: true });
    expect(at(2)).toBe(waiting);
    expect(drawerItems(source.items())).toHaveLength(1);
    expect(await source.takeDown(first)).toEqual({ ok: true });
    expect(at(1)).toBeUndefined();
    expect((await source.takeDown(first)).ok).toBe(false);
    expect((await source.arrange('nobody', 3)).ok).toBe(false);
    expect(await source.show(true)).toEqual({ ok: true });
    expect(source.settings()?.shown).toBe(true);
    expect((await source.history(first)).map(event => event.kind)).toEqual(['granted', 'moved', 'moved', 'moved']);
    expect(changes).toBeGreaterThanOrEqual(5);
    source.dispose();
  });
});
