import { describe, expect, it } from 'vitest';
import { formatGrowthBeat } from './format';

describe('growth crier', () => {
  it('speaks only the public facts and preserves the witnessed evidence', () => {
    const home = { kind: 'home-grown', sourceSeq: 4, at: 100, plotId: 'secret-plot', from: 'tent', to: 'hut', qualifiedDays: 3 } as const;
    const civic = { kind: 'civic-levelled', sourceSeq: 4, at: 101, place: 'castle-court', from: 1, to: 2 } as const;
    const streak = { kind: 'streak-reached', sourceSeq: 5, at: 102, plotId: 'secret-plot', days: 1 } as const;
    expect(formatGrowthBeat(home, 'live')).toEqual({ origin: 'live', text: 'A home has grown from tent to hut.', evidence: home });
    expect(formatGrowthBeat(civic, 'live')).toEqual({ origin: 'live', text: 'The castle court has grown from level 1 to 2.', evidence: civic });
    expect(formatGrowthBeat(streak, 'simulated')).toEqual({ origin: 'simulated', text: 'SIMULATED: A citizen has reached a 1-day streak.', evidence: streak });
    expect([home, streak].map(beat => formatGrowthBeat(beat, 'live').text).join(' ')).not.toContain('secret-plot');
  });

  it('rejects a backwards or malformed beat rather than inventing a line', () => {
    expect(() => formatGrowthBeat({ kind: 'civic-levelled', sourceSeq: 1, at: 1, place: 'forge', from: 3, to: 2 }, 'live')).toThrow();
  });
});
