import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { FishingPierSite, PierFeedEvent, PierFeedLine, PierFeedWho } from '@chatdom/shared';
import { CAST_S, EXIT_S, blankPose, floatDone, floatPose, leapPose, zigzag, type FloatMotion, type Vec } from './motion';
import { brokenWords, cardSummary, catchWords, createCardStack, fullWords, CARD_ENTER_S, CARD_HOLD_BIG_S, CARD_HOLD_LEGEND_S, CARD_HOLD_S, CARD_LEAVE_S } from './words';
import { mountChatLines } from './lines';

const who = (name: string | null, colour: string | null = '#ffb347'): PierFeedWho => ({ name, slot: colour ? 3 : null, colour });
const caught = (name: string | null, extra: Partial<Extract<PierFeedEvent, { kind: 'caught' }>> = {}): Extract<PierFeedEvent, { kind: 'caught' }> => ({
  kind: 'caught', at: 1, id: 'a', who: who(name), via: 'chat', fish: { speciesId: 'fish:copper-perch', lengthMm: 342, weightG: 812 },
  kingdomFirst: false, keepsake: null, float: [0, 0, 6], ...extra });

describe('the chat cards say what happened', () => {
  it('names the catch, its measure and its honours', () => {
    const words = catchWords(caught('Juniper', { kingdomFirst: true, keepsake: 1 }), 'Willowmere');
    expect(words.sentence).toBe('Juniper caught a Copper Perch');
    expect([words.lead, words.subject]).toEqual(['Juniper caught a ', 'Copper Perch']);
    expect(words.measure).toBe('812 g · 34 cm');
    expect(words.first).toBe('First in Willowmere');
    expect(words.mount).toBe('Mount No. 1');
    expect(words.hold).toBe(CARD_HOLD_BIG_S);
    expect(cardSummary(words)).toBe('Juniper caught a Copper Perch, 812 g, 34 cm. First in Willowmere. Mount No. 1.');
  });
  it('never guesses at a hidden name or a missing kingdom', () => {
    const words = catchWords(caught(null, { kingdomFirst: true }), null);
    expect(words.sentence).toBe('A fisher caught a Copper Perch');
    expect(words.who).toBeNull();
    expect(words.first).toBe('First in this kingdom');
    expect(catchWords(caught('  ', { kingdomFirst: true }), '  ').sentence).toBe('A fisher caught a Copper Perch');
    expect(brokenWords({ kind: 'broken', at: 1, id: 'b', who: who(null), speciesId: 'fish:goldscale-emperor', float: [0, 0, 0] }).sentence)
      .toBe('The Goldscale Emperor broke a fisher’s line');
  });
  it('takes the right article and holds plain catches for six seconds', () => {
    const words = catchWords(caught('Wren', { fish: { speciesId: 'fish:inkfin-wrasse', lengthMm: 1200, weightG: 2140 }, via: 'pier', float: null }), 'Willowmere');
    expect(words.sentence).toBe('Wren caught an Inkfin Wrasse');
    expect(words.measure).toBe('2.14 kg · 1.20 m');
    expect([words.first, words.mount, words.hold]).toEqual([null, null, CARD_HOLD_S]);
    expect(catchWords(caught('Wren', { fish: { speciesId: 'fish:unknown-thing', lengthMm: 100, weightG: 10 } }), null).sentence).toBe('Wren caught a fish');
  });
  it('gives a legend its own words and its moral', () => {
    const words = brokenWords({ kind: 'broken', at: 1, id: 'b', who: who('Brannigan'), speciesId: 'fish:goldscale-emperor', float: [0, 0, 0] });
    expect(words.sentence).toBe('The Goldscale Emperor broke Brannigan’s line');
    expect(words.moral).toBe('Only a walker could have held it.');
    expect([words.kind, words.hold]).toEqual(['legend', CARD_HOLD_LEGEND_S]);
    expect(cardSummary(words)).toBe('The Goldscale Emperor broke Brannigan’s line. Only a walker could have held it.');
  });
  it('is honest when the pier is full', () => {
    expect(fullWords({ kind: 'full', at: 1, who: who('Pell'), cap: 8 }).sentence).toBe('The pier is full: 8 lines are out. Try again in a moment.');
    expect(fullWords({ kind: 'full', at: 1, who: who('Pell'), cap: 1 }).sentence).toBe('The pier is full: 1 line is out. Try again in a moment.');
  });
  it('never prints a placeholder', () => {
    for (const words of [catchWords(caught(null), null), brokenWords({ kind: 'broken', at: 1, id: 'b', who: who(null, null), speciesId: 'fish:nope', float: [0, 0, 0] })])
      expect(cardSummary(words)).not.toMatch(/undefined|null|NaN/);
  });
});

