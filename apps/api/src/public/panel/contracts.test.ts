import { describe, expect, it } from 'vitest';
import { readPanelReading, type PanelCardWire, type PanelReading } from './contracts';

const KINGDOM = { name: 'Lanternmere', tier: 'hamlet', motto: 'One home lit by chat, of 12', walk: 'https://chatdom.io/?walk=1&kingdom=1001' } as const;
const CARD: PanelCardWire = {
  name: 'Wren', colour: '#8a2be2', standing: 'Citizen of Lanternmere', following: null, subscribed: null,
  home: { name: 'Number 5', tier: 'cottage' }, elsewhere: [{ kingdom: 'Millbrook', home: 'Number 2, Mill Lane' }],
};
const HOME = { street: 'Lantern Row', place: 'Number 5 on Lantern Row, in the 2026 quarter', description: 'A cottage of warm timber.', since: '1 Nov 2026' };
const reading = (viewer: unknown, kingdom: unknown = KINGDOM) => ({ version: 1, kingdom, viewer });
/** Round-trips through JSON, as every reading does on its way to the panel. */
const wire = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
/** A copy of `value` with one key left out. */
const without = (value: object, key: string) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

describe('readPanelReading', () => {
  it('accepts every viewer the backend can answer with', () => {
    const viewers: PanelReading['viewer'][] = [
      { kind: 'anonymous' },
      { kind: 'unshared' },
      { kind: 'unknown', reason: 'Twitch has not told us your name just now. Try again in a moment.' },
      { kind: 'citizen', card: CARD, home: HOME },
      { kind: 'guest', card: { ...CARD, standing: 'Guest of Lanternmere', home: null } },
      { kind: 'newcomer', card: { ...CARD, standing: 'Welcome to Lanternmere', colour: null, home: null, elsewhere: [] } },
      { kind: 'monarch', card: { ...CARD, standing: 'Monarch of Lanternmere', home: { name: 'The castle', tier: null } } },
    ];
    for (const viewer of viewers) {
      const value = reading(viewer);
      expect(readPanelReading(wire(value)), viewer.kind).toEqual(value);
    }
  });

  it('accepts a channel with no kingdom yet', () => {
    const value = reading({ kind: 'unknown', reason: 'This channel has no kingdom yet.' }, null);
    expect(readPanelReading(wire(value))).toEqual(value);
  });

  it('accepts a town, and a loopback walk address for local checks', () => {
    expect(readPanelReading(reading({ kind: 'anonymous' }, { ...KINGDOM, tier: 'town' }))?.kingdom?.tier).toBe('town');
    expect(readPanelReading(reading({ kind: 'anonymous' }, { ...KINGDOM, walk: 'http://localhost:5175/?walk=1&kingdom=1001' }))).not.toBeNull();
    expect(readPanelReading(reading({ kind: 'anonymous' }, { ...KINGDOM, walk: 'http://127.0.0.1:5175/?walk=1&kingdom=1001' }))).not.toBeNull();
  });

  it('refuses anything that is not a version 1 reading', () => {
    for (const value of [null, undefined, 'reading', 1, [], [reading({ kind: 'anonymous' })]]) expect(readPanelReading(value)).toBeNull();
    expect(readPanelReading({ ...reading({ kind: 'anonymous' }), version: 2 })).toBeNull();
    expect(readPanelReading({ ...reading({ kind: 'anonymous' }), version: '1' })).toBeNull();
    expect(readPanelReading({ kingdom: KINGDOM, viewer: { kind: 'anonymous' } })).toBeNull();
  });

  it('refuses extra keys at every level', () => {
    expect(readPanelReading({ ...reading({ kind: 'anonymous' }), token: 'abc' })).toBeNull();
    expect(readPanelReading(reading({ kind: 'anonymous' }, { ...KINGDOM, id: '1001' }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'anonymous', opaqueId: 'U123' }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'unshared', personId: '2002' }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'unknown', reason: 'Not now.', detail: 'x' }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'newcomer', card: CARD, home: HOME }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'citizen', card: { ...CARD, userId: '2002' }, home: HOME }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'citizen', card: { ...CARD, home: { ...CARD.home, id: 7 } }, home: HOME }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'citizen', card: { ...CARD, elsewhere: [{ ...CARD.elsewhere[0], kingdomId: '3003' }] }, home: HOME }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'citizen', card: CARD, home: { ...HOME, plot: 4 } }))).toBeNull();
  });

  it('refuses missing keys and unknown viewer kinds', () => {
    expect(readPanelReading(reading({ kind: 'anonymous' }, without(KINGDOM, 'motto')))).toBeNull();
    expect(readPanelReading(reading({ kind: 'guest', card: without(CARD, 'elsewhere') }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'citizen', card: CARD }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'monarch' }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'moderator', card: CARD }))).toBeNull();
    expect(readPanelReading(reading(null))).toBeNull();
  });

  it('refuses a walk address that is not https, or not a URL at all', () => {
    for (const walk of [
      'http://chatdom.io/?walk=1', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://chatdom.io/', '/?walk=1&kingdom=1001', 'chatdom.io',
      `https://chatdom.io/${'a'.repeat(300)}`, 42,
    ]) expect(readPanelReading(reading({ kind: 'anonymous' }, { ...KINGDOM, walk })), String(walk)).toBeNull();
  });

  it('refuses a kingdom with an unknown tier, or a name or motto out of bounds', () => {
    expect(readPanelReading(reading({ kind: 'anonymous' }, { ...KINGDOM, tier: 'city' }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'anonymous' }, { ...KINGDOM, name: '' }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'anonymous' }, { ...KINGDOM, name: '   ' }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'anonymous' }, { ...KINGDOM, name: 'x'.repeat(81) }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'anonymous' }, { ...KINGDOM, motto: 'x'.repeat(121) }))).toBeNull();
  });

  it('refuses text carrying control or direction-override characters', () => {
    expect(readPanelReading(reading({ kind: 'anonymous' }, { ...KINGDOM, name: 'Lantern‮mere' }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'newcomer', card: { ...CARD, name: 'Wren\u0007' } }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'newcomer', card: { ...CARD, standing: 'Citizen⁦ of' } }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'citizen', card: CARD, home: { ...HOME, street: 'Lantern\nRow' } }))).toBeNull();
  });

  it('refuses a card that claims what no authority witnessed, or says too much', () => {
    expect(readPanelReading(reading({ kind: 'newcomer', card: { ...CARD, following: '2024-01-01' } }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'newcomer', card: { ...CARD, subscribed: 3 } }))).toBeNull();
    for (const colour of ['#8A2BE2', '8a2be2', '#8a2be', 'purple', '']) {
      expect(readPanelReading(reading({ kind: 'newcomer', card: { ...CARD, colour } })), colour).toBeNull();
    }
    expect(readPanelReading(reading({ kind: 'newcomer', card: { ...CARD, home: { name: 'Number 5', tier: 'palace' } } }))).toBeNull();
    const four = Array.from({ length: 4 }, (_, index) => ({ kingdom: `Kingdom ${index}`, home: `Number ${index + 1}, High Street` }));
    expect(readPanelReading(reading({ kind: 'newcomer', card: { ...CARD, elsewhere: four } }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'newcomer', card: { ...CARD, elsewhere: [{ kingdom: '', home: 'Number 1' }] } }))).toBeNull();
  });

  it('refuses a citizen whose card has no home, or whose home is incomplete', () => {
    expect(readPanelReading(reading({ kind: 'citizen', card: { ...CARD, home: null }, home: HOME }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'citizen', card: CARD, home: without(HOME, 'since') }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'citizen', card: CARD, home: { ...HOME, description: 'x'.repeat(401) } }))).toBeNull();
    expect(readPanelReading(reading({ kind: 'citizen', card: CARD, home: null }))).toBeNull();
  });
});
