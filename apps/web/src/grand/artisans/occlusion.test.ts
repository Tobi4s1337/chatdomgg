import { describe, expect, it } from 'vitest';
import { cornerOcclusion, flipDiagonal, packOcclusion } from './occlusion';

describe('artisan bench corner occlusion', () => {
  it('darkens creases, treating two occupied sides as closed even with an empty corner', () => {
    expect(cornerOcclusion(false, false, false)).toBe(3);
    expect(cornerOcclusion(true, false, false)).toBe(2);
    expect(cornerOcclusion(true, false, true)).toBe(1);
    expect(cornerOcclusion(true, true, false)).toBe(0);
  });
  it('flips a saddle toward the less biased diagonal and preserves a flat face', () => {
    expect(flipDiagonal(packOcclusion(3, 0, 3, 0))).toBe(true);
    expect(flipDiagonal(packOcclusion(0, 3, 0, 3))).toBe(false);
    expect(flipDiagonal(packOcclusion(3, 3, 3, 3))).toBe(false);
  });
});
