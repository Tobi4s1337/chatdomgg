import { describe, expect, it } from 'vitest';
import type { InlineEmoteVisual } from '../../../../packages/emotes/src/index';
import { createInlineEmoteImages } from './inline-images';

const visual = (revision: string): InlineEmoteVisual => ({ id: 'twitch.simtoadwave1', revision, origin: 'simulated', alt: 'toadWave', mediaType: 'image/gif', bytes: new Uint8Array([71, 73, 70, 56]) });

describe('Inline emote images', () => {
  it('makes one object URL per verified revision, shares it, and revokes it when the last user lets go', () => {
    const made: Blob[] = [], revoked: string[] = [];
    const images = createInlineEmoteImages({ createObjectURL: blob => { made.push(blob); return `blob:test/${made.length}`; }, revokeObjectURL: url => { revoked.push(url); } });
    const a = visual('a'.repeat(64)), b = visual('b'.repeat(64));
    expect(images.acquire(a)).toBe('blob:test/1');
    expect(images.acquire({ ...a, bytes: a.bytes.slice() })).toBe('blob:test/1');
    expect(images.acquire(b)).toBe('blob:test/2');
    expect(made.map(blob => blob.type)).toEqual(['image/gif', 'image/gif']);
    images.release(a);
    expect(revoked).toEqual([]);
    images.release(a);
    expect(revoked).toEqual(['blob:test/1']);
    expect(images.size).toBe(1);
    images.release(a);
    expect(revoked).toEqual(['blob:test/1']);
    images.dispose();
    expect(revoked).toEqual(['blob:test/1', 'blob:test/2']);
    expect(images.size).toBe(0);
  });

  it('copies the bytes, so a later change to the caller buffer cannot alter the drawn image', async () => {
    let captured: Blob | undefined;
    const images = createInlineEmoteImages({ createObjectURL: blob => { captured = blob; return 'blob:test/x'; }, revokeObjectURL: () => {} });
    const source = visual('c'.repeat(64));
    images.acquire(source);
    source.bytes[0] = 0;
    expect(new Uint8Array(await captured!.arrayBuffer())[0]).toBe(71);
  });
});