describe('the card stack', () => {
  it('shows at most three, sends the oldest away and drops it once it has left', () => {
    const stack = createCardStack<string>();
    stack.add('a', 0, 6); stack.add('b', .1, 6); stack.add('c', .2, 6);
    expect(stack.step(.3).shown.map(card => card.value)).toEqual(['a', 'b', 'c']);
    stack.add('d', 1, 6);
    expect(stack.step(.9).shown.map(card => card.value)).toEqual(['a', 'b', 'c']);
    const step = stack.step(1);
    expect(step.shown.find(card => card.value === 'a')?.leaving).toBe(1);
    expect(stack.step(1 + CARD_LEAVE_S + 1e-9).dropped.map(card => card.value)).toEqual(['a']);
    expect(stack.step(1.5).shown.map(card => card.value)).toEqual(['b', 'c', 'd']);
  });
  it('holds each card its own time', () => {
    const stack = createCardStack<string>();
    stack.add('plain', 0, CARD_HOLD_S); stack.add('first', 0, CARD_HOLD_BIG_S);
    stack.step(CARD_ENTER_S + CARD_HOLD_S);
    expect(stack.step(CARD_ENTER_S + CARD_HOLD_S + CARD_LEAVE_S).dropped.map(card => card.value)).toEqual(['plain']);
    expect(stack.step(CARD_ENTER_S + CARD_HOLD_BIG_S - .01).shown.map(card => card.value)).toEqual(['first']);
  });
});

