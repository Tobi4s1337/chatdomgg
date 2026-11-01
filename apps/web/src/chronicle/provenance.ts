import type { History, ReplayState } from './replay';

/** History and scene have independent provenance; neither can hide a simulated presentation. */
export function provenance(state: ReplayState, presentation: History['label'] | undefined, simulationNote = '') {
  const historySimulated = state.status !== 'unavailable' && state.label === 'SIMULATED';
  const sceneSimulated = presentation === 'SIMULATED';
  const origin = historySimulated ? 'SIMULATED · A local history'
    : state.status === 'ready' ? sceneSimulated ? 'Recorded history · SIMULATED scene' : 'Recorded history'
    : sceneSimulated ? 'SIMULATED · Scene' : '';
  return { origin, note: historySimulated || sceneSimulated ? simulationNote : '' };
}
