import { expect, it } from 'vitest';
import { createSteppedTimers } from './stepped';

it('fires stepped timers in due order once the stage clock reaches them, and never a cleared one', () => {
  const timers = createSteppedTimers(1000), fired: string[] = [];
  timers.set(() => fired.push('b'), 300);
  const cleared = timers.set(() => fired.push('x'), 100);
  timers.set(() => { fired.push('a'); timers.set(() => fired.push('c'), 0); }, 200);
  timers.clear(cleared);
  timers.at(1150); expect(fired).toEqual([]);
  timers.at(1250); expect(fired).toEqual(['a', 'c']);
  timers.at(1200); timers.at(1300); expect(fired).toEqual(['a', 'c', 'b']);
});
