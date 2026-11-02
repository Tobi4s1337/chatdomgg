import { describe, expect, it } from 'vitest';
import { FORGE_CERTIFICATE_ANSWERS, FORGE_CERTIFICATE_CHOICES, forgeCertificateOrder, forgeCertificateTiles, gradeForgeCertificate,
  readForgeCertificateAnswers } from './protocol';

describe('blind kit certification protocol', () => {
  it('covers every motif and finish once, rotating mountings', () => {
    const tiles = forgeCertificateTiles();
    expect(tiles).toHaveLength(21);
    expect(new Set(tiles.map(tile => `${tile.motif}/${tile.finish}`)).size).toBe(21);
    expect(new Set(tiles.map(tile => tile.kind)).size).toBe(3);
  });
  it('shuffles deterministically per family and round', () => {
    const a = forgeCertificateOrder('hearth', 1, 21), b = forgeCertificateOrder('hearth', 1, 21), c = forgeCertificateOrder('hearth', 2, 21);
    expect(a).toEqual(b); expect(a).not.toEqual(c);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 21 }, (_, index) => index));
  });
  it('mixes every true answer with near neighbours', () => {
    for (const answer of Object.values(FORGE_CERTIFICATE_ANSWERS)) expect(FORGE_CERTIFICATE_CHOICES).toContain(answer);
    expect(FORGE_CERTIFICATE_CHOICES).toEqual(expect.arrayContaining(['bird', 'lizard', 'heart', 'daisy', 'unclear']));
  });
  it('parses strictly: every tile once, allowed words only', () => {
    const ok = JSON.stringify({ tiles: [{ tile: 2, subject: 'owl' }, { tile: 1, subject: 'moon' }] });
    expect(readForgeCertificateAnswers(ok, 2)).toEqual(['moon', 'owl']);
    expect(readForgeCertificateAnswers(JSON.stringify({ tiles: [{ tile: 1, subject: 'moon' }, { tile: 1, subject: 'owl' }] }), 2)).toBeUndefined();
    expect(readForgeCertificateAnswers(JSON.stringify({ tiles: [{ tile: 1, subject: 'moon' }, { tile: 2, subject: 'griffin' }] }), 2)).toBeUndefined();
    expect(readForgeCertificateAnswers('not json', 2)).toBeUndefined();
  });
  it('grades three blind rounds: three reads, two weak, fewer unread', () => {
    expect(gradeForgeCertificate(3)).toBe('reads');
    expect(gradeForgeCertificate(2)).toBe('weak');
    expect(gradeForgeCertificate(1)).toBe('unread');
    expect(() => gradeForgeCertificate(4)).toThrow();
  });
});
