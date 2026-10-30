import { describe, expect, it } from 'vitest';
import { CardContractError, parseCardDocument, type CardSource, type CitizenCardDocument } from './contracts';
import { projectCard } from './project';

const HERE = '491305829', ABROAD = '602118344', PERSON = '718203547';

function source(overrides: Partial<CardSource> = {}, document: Partial<CitizenCardDocument> = {}): CardSource {
  return {
    subjectFirstSignedInAt: Date.UTC(2026, 3, 2),
    travelsHidden: false,
    dependencies: [{ assetId: 'portrait.wren', revision: 3 }],
    ...overrides,
    document: {
      key: { personId: PERSON, kingdomId: HERE } as CitizenCardDocument['key'],
      kingdomName: 'Lanternmere',
      revision: { person: 4, citizen: 9 },
      origin: 'simulated',
      identity: { login: 'wren_quill', name: 'Wren_Quill', colour: '#2e8b57', office: 'moderator', portrait: { id: 'portrait.wren', revision: 3, alt: 'Wren in a short red cloak' } },
      tenure: { followedAt: Date.UTC(2022, 1, 14), subscribedMonths: 14, activeTier: 1 },
      citizenNumber: 212,
      address: { home: 'Lantern Cottage', street: 'Old Row' },
      homes: [
        { kingdomId: HERE, kingdomName: 'Lanternmere', home: 'Lantern Cottage', street: 'Old Row', image: null, path: null },
        { kingdomId: ABROAD, kingdomName: 'Saltmarsh', home: 'The Gull Loft', street: 'Harbour Steps', image: null, path: null },
      ] as unknown as CitizenCardDocument['homes'],
      castle: null,
      passport: { hidden: false, stamps: { availability: 'known', entries: [{ id: 'stamp.1', kind: 'raid', kingdomId: ABROAD, kingdomName: 'Saltmarsh', at: Date.UTC(2025, 6, 1), path: null }] as never, next: 'c1' } },
      pieces: { availability: 'known', entries: [], next: null },
      honours: { availability: 'unavailable' },
      house: null,
      ...document,
    },
  };
}

describe('projectCard', () => {
  it('keeps life elsewhere off the card until the subject has signed in, and drops hidden travels whole', () => {
    const before = projectCard(source({ subjectFirstSignedInAt: null }));
    expect(before.homes.map(home => home.kingdomName)).toEqual(['Lanternmere']);
    expect(before.passport).toEqual({ hidden: true });

    const after = projectCard(source());
    expect(after.homes).toHaveLength(2);
    expect(after.passport.hidden).toBe(false);

    const hidden = JSON.stringify(projectCard(source({ travelsHidden: true })));
    expect(hidden).not.toMatch(/Saltmarsh.*stamp|stamp\.1|"next":"c1"|Harbour Steps.*raid/);
    expect(hidden).toContain('"passport":{"hidden":true}');
    // The homes stay; only the passport hides (World-Tree rule 9).
    expect(hidden).toContain('The Gull Loft');
  });

  it('never releases source-only fields, and rejects corrupt homes instead of choosing by order', () => {
    const projected = projectCard(source());
    expect(Object.keys(projected)).not.toContain('travelsHidden');
    expect(JSON.stringify(projected)).not.toContain('dependencies');
    const extra = { ...source(), secret: true } as unknown as CardSource;
    expect(() => projectCard(extra)).toThrow(CardContractError);
    const twice = source({}, { homes: [...source().document.homes, { ...source().document.homes[1]! }] });
    expect(() => projectCard(twice)).toThrow(/two homes in one kingdom/);
  });

  it('reads unknown as unknown and keeps text plain', () => {
    const unknown = parseCardDocument({ ...source().document, tenure: { followedAt: null, subscribedMonths: null, activeTier: null } });
    expect(unknown.tenure).toEqual({ followedAt: null, subscribedMonths: null, activeTier: null });
    expect(() => parseCardDocument({ ...source().document, identity: { ...source().document.identity, name: 'Wren‮evil' } })).toThrow(/direction/);
    expect(() => parseCardDocument({ ...source().document, homes: [{ ...source().document.homes[0]!, path: '//evil.example/x' }] })).toThrow(/same-origin/);
  });
});
