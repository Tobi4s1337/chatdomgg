import { describe, expect, it } from 'vitest';
import { CHAT_LANTERNS, chatWords, createChatLanterns } from './chat';

const KINGDOM = '41245072', AT = Date.UTC(2026, 10, 2, 21, 0, 0);
const cue = (id: string, text: string, overrides: Record<string, unknown> = {}) => ({ type: 'chat', cue: { version: 1, id, kingdomId: KINGDOM, epoch: 'e1',
  origin: 'live', slot: 4, asOf: AT - 100, expiresAt: AT + 8_000, parts: [{ kind: 'text', text }], ...overrides } });

function field(now = { t: AT }) {
  return { now, lanterns: createChatLanterns({ kingdomId: () => KINGDOM, origin: () => 'live', radius: 4, clock: () => now.t }) };
}

describe('chat lanterns', () => {
  it('raises a lantern for a live line, beyond the logs, and lets it fade', () => {
    const { lanterns, now } = field();
    lanterns.receive(cue('c1', 'is it the miller?'));
    const [first] = lanterns.sample(AT);
    expect(first).toMatchObject({ id: 'c1', words: 'is it the miller?', out: false });
    expect(first!.reach).toBeGreaterThan(4 + 1);
    expect(lanterns.sample(AT + 2_000)[0]!.glow).toBe(1);
    now.t = AT + CHAT_LANTERNS.lifeMs + 1;
    expect(lanterns.sample(now.t)).toHaveLength(0);
  });

  it('takes only valid, unexpired speech of this kingdom and origin, once', () => {
    const { lanterns } = field();
    lanterns.receive(cue('c1', 'hello'));
    lanterns.receive(cue('c1', 'hello'));
    lanterns.receive(cue('c2', 'elsewhere', { kingdomId: '999' }));
    lanterns.receive(cue('c3', 'rehearsal', { origin: 'simulated' }));
    lanterns.receive(cue('c4', 'late', { asOf: AT - 9_000, expiresAt: AT - 1 }));
    lanterns.receive(cue('c5', 'x', { parts: [] }));
    lanterns.receive({ type: 'seats' });
    lanterns.receive(null);
    let shown = 0;
    for (let t = AT; t < AT + 3_000; t += 100) shown = Math.max(shown, lanterns.sample(t).length);
    expect(shown).toBe(1);
  });

  it('puts a removed line and a cleared chat out at once, and never shows them again', () => {
    const { lanterns, now } = field();
    lanterns.receive(cue('c1', 'one')); lanterns.sample(AT);
    lanterns.receive(cue('c2', 'two')); lanterns.sample(AT + 400);
    lanterns.receive({ type: 'chat.remove', cueIds: ['c1', 'not a token!'] });
    const removed = lanterns.sample(AT + 450).find(l => l.id === 'c1')!;
    expect(removed.out).toBe(true);
    expect(lanterns.sample(AT + 450 + CHAT_LANTERNS.outMs + 1).map(l => l.id)).toEqual(['c2']);
    lanterns.receive(cue('c1', 'one'));
    now.t = AT + 2_000;
    lanterns.receive({ type: 'chat.clear' });
    expect(lanterns.sample(AT + 2_000 + CHAT_LANTERNS.outMs + 1)).toHaveLength(0);
  });

  it('stays bounded in a busy chat and keeps its newest lines', () => {
    const { lanterns, now } = field();
    let most = 0;
    for (let i = 0; i < 400; i++) {
      now.t = AT + i * 50;
      lanterns.receive(cue(`c${i}`, `line ${i}`, { asOf: now.t - 10, expiresAt: now.t + 8_000 }));
      most = Math.max(most, lanterns.sample(now.t).length);
    }
    expect(most).toBeLessThanOrEqual(CHAT_LANTERNS.capacity);
    // The newest lines wait their turn and rise; the older backlog was let go.
    const risen = new Set<string>();
    for (let t = now.t; t < now.t + CHAT_LANTERNS.lifeMs * 2; t += 100) for (const l of lanterns.sample(t)) risen.add(l.id);
    expect(risen.has('c399')).toBe(true);
    expect(risen.has('c390')).toBe(false);
  });

  it('reuses its samples rather than allocating each frame', () => {
    const { lanterns } = field();
    lanterns.receive(cue('c1', 'warm'));
    const a = lanterns.sample(AT), first = a[0];
    const b = lanterns.sample(AT + 16);
    expect(b).toBe(a);
    expect(b[0]).toBe(first);
  });

  it('carries the words on one line, emotes by name, cut kindly', () => {
    expect(chatWords({ parts: [{ kind: 'text', text: 'the  wolf\nis' }, { kind: 'emote', id: 'e1', alt: 'Kappa' }] })).toBe('the wolf is Kappa');
    const long = chatWords({ parts: [{ kind: 'text', text: 'word '.repeat(40) }] });
    expect(long.length).toBeLessThanOrEqual(CHAT_LANTERNS.words);
    expect(long.endsWith('…')).toBe(true);
  });
});
