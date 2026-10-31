import { describe, expect, it } from 'vitest';
import type { LiveSource, LiveStatus } from '../live/feed';
import { liveLine, type LiveSummary } from './live-line';


const AS_OF = 1_793_325_387_307;

const source = (state: LiveSource['state'], sweepAt: number | null = AS_OF): LiveSource => ({
  state, checkedAt: sweepAt, sweepAt, completeAt: state === 'complete' ? sweepAt : null, gapBefore: false,
});

function summary(status: Partial<LiveStatus>, holdings = 1_234, dabs = 56): LiveSummary {
  return {
    status: { freshness: 'none', frameAsOf: null, source: null, transport: 'polling', refused: null, ...status },
    holdings,
    dabs,
  };
}

describe('liveLine', () => {
  it('states the observation time and the counts for a fresh frame', () => {
    const line = liveLine(summary({ freshness: 'fresh', frameAsOf: AS_OF, source: source('complete') }));
    expect(line.tone).toBe('fresh');
    expect(line.text).toContain('Live as of');
    expect(line.text).toContain('1,234 holdings');
    expect(line.text).toContain('56 small streams on air');
  });

  it('holds a stale frame at its own time, says the surveyors are late and drops the counts', () => {
    const line = liveLine(summary({ freshness: 'stale', frameAsOf: AS_OF, source: source('complete') }));
    expect(line.tone).toBe('held');
    expect(line.text).toContain('Live as of');
    expect(line.text).toContain('late');
    expect(line.text).not.toContain('holdings');
    expect(line.text).not.toContain('1,234');
  });

  it('blames the device clock for a frame observed in the future', () => {
    const line = liveLine(summary({ freshness: 'clock-skew', frameAsOf: AS_OF, source: source('complete') }));
    expect(line.tone).toBe('held');
    expect(line.text).toContain('Live as of');
    expect(line.text).toContain('clock disagrees');
    expect(line.text).not.toContain('holdings');
  });

  it('says the map holds the last whole sweep when a newer sweep was incomplete', () => {
    const line = liveLine(summary({ freshness: 'fresh', frameAsOf: AS_OF, source: source('partial', AS_OF + 180_000) }));
    expect(line.tone).toBe('held');
    expect(line.text).toContain('Live as of');
    expect(line.text).toContain('incomplete');
    expect(line.text).toContain('last whole one');
    expect(line.text).not.toContain('holdings');
  });

  it('stays fresh when the incomplete sweep is not newer than the frame shown', () => {
    const line = liveLine(summary({ freshness: 'fresh', frameAsOf: AS_OF, source: source('partial', AS_OF) }));
    expect(line.tone).toBe('fresh');
    expect(line.text).toContain('1,234 holdings');
  });

  describe('before any frame', () => {
    it('says the live state could not be read when the pointer is unreachable or corrupt', () => {
      for (const refused of ['unreachable', 'corrupt'] as const) {
        const line = liveLine(summary({ refused }));
        expect(line.tone).toBe('quiet');
        expect(line.text).toBe('Who is on air could not be read just now.');
      }
    });

    it('says the paint is being redrawn when the frame belongs to another survey', () => {
      const line = liveLine(summary({ refused: 'alignment', source: source('complete') }));
      expect(line).toEqual({ tone: 'quiet', text: 'Live paint is being redrawn for this survey.' });
    });

    it('says no complete sweep has been observed when the source is not complete', () => {
      for (const state of ['partial', 'incoherent', 'empty', 'future', 'unavailable'] as const) {
        const line = liveLine(summary({ refused: state === 'partial' ? 'partial' : null, source: source(state) }));
        expect(line.tone).toBe('quiet');
        expect(line.text).toBe('No complete sweep of who is on air has been observed yet.');
      }
    });

    it('is still reading while nothing has been offered', () => {
      expect(liveLine(summary({}))).toEqual({ tone: 'quiet', text: 'Reading who is on air…' });
    });

    it('never shows counts or a time without a frame', () => {
      for (const refused of [null, 'alignment', 'partial', 'corrupt', 'unreachable'] as const) {
        const { text } = liveLine(summary({ refused, source: source('partial') }));
        expect(text).not.toContain('Live as of');
        expect(text).not.toContain('holdings');
      }
    });
  });
});
