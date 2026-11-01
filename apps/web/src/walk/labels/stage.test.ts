import { expect, it } from 'vitest';
import { labelLimits } from './density';
import { labelMeasureKey, type PersonLabel } from './model';
import { BUBBLE_TAIL_PX, createLabelStage, OVERLAP_HOLD_MS, type LabelSize, type StagedLabel } from './stage';
import { BUBBLE_RISE_PX, LABEL_FADE_OUT_MS } from './timing';

const viewport = { width: 1440, height: 900 };
const name = (id: string, x: number, y = 400, distance = 6, patch: Partial<PersonLabel> = {}): PersonLabel => ({ id, x, y, distance, self: false, name: id, ...patch });
const words = (text: string) => [{ kind: 'text' as const, text }];
const fixed = (width = 80, height = 26) => (person: PersonLabel): LabelSize => person.speech ? { width: 150, height: 52 } : { width, height };
const byId = (staged: readonly StagedLabel[]) => new Map(staged.map(label => [label.id, label]));

function run(people: (frame: number) => PersonLabel[], frames: number, options: { limits?: ReturnType<typeof labelLimits>; reducedMotion?: boolean; size?: (person: PersonLabel) => LabelSize | undefined } = {}) {
  const stage = createLabelStage(), history: Map<string, StagedLabel>[] = [];
  for (let frame = 0; frame < frames; frame++) {
    history.push(byId(stage.frame({ people: people(frame), viewport, limits: options.limits ?? labelLimits(), reducedMotion: options.reducedMotion ?? false,
      now: frame * 16, size: options.size ?? fixed() })));
  }
  return history;
}

it('fades labels in and out instead of popping', () => {
  const history = run(frame => frame < 40 ? [name('a', 300)] : [], 80);
  const opacity = history.map(frame => frame.get('a')?.opacity ?? 0);
  expect(opacity[0]).toBe(0);
  expect(opacity[3]).toBeGreaterThan(0); expect(opacity[3]).toBeLessThan(1);
  expect(opacity[30]).toBe(1);
  // Gone from the frame: it keeps fading where it was, then its element is released.
  expect(opacity[42]).toBeGreaterThan(0); expect(opacity[42]).toBeLessThan(1);
  const gone = history.findIndex((frame, index) => index > 40 && !frame.has('a'));
  expect(gone).toBeGreaterThan(40 + Math.floor(LABEL_FADE_OUT_MS / 16) - 1);
});

it('resolves an overlap with hysteresis: a shown label holds, then fades, and never flip-flops at the boundary', () => {
  // `b` drifts onto `a` and then jitters each frame between a heavy and a light overlap with it.
  const position = (frame: number) => frame < 30 ? 600 : frame % 2 ? 300 + 50 : 300 + 62;
  const history = run(frame => [name('a', 300, 400, 4), name('b', position(frame), 400, 8)], 200);
  const shown = history.map(frame => frame.get('b')!.shown);
  expect(shown[29]).toBe(true);
  // It holds its place for a moment while covered, then gives way exactly once.
  const yielded = shown.indexOf(false, 30);
  expect((yielded - 30) * 16).toBeGreaterThan(OVERLAP_HOLD_MS - 32);
  expect(shown.slice(yielded).every(value => !value)).toBe(true);
  // The nearer label never moved or blinked.
  expect(history.slice(20).every(frame => frame.get('a')!.shown && frame.get('a')!.left === 260)).toBe(true);
  // It fades rather than vanishing in one frame.
  const fade = history.slice(yielded, yielded + 6).map(frame => frame.get('b')!.opacity);
  expect(fade[1]).toBeGreaterThan(0); expect(fade[1]).toBeLessThan(1);
  for (let i = 1; i < fade.length; i++) expect(fade[i]).toBeLessThanOrEqual(fade[i - 1]!);
});

it('keeps a shown label through a graze, but a new label needs clear space', () => {
  // `b` overlaps `a` by 10% of its width: tolerable for a label that is up, not enough room for one that is not.
  const graze = 300 + 72;
  const kept = run(frame => [name('a', 300, 400, 4), name('b', frame < 20 ? 600 : graze, 400, 8)], 120);
  expect(kept.at(-1)!.get('b')!.shown).toBe(true);
  const fresh = run(() => [name('a', 300, 400, 4), name('b', graze, 400, 8)], 120);
  expect(fresh.some(frame => frame.get('b')!.shown)).toBe(false);
  // Clear of the margin, it appears.
  const clear = run(() => [name('a', 300, 400, 4), name('b', 300 + 80 + 12, 400, 8)], 10);
  expect(clear.at(-1)!.get('b')!.shown).toBe(true);
});

