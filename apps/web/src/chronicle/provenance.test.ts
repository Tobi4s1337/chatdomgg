import { describe, expect, it } from 'vitest';
import { provenance } from './provenance';
import type { ReplayState } from './replay';

describe('Chronicle provenance', () => {
  const ready = (label: 'LIVE' | 'SIMULATED') => ({ status: 'ready', label, index: 0, count: 1, snapshot: {} as never, playing: false }) satisfies ReplayState;
  it('labels a simulated scene even when the history is recorded', () => {
    expect(provenance(ready('LIVE'), 'SIMULATED', 'Local scene')).toEqual({ origin: 'Recorded history · SIMULATED scene', note: 'Local scene' });
    expect(provenance(ready('LIVE'), 'LIVE', 'Local scene')).toEqual({ origin: 'Recorded history', note: '' });
    expect(provenance(ready('SIMULATED'), 'LIVE', 'Local record')).toEqual({ origin: 'SIMULATED · A local history', note: 'Local record' });
  });
  it('retains visible simulation provenance in empty and unavailable states', () => {
    expect(provenance({ status: 'empty', label: 'SIMULATED', playing: false }, undefined, 'Local record').origin).toContain('SIMULATED');
    expect(provenance({ status: 'unavailable', playing: false }, 'SIMULATED', 'Local scene')).toEqual({ origin: 'SIMULATED · Scene', note: 'Local scene' });
    expect(provenance({ status: 'unavailable', playing: false }, 'LIVE', 'Local scene')).toEqual({ origin: '', note: '' });
  });
});
