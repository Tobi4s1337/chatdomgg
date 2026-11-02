import { PORTRAIT_FIXTURES } from '@chatdom/content/avatar-style';
import { createStyledCitizenLook, type StyledCitizenLook } from '../citizens';

/**
 * The tallest worn silhouette, for loopback benches only: the reference realm can dress one of its own test
 * walkers in it so the seated framing is checked against a real pointed hat across the table. A room whose
 * origin is not the loopback reference never loads this module.
 */
export const BENCH_TALL_HAT_LOOK = 'bench-pointed-hat';

export function benchCitizenLooks(): readonly StyledCitizenLook[] {
  const fixture = PORTRAIT_FIXTURES.find(entry => entry.look.hat?.style === 'pointed-hat');
  if (!fixture) throw new Error('The pointed-hat portrait fixture is missing.');
  return [createStyledCitizenLook(BENCH_TALL_HAT_LOOK, fixture.look)];
}