it('keeps a bubble’s measured size and place through a name toggle', () => {
  const sizes = new Map<string, LabelSize>();
  const person = (frame: number): PersonLabel => ({ id: 'home:4', slot: 4, x: 500, y: 300, distance: 9, self: false, home: true,
    name: frame % 10 < 5 ? 'Rowan' : null, speech: words('Good evening') });
  // Sizes are recorded under the measure key, as the layer records what it measured.
  sizes.set(labelMeasureKey(person(0)), { width: 160, height: 54 });
  const history = run(frame => [person(frame)], 60, { size: label => sizes.get(labelMeasureKey(label)) });
  const label = history.map(frame => frame.get('home:4')!);
  expect(label.slice(1).every(item => item.shown)).toBe(true);
  for (let i = 1; i < label.length; i++) expect(label[i]!.opacity).toBeGreaterThanOrEqual(label[i - 1]!.opacity);
});

it('anchors a bubble’s tail tip on the head, rising into place unless motion is reduced', () => {
  const person: PersonLabel = { id: 'walker:w', walkerId: 'w', x: 400, y: 300, distance: 5, self: false, name: 'Wren', speech: words('Hi') };
  const moving = run(() => [person], 30).map(frame => frame.get('walker:w')!);
  const still = run(() => [person], 30, { reducedMotion: true }).map(frame => frame.get('walker:w')!);
  const top = 300 - BUBBLE_TAIL_PX - 52;
  expect(moving.at(-1)!.left).toBe(400 - 75);
  expect(moving.at(-1)!.top).toBe(top);
  expect(moving[2]!.top).toBeGreaterThan(top);
  expect(moving[2]!.top).toBeLessThanOrEqual(top + BUBBLE_RISE_PX);
  expect(still.every(label => label.top === top)).toBe(true);
});

it('shows the nearest first and honours the density setting', () => {
  const speakers = Array.from({ length: 6 }, (_, i) => name(`s${i}`, 120 + i * 200, 300, 4 + i * 4, { speech: words(`line ${i}`) }));
  const names = Array.from({ length: 8 }, (_, i) => name(`n${i}`, 90 + i * 160, 700, 3 + i * 3));
  const shown = (limits: ReturnType<typeof labelLimits>) => {
    const last = run(() => [...speakers, ...names], 3, { limits }).at(-1)!;
    return [...last.values()].filter(label => label.shown).map(label => label.id).sort();
  };
  // All: four bubbles within 28 m, every name within 40 m.
  expect(shown(labelLimits('all', 'all'))).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 's0', 's1', 's2', 's3']);
  // Nearby: only within 18 m.
  expect(shown(labelLimits('nearby', 'nearby'))).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 's0', 's1', 's2', 's3']);
  // Few: one bubble and three names, the nearest.
  expect(shown(labelLimits('few', 'few'))).toEqual(['n0', 'n1', 'n2', 's0']);
});

it('lets a new bubble push aside someone else’s name, but never your own or another bubble', () => {
  const history = run(frame => frame < 20 ? [name('other', 400, 300, 9), name('me', 700, 300, 1, { self: true })]
    : [name('other', 400, 300, 9), name('me', 700, 300, 1, { self: true }),
      name('speaker', 410, 310, 10, { speech: words('Over here!') }), name('quiet', 690, 310, 10, { speech: words('Me too') })], 60);
  const last = history.at(-1)!;
  expect(last.get('speaker')!.shown).toBe(true);
  expect(last.get('other')!.shown).toBe(false);
  expect(last.get('me')!.shown).toBe(true);
  expect(last.get('quiet')!.shown).toBe(false);
});

it('hides a home bubble behind a wall by fading it at the home', () => {
  const home = (visibility: number, x: number): PersonLabel => ({ id: 'home:2', slot: 2, x, y: 300, distance: 10, self: false, name: 'Rowan', home: true, visibility, speech: words('Hello') });
  const history = run(frame => [home(frame < 30 ? 1 : 0, 400 + frame)], 60);
  const label = history.map(frame => frame.get('home:2')!);
  expect(label[29]!.opacity).toBe(1);
  expect(label[32]!.shown).toBe(false);
  expect(label[32]!.opacity).toBeGreaterThan(0);
  // While fading it still follows its anchor.
  expect(label[32]!.left).toBe(400 + 32 - 75);
});
