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

  it('round-trips through the pressed words, so existing readers of the label stay true', () => {
    for (const state of Object.keys(PROVENANCE_WORDS) as Provenance[]) expect(provenanceFromSource(PROVENANCE_WORDS[state])).toBe(state);
  });
});

describe('provenanceLines', () => {
  it('a simulated night is one line that says SIMULATED, even when the owner also marks practice content', () => {
    expect(provenanceLines({ state: 'simulated' })).toEqual([{ seal: 'simulated', word: 'SIMULATED' }]);
    expect(provenanceLines({ state: 'simulated', simulated: true, detail: 'practice night' })).toEqual([{ seal: 'simulated', word: 'SIMULATED', note: 'practice night' }]);
  });

  it('practice content under a real feed keeps both facts, the feed first', () => {
    expect(provenanceLines({ state: 'live', simulated: true })).toEqual([
      { seal: 'live', word: 'LIVE CHAT' },
      { seal: 'simulated', word: 'SIMULATED', note: 'practice, not chat' },
    ]);
    expect(provenanceLines({ state: 'live', simulated: true, detail: 'practice Forge' }).map(line => line.word)).toEqual(['LIVE CHAT', 'SIMULATED']);
  });

  it('a lost, resting or connecting feed is never hidden behind practice content', () => {
    for (const state of ['lost', 'resting', 'connecting'] as const) {
      const lines = provenanceLines({ state, simulated: true, detail: 'practice home' });
      expect(lines[0]).toEqual({ seal: state, word: PROVENANCE_WORDS[state] });
      expect(lines[1]).toEqual({ seal: 'simulated', word: 'SIMULATED', note: 'practice home' });
    }
  });

  it('an owner’s detail adds a note but can never replace the word', () => {
    expect(provenanceLines({ state: 'lost', detail: 'LIVE CHAT' })).toEqual([{ seal: 'lost', word: 'CONNECTION LOST', note: 'LIVE CHAT' }]);
    expect(provenanceLines({ state: 'live', detail: '   ' })).toEqual([{ seal: 'live', word: 'LIVE CHAT' }]);
  });

  it('a real feed without practice content never mentions simulation', () => {
    for (const state of ['live', 'resting', 'lost', 'connecting'] as const) {
      expect(provenanceLines({ state }).some(line => line.word.includes('SIMULATED'))).toBe(false);
    }
  });
});
