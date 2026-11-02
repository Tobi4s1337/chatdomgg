import { describe, expect, it } from 'vitest';
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import type { GateSnapshot, JourneySnapshot } from './controller';
import type { WelcomeSnapshot } from './welcome';
import { mayTravel, walkOrigin } from './walk-gate';

const quiet = { joined: false, canTravel: false, journey: null, welcome: null } as Pick<GateSnapshot, 'joined' | 'canTravel' | 'journey' | 'welcome'>;
const as = (extra: Partial<GateSnapshot>) => ({ ...quiet, ...extra }) as GateSnapshot;

describe('the walk warms the map only for someone who may travel', () => {
  it('leaves the map unloaded for a walker who only watches the gate', () => {
    expect(mayTravel(as({}))).toBe(false);
  });

  it('warms it once they chose to march, may follow the party, are under way or stand abroad', () => {
    expect(mayTravel(as({ joined: true }))).toBe(true);
    expect(mayTravel(as({ canTravel: true }))).toBe(true);
    expect(mayTravel(as({ journey: { kind: 'return', to: '7' as KingdomId } as JourneySnapshot }))).toBe(true);
    expect(mayTravel(as({ welcome: {} as WelcomeSnapshot }))).toBe(true);
  });
});

describe('the walk’s origin', () => {
  it('is simulated only on the lane’s mock stack', () => {
    expect(walkOrigin('?walk=1&kingdom=7&source=simulated')).toBe('simulated');
    expect(walkOrigin('?walk=1&kingdom=7')).toBe('live');
    expect(walkOrigin('?source=live')).toBe('live');
  });
});
