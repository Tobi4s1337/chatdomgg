import { connectHelper } from '../helper';
import type { PanelAdapter } from '../model';
import { createFixtureAdapter, fixtureState } from './fixture';
import { BACKEND_ORIGIN, createProductionAdapter } from './production';

/**
 * Fixtures only by an explicit `source=simulated`. Twitch adds its own `state=`
 * (released, testing…) to every view, so `state` is read only inside the fixture,
 * where unknown values fall back to its default case. A real panel that cannot
 * reach its kingdom stays unavailable; it never falls back to the fixture.
 */
export function selectAdapter(search: string = location.search): PanelAdapter {
  const query = new URLSearchParams(search);
  if (query.get('source') === 'simulated') return createFixtureAdapter(fixtureState(query.get('state')));
  return createProductionAdapter(connectHelper(), { backend: BACKEND_ORIGIN });
}
