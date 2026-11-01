import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FORGE_MOTIFS } from '@chatdom/shared';
import { FW10_WISHES } from './fw10-wishes';

describe('the fixed, lane-authored FW10 wish set', () => {
  it('freezes the twenty texts and their metadata before tuning', () => {
    expect(FW10_WISHES.map(wish => wish.id)).toEqual(Array.from({ length: 20 }, (_, i) => `fw10-${String(i + 1).padStart(2, '0')}`));
    expect(createHash('sha256').update(JSON.stringify(FW10_WISHES)).digest('hex')).toBe('8af9aabc0946238c9326a06a6f45c1e006f5ebdbdb2c8cec643c40a2efe5d7c9');
    expect(new Set(FW10_WISHES.map(wish => wish.words)).size).toBe(20);
    expect(FW10_WISHES.every(wish => wish.words.trim().length > 0)).toBe(true);
  });
  it('covers every existing motif and the requested unsupported cases', () => {
    const known = FW10_WISHES.filter(wish => wish.category === 'known');
    const other = FW10_WISHES.filter(wish => wish.category !== 'known');
    expect(known).toHaveLength(10);
    expect(other).toHaveLength(10);
    expect(new Set(known.map(wish => wish.expectedMotif))).toEqual(new Set(FORGE_MOTIFS));
    expect(new Set(other.map(wish => wish.category))).toEqual(new Set(['creature', 'object', 'painting', 'pun', 'emote', 'language', 'overlong']));
    expect(FW10_WISHES.filter(wish => wish.words.length > 240).map(wish => wish.category)).toEqual(['overlong']);
  });
});
