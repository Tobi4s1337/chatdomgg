import { describe, expect, it, vi } from 'vitest';
import { FORGE_CERTIFICATE_DATA } from './data';
import { forgeCertificateGeometry, forgeMotifCertificate, forgeReadableFinishes, FORGE_CERTIFICATE_FAMILIES } from '.';

const TAMPERED = vi.hoisted(() => ({ kit: 'grove-native@2', entry: 'sleeping-fox/native' }));

// One stored grade is bound to geometry it was never shown: it must not certify anything.
vi.mock('./data', async importOriginal => {
  const actual = await importOriginal<typeof import('./data')>();
  const kits = structuredClone(actual.FORGE_CERTIFICATE_DATA.kits);
  kits[TAMPERED.kit]![TAMPERED.entry] = { ...kits[TAMPERED.kit]![TAMPERED.entry]!, geometry: '0000000000000000' };
  return { FORGE_CERTIFICATE_DATA: { ...actual.FORGE_CERTIFICATE_DATA, kits } };
});

describe('kit certificates are bound to the geometry that was shown', () => {
  it('every stored grade matches the current authored geometry; changed art must be certified again', () => {
    for (const family of FORGE_CERTIFICATE_FAMILIES) for (const revision of [1, 2]) {
      const kit = FORGE_CERTIFICATE_DATA.kits[`${family}-native@${revision}`]!;
      expect(Object.keys(kit)).toHaveLength(21);
      const geometry = forgeCertificateGeometry(family, revision);
      for (const [key, entry] of Object.entries(kit)) {
        if (`${family}-native@${revision}` === TAMPERED.kit && key === TAMPERED.entry) continue;
        expect(geometry.get(key), `${family}@${revision} ${key}`).toBe(entry.geometry);
      }
    }
  });

  it('a digest that does not match the geometry is uncertified, never its stored grade', () => {
    expect(FORGE_CERTIFICATE_DATA.kits[TAMPERED.kit]![TAMPERED.entry]!.correct).toBe(3);
    expect(forgeMotifCertificate('grove', 2, 'sleeping-fox', 'native')).toBe('uncertified');
    expect(forgeMotifCertificate('grove', 2, 'sleeping-fox', 'copper')).toBe('reads');
    expect(forgeReadableFinishes('grove', 2)['sleeping-fox']).toEqual(['ceramic', 'copper']);
  });

  it('revision two makes every motif readable in its native finish in every family', () => {
    for (const family of FORGE_CERTIFICATE_FAMILIES) for (const motif of ['sleeping-fox', 'shooting-star', 'scallop-shell']) {
      if (family === 'grove' && motif === 'sleeping-fox') continue;
      expect(forgeMotifCertificate(family, 2, motif, 'native'), `${family} ${motif}`).toBe('reads');
    }
    // Revision one stays as certified: the shipped fox does not read, so a fox wish there is honestly softened.
    expect(forgeMotifCertificate('hearth', 1, 'sleeping-fox', 'native')).toBe('unread');
  });
});
