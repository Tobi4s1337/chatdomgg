import { describe, expect, it } from 'vitest';
import { parseEmoteBench } from './params';

describe('parseEmoteBench', () => {
  it('reads an explicit view and hour', () => {
    expect(parseEmoteBench('?view=side&hour=9')).toEqual({ view: 'side', hour: 9 });
    expect(parseEmoteBench('?view=banner&hour=0')).toEqual({ view: 'banner', hour: 0 });
  });
  it('falls back to the front view at four in the afternoon for anything it does not know', () => {
    expect(parseEmoteBench('')).toEqual({ view: 'front', hour: 16 });
    expect(parseEmoteBench('?view=back&hour=24')).toEqual({ view: 'front', hour: 16 });
    expect(parseEmoteBench('?hour=7.5&view=SIDE')).toEqual({ view: 'front', hour: 16 });
  });
});