describe('a chat float moves', () => {
  const motion = (extra: Partial<FloatMotion> = {}): FloatMotion => ({ phase: 'float', since: 0, born: 0, cast: true, from: [0, 3, 0], at: [0, 0, 8], waterY: 0,
    seed: 1, pull: [0, 1], exit: null, exitAt: 0, ...extra });
  it('flies in from the pier and lands on its mark', () => {
    const pose = floatPose(motion(), 0, blankPose());
    expect([pose.x, pose.y, pose.z, pose.flying]).toEqual([0, 3, 0, true]);
    const mid = floatPose(motion(), CAST_S / 2, blankPose());
    expect(mid.y).toBeGreaterThan(1.5);
    const landed = floatPose(motion(), CAST_S + 3, blankPose());
    expect(landed.flying).toBe(false);
    expect(landed.z).toBeCloseTo(8); expect(Math.abs(landed.y)).toBeLessThan(.03);
  });
  it('dips at a bite and zigzags in a fight', () => {
    expect(floatPose(motion({ phase: 'bite', since: 5 }), 5.16, blankPose()).y).toBeLessThan(-.1);
    const xs = [0, .3, .6, .9, 1.2].map(t => floatPose(motion({ phase: 'fight', since: 5 }), 5.5 + t, blankPose()).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(.4);
    expect(zigzag(.25)).toBeCloseTo(0); expect(zigzag(0)).toBe(-1); expect(zigzag(.5)).toBe(1);
  });
  it('leaves each way and then frees its slot', () => {
    for (const exit of ['gone', 'caught', 'broken'] as const) {
      const leaving = motion({ exit, exitAt: 10 });
      expect(floatDone(leaving, 10 + EXIT_S[exit] - .01)).toBe(false);
      expect(floatDone(leaving, 10 + EXIT_S[exit] + 1e-9)).toBe(true);
      expect(floatPose(leaving, 10 + EXIT_S[exit], blankPose()).scale).toBeLessThan(.3);
    }
    expect(floatPose(motion({ exit: 'broken', exitAt: 10 }), 10.5, blankPose()).y).toBeLessThan(-.5);
  });
  it('leaps up and back into the water', () => {
    const out: Vec = [0, 0, 0];
    expect(leapPose(0, [0, 0, 0], [1, 0], 1, 2, 0, out)).toBeGreaterThan(0);
    expect(out[1]).toBeLessThan(0);
    leapPose(.65, [0, 0, 0], [1, 0], 1, 2, 0, out);
    expect(out[1]).toBeGreaterThan(.9); expect(out[0]).toBeCloseTo(1);
  });
});

/* ---------- The view, on a small stand-in for the page ---------- */

class FakeNode {
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  className = '';
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  props = new Map<string, string>();
  style = { transform: '', setProperty: (key: string, value: string) => { this.props.set(key, value); } };
  offsetHeight = 120;
  ownText = '';
  innerHTML = '';
  constructor(readonly ownerDocument: FakeDocument, readonly tagName: string) {}
  appendChild(child: FakeNode) { child.parentNode?.children.splice(child.parentNode.children.indexOf(child), 1); child.parentNode = this; this.children.push(child); return child; }
  append(...children: FakeNode[]) { for (const child of children) this.appendChild(child); }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  get lastChild(): FakeNode | null { return this.children.at(-1) ?? null; }
  get isConnected(): boolean { return this.tagName === 'overlay' || (this.parentNode?.isConnected ?? false); }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.children = []; this.ownText = value; }
  all(): FakeNode[] { return [this, ...this.children.flatMap(child => child.all())]; }
  find(className: string): FakeNode[] { return this.all().filter(node => node.className.split(' ').includes(className)); }
}
class FakeDocument {
  createElement(tag: string) { return new FakeNode(this, tag); }
  createElementNS(_ns: string, tag: string) { return new FakeNode(this, tag); }
  createTextNode(text: string) { const node = new FakeNode(this, '#text'); node.ownText = text; return node; }
}

function stage() {
  const site: FishingPierSite = { version: 1, id: 'pier:lake', root: [0, 1, 0], turn: 0, deckY: 1.4, waterY: .5, walk: 6, water: 'lake', biome: 'meadow', depth: [0, 1, 2] };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, .1, 200);
  camera.position.set(0, 6, 2); camera.lookAt(0, .5, 14); camera.updateMatrixWorld();
  const overlay = new FakeDocument().createElement('overlay');
  const geometries: THREE.BufferGeometry[] = [];
  const portrait = vi.fn(async () => true);
  const lines = mountChatLines({ scene, camera, site, overlay: overlay as unknown as HTMLElement, viewport: () => ({ width: 1920, height: 1080 }), kingdomName: 'Willowmere', compact: false,
    hour: () => 20, portrait, mesh: async () => { const geometry = new THREE.BoxGeometry(.2, .4, .2); geometries.push(geometry); return geometry; } });
  return { site, scene, overlay, lines, geometries, portrait };
}
const chatLine = (id: string, name: string | null, phase: PierFeedLine['phase'], x: number): PierFeedLine =>
  ({ id, who: who(name), via: 'chat', phase, float: [x, .5, 14], at: 1 });

