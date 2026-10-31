import { describe, expect, it } from 'vitest';
import { BENCH_VIEWS, parseEmoteBench } from './params';

describe('parseEmoteBench', () => {
  it('reads an explicit view, hour and held frame', () => {
    expect(parseEmoteBench('?view=side&hour=9')).toEqual({ view: 'side', hour: 9, frame: null });
    expect(parseEmoteBench('?view=banner&hour=0&frame=3')).toEqual({ view: 'banner', hour: 0, frame: 3 });
  });
  it('reads the kingdom square as its own view', () => {
    expect(BENCH_VIEWS).toContain('kingdom');
    expect(parseEmoteBench('?view=kingdom&hour=18&frame=3')).toEqual({ view: 'kingdom', hour: 18, frame: 3 });
    expect(parseEmoteBench('?view=kingdom')).toEqual({ view: 'kingdom', hour: 16, frame: null });
  });
  it('falls back to the playing front view at four in the afternoon for anything it does not know', () => {
    expect(parseEmoteBench('')).toEqual({ view: 'front', hour: 16, frame: null });
    expect(parseEmoteBench('?view=back&hour=24&frame=120')).toEqual({ view: 'front', hour: 16, frame: null });
    expect(parseEmoteBench('?hour=7.5&view=SIDE&frame=-1')).toEqual({ view: 'front', hour: 16, frame: null });
    expect(parseEmoteBench('?view=Kingdom')).toEqual({ view: 'front', hour: 16, frame: null });
  });
});
