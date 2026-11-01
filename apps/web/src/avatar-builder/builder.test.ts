import { describe, expect, it } from 'vitest';
import { PORTRAIT_FIXTURES, parseLook, seedLook, type CitizenLook } from '../../../../packages/content/src/avatar-style';
import { TABS } from './catalogue';
import { HISTORY_DEPTH, commit, isUnchanged, redo, startHistory, undo } from './draft';
import { capeObject, disposeCape } from './cape';

const looks: readonly CitizenLook[] = [...PORTRAIT_FIXTURES.map(f => f.look), ...Array.from({ length: 12 }, (_, i) => seedLook(`builder-${i}`))];

describe('the builder catalogue', () => {
  it('offers the same nine tabs on page and panel, every control labelled', () => {
    expect(TABS.map(t => t.id)).toEqual(['face', 'hair', 'beard', 'hat', 'trinkets', 'top', 'layer', 'below', 'earned']);
    for (const t of TABS) for (const c of t.controls) expect(c.label.length, c.id).toBeGreaterThan(2);
  });

  it('makes a valid look from every tile on every look, and the tile then reads as chosen', () => {
    for (const look of looks) for (const t of TABS) for (const control of t.controls) {
      if (control.kind !== 'tiles' || (control.visible && !control.visible(look))) continue;
      for (const option of control.options) {
        const next = option.apply(look);
        expect(() => parseLook(JSON.parse(JSON.stringify(next))), `${control.id}:${option.id}`).not.toThrow();
        expect(option.selected(next), `${control.id}:${option.id}`).toBe(true);
        expect(control.options.filter(o => o.selected(next)), `${control.id}:${option.id}`).toHaveLength(1);
      }
    }
  });

  it('sets any colour from a swatch or the colour wheel, and reads it back', () => {
    for (const look of looks.slice(0, 6)) for (const t of TABS) for (const control of t.controls) {
      if (control.kind !== 'swatches' || (control.visible && !control.visible(look))) continue;
      for (const hex of [control.groups[0]!.swatches[0]!.hex, '#7a3e9d'] as const) {
        const next = control.set(look, hex);
        expect(control.get(next), control.id).toBe(hex);
        expect(() => parseLook(next), control.id).not.toThrow();
      }
    }
  });

  it('takes off a forged hat for a hat and the raid scarf for neckwear', () => {
    const look: CitizenLook = { ...looks[0]!, hat: null, neckwear: null, earned: { ...looks[0]!.earned, forgedHat: { id: 'f', motif: 'sunflower', colours: ['#f6d23c', '#5a3622'] }, scarf: { id: 'r', colours: ['#2d5fd8', '#d3202a'] } } };
    const cap = TABS.find(t => t.id === 'hat')!.controls[0]!;
    const tie = TABS.find(t => t.id === 'layer')!.controls.find(c => c.id === 'neckwear')!;
    if (cap.kind !== 'tiles' || tie.kind !== 'tiles') throw new Error('tiles expected');
    expect(cap.options.find(o => o.id === 'cap')!.apply(look).earned.forgedHat).toBeNull();
    expect(tie.options.find(o => o.id === 'tie')!.apply(look).earned.scarf).toBeNull();
    const bareNeck = tie.options.find(o => o.id === 'none')!;
    expect(bareNeck.selected(look)).toBe(false);
    expect(bareNeck.apply(look).earned.scarf).toBeNull();
    expect(bareNeck.selected(bareNeck.apply(look))).toBe(true);
  });
});

describe('cape dressing', () => {
  it('dims a lapsed sub cape but leaves a moment cape unchanged', () => {
    const cape = { id: 'piece', cloth: '#223a7a', lining: '#f3f1ee', trim: '#e6b73a' } as const;
    const look = looks[0]!;
    const cheer = capeObject({ ...look, earned: { ...look.earned, cape: { ...cape, kind: 'cheer' } } }, true)!;
    const sub = capeObject({ ...look, earned: { ...look.earned, cape: { ...cape, kind: 'tier-cloak' } } }, true)!;
    expect(cheer.userData.cut.dim).toBe(false);
    expect(sub.userData.cut.dim).toBe(true);
    disposeCape(cheer);
    disposeCape(sub);
  });
});

describe('the draft', () => {
  const a = looks[0]!, b = looks[1]!, c = looks[2]!;

  it('undoes and redoes, and a new edit clears what could be redone', () => {
    let h = startHistory(a);
    h = commit(h, b);
    h = commit(h, c);
    expect(undo(h).present).toBe(b);
    expect(undo(undo(h)).present).toBe(a);
    expect(undo(undo(undo(h))).present).toBe(a);
    expect(redo(undo(h)).present).toBe(c);
    const branched = commit(undo(h), a);
    expect(branched.future).toHaveLength(0);
  });

  it('merges a run of the same edit into one step, and ignores edits that change nothing', () => {
    let h = startHistory(a);
    h = commit(h, { ...a, skin: '#111111' }, 'skin');
    h = commit(h, { ...a, skin: '#222222' }, 'skin');
    h = commit(h, { ...a, skin: '#333333' }, 'skin');
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toBe(a);
    expect(commit(h, h.present)).toBe(h);
  });

  it('remembers a bounded number of steps and knows when the draft matches the saved look', () => {
    let h = startHistory(a);
    for (let i = 0; i < HISTORY_DEPTH + 20; i++) h = commit(h, { ...a, skin: `#0000${(i % 256).toString(16).padStart(2, '0')}` });
    expect(h.past.length).toBe(HISTORY_DEPTH);
    expect(isUnchanged(JSON.parse(JSON.stringify(a)), a)).toBe(true);
    expect(isUnchanged(b, a)).toBe(false);
  });
});