describe('chat lines in the world and on the overlay', () => {
  it('floats a light per line, names the named, tells the catch and the legend, and puts everything away', async () => {
    const { scene, overlay, lines, geometries, portrait } = stage();
    lines.update(100);
    lines.apply({ kind: 'lines', at: 1, cap: 8, lines: [chatLine('a', 'Juniper', 'float', -2), chatLine('b', null, 'float', 2)] });
    lines.apply({ kind: 'line', at: 2, line: chatLine('c', 'Wren', 'float', 0) });
    await new Promise(ready => setTimeout(ready, 0));
    lines.update(101);
    expect(scene.getObjectByName('pier-chat')).toBeDefined();
    expect(lines.stats()).toMatchObject({ floats: 3, names: 2 });
    expect(overlay.find('pier-chat-name').map(node => node.textContent).sort()).toEqual(['Juniper', 'Wren']);
    lines.apply({ kind: 'line', at: 3, line: chatLine('a', 'Juniper', 'fight', -2) });
    lines.update(102);
    lines.apply({ ...caught('Juniper', { kingdomFirst: true, keepsake: 1, id: 'a', float: [-2, .5, 14] }) });
    lines.apply({ kind: 'broken', at: 4, id: 'b', who: who(null), speciesId: 'fish:goldscale-emperor', float: [2, .5, 14] });
    lines.apply({ kind: 'full', at: 5, who: who('Pell'), cap: 8 });
    lines.apply({ kind: 'full', at: 6, who: who('Pell'), cap: 8 });
    for (let t = 102; t < 104; t += 1 / 30) lines.update(t);
    const cards = overlay.find('pier-chat-card');
    expect(cards.map(card => card.dataset.kind)).toEqual(['full', 'catch', 'legend']);
    const text = cards.map(card => card.textContent);
    expect(text[1]).toContain('Juniper caught a Copper Perch');
    expect(text[1]).toContain('First in Willowmere');
    expect(text[1]).toContain('Mount No. 1');
    expect(text[2]).toBe('The Goldscale Emperor broke a fisher’s lineOnly a walker could have held it.');
    expect(overlay.all().filter(node => node.attributes.get('class') === 'pier-chat-wax')).toHaveLength(1);
    await new Promise(ready => setTimeout(ready, 0));
    expect(portrait).toHaveBeenCalledWith('fish:copper-perch', expect.anything(), expect.any(Number));
    expect(lines.stats().floats).toBe(1);
    expect(overlay.find('pier-chat-name').map(node => node.textContent)).toEqual(['Wren']);
    lines.dispose();
    expect(scene.getObjectByName('pier-chat')).toBeUndefined();
    expect(overlay.children).toHaveLength(0);
    lines.apply({ kind: 'line', at: 9, line: chatLine('d', 'Late', 'float', 1) });
    lines.update(110);
    expect(overlay.children).toHaveLength(0);
    lines.dispose();
    expect(geometries.length).toBeGreaterThan(0);
  });

  it('disposes every geometry and material it made', async () => {
    const { lines, geometries } = stage();
    lines.apply({ kind: 'line', at: 1, line: chatLine('a', 'Juniper', 'float', 0) });
    lines.apply(caught('Juniper', { id: 'a', float: [0, .5, 14] }));
    await new Promise(ready => setTimeout(ready, 0));
    lines.update(1);
    const disposed = geometries.map(geometry => vi.spyOn(geometry, 'dispose'));
    lines.dispose();
    expect(geometries.length).toBeGreaterThanOrEqual(2);
    for (const spy of disposed) expect(spy).toHaveBeenCalled();
  });

  it('shows a walker catch as a card with no float', () => {
    const { overlay, lines } = stage();
    lines.update(0);
    lines.apply(caught('Aldous', { via: 'pier', float: null, id: 'w', who: who('Aldous', null) }));
    lines.update(.1);
    expect(lines.stats()).toMatchObject({ floats: 0, leaving: 0, cards: 1 });
    expect(overlay.find('pier-chat-card')[0]!.textContent).toContain('Aldous caught a Copper Perch');
    lines.dispose();
  });
});
