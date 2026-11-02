import { describe, expect, it } from 'vitest';
import { provenanceFromSource, provenanceLines, PROVENANCE_WORDS, type Provenance } from './provenance';

describe('provenanceFromSource', () => {
  it('maps exactly the kingdom scene’s source words', () => {
    expect(provenanceFromSource('SIMULATED')).toBe('simulated');
    expect(provenanceFromSource('CONNECTING')).toBe('connecting');
    expect(provenanceFromSource('LIVE CHAT')).toBe('live');
    expect(provenanceFromSource('STREAM RESTING')).toBe('resting');
    expect(provenanceFromSource('CONNECTION LOST')).toBe('lost');
  });

  it('fails closed: nothing unknown or merely similar ever reads as live or simulated', () => {
    for (const source of ['', 'LIVE', 'live chat', ' LIVE CHAT', 'LIVE CHAT ', 'Live Chat', 'FRESH', 'simulated', 'SIMULATED ', 'toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(provenanceFromSource(source), JSON.stringify(source)).toBe('lost');
    }
  });

  it('round-trips every real feed through its pressed word, so existing readers of the label stay true', () => {
    for (const state of ['connecting', 'live', 'resting', 'lost'] as const) expect(provenanceFromSource(PROVENANCE_WORDS[state])).toBe(state);
  });

  it('accepts the staged source word as input but has no word of its own to press for it', () => {
    expect(PROVENANCE_WORDS.simulated).toBe('');
    expect(Object.keys(PROVENANCE_WORDS).sort()).toEqual(['connecting', 'live', 'lost', 'resting', 'simulated']);
  });
});

describe('provenanceLines', () => {
  it('a staged night without an owner detail has no line at all, even when practice content is marked', () => {
    expect(provenanceLines({ state: 'simulated' })).toEqual([]);
    expect(provenanceLines({ state: 'simulated', simulated: true })).toEqual([]);
    expect(provenanceLines({ state: 'simulated', detail: '   ' })).toEqual([]);
  });

  it('a staged night with an owner detail is one line whose word is that detail', () => {
    expect(provenanceLines({ state: 'simulated', detail: 'an illustrative passport' })).toEqual([{ seal: 'simulated', word: 'an illustrative passport' }]);
    expect(provenanceLines({ state: 'simulated', simulated: true, detail: ' practice night ' })).toEqual([{ seal: 'simulated', word: 'practice night' }]);
  });

  it('practice content under a real feed adds no line; the owner detail becomes the feed note', () => {
    expect(provenanceLines({ state: 'live', simulated: true })).toEqual([{ seal: 'live', word: 'LIVE CHAT' }]);
    expect(provenanceLines({ state: 'live', simulated: true, detail: 'practice Forge' })).toEqual([{ seal: 'live', word: 'LIVE CHAT', note: 'practice Forge' }]);
  });

  it('a lost, resting or connecting feed is never hidden behind practice content', () => {
    for (const state of ['lost', 'resting', 'connecting'] as const) {
      expect(provenanceLines({ state, simulated: true, detail: 'practice home' })).toEqual([{ seal: state, word: PROVENANCE_WORDS[state], note: 'practice home' }]);
      expect(provenanceLines({ state, simulated: true })).toEqual([{ seal: state, word: PROVENANCE_WORDS[state] }]);
    }
  });

  it('real feeds keep exactly their words', () => {
    expect(provenanceLines({ state: 'connecting' })).toEqual([{ seal: 'connecting', word: 'CONNECTING' }]);
    expect(provenanceLines({ state: 'live' })).toEqual([{ seal: 'live', word: 'LIVE CHAT' }]);
    expect(provenanceLines({ state: 'resting' })).toEqual([{ seal: 'resting', word: 'STREAM RESTING' }]);
    expect(provenanceLines({ state: 'lost' })).toEqual([{ seal: 'lost', word: 'CONNECTION LOST' }]);
  });

  it('an owner’s detail adds a note but can never replace a real feed’s word', () => {
    expect(provenanceLines({ state: 'lost', detail: 'LIVE CHAT' })).toEqual([{ seal: 'lost', word: 'CONNECTION LOST', note: 'LIVE CHAT' }]);
    expect(provenanceLines({ state: 'live', detail: '   ' })).toEqual([{ seal: 'live', word: 'LIVE CHAT' }]);
  });

  it('no state or combination of facts ever presses the staged source word', () => {
    for (const state of Object.keys(PROVENANCE_WORDS) as Provenance[]) {
      for (const simulated of [false, true]) {
        for (const detail of [undefined, 'a note']) {
          const lines = provenanceLines({ state, simulated, ...(detail ? { detail } : {}) });
          expect(lines.some(line => `${line.word} ${line.note ?? ''}`.includes('SIMULATED'))).toBe(false);
        }
      }
    }
  });
});
