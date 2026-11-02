import { describe, expect, it } from 'vitest';
import families from './families-1.json';
import catalogue from './realm-names-1.json';
import { familyLabel, landLabel, REALM_NAMES, realmDisplayName } from './realm-labels';
import { CROSSROADS_NAME, ISLES_NAME, OUTER_NAME, WILDS_NAME } from '../preview/schema';
import { currentTaxonomy } from './taxonomy';
import { realmName } from '../preview/build';

describe('realm names outside the frozen land', () => {
  it('is a proposal naming every family of families-1 and every fixed land', () => {
    expect(catalogue.review).toEqual({ status: 'proposed', proposedAt: '2026-11-02', reviewedBy: null, reviewedAt: null });
    expect(REALM_NAMES.taxonomies).toEqual(['families-1']);
    expect(Object.keys(REALM_NAMES.families).sort()).toEqual(families.families.map(f => f.id).sort());
    expect(Object.keys(REALM_NAMES.lands).sort()).toEqual(['crossroads', 'isles', 'outer', 'wilds']);
  });

  it('labels today exactly as the drawn world does, so adopting the table changes no word on the map', () => {
    const taxonomy = currentTaxonomy();
    taxonomy.taxonomy.families.forEach((family, index) => {
      expect(familyLabel('families-1', family.id)).toBe(realmName({ kind: 'family', family: index }, taxonomy, 'en'));
    });
    expect([landLabel('crossroads'), landLabel('wilds'), landLabel('isles'), landLabel('outer')]).toEqual([CROSSROADS_NAME, WILDS_NAME, ISLES_NAME, OUTER_NAME]);
  });

  it('renames by id and kind, and leaves a world of another taxonomy with its own recorded words', () => {
    const table = { ...REALM_NAMES, families: { ...REALM_NAMES.families, shooters: { label: 'The Gunpowder Marches' } }, lands: { ...REALM_NAMES.lands, wilds: { label: 'The Untamed' } } };
    const world = { taxonomy: { id: 'families-1' }, families: [{ id: 'just-chatting' }, { id: 'shooters' }] };
    expect(realmDisplayName({ kind: 'family', family: 1, name: 'Shooters' }, world, table)).toBe('The Gunpowder Marches');
    expect(realmDisplayName({ kind: 'family', family: 0, name: 'Recorded' }, world, table)).toBe('Just Chatting & IRL');
    expect(realmDisplayName({ kind: 'wilds', family: -1, name: 'The Wilds' }, world, table)).toBe('The Untamed');
    expect(realmDisplayName({ kind: 'isle', family: -1, name: 'Ukrainian' }, world, table)).toBe('Ukrainian');
    const later = { taxonomy: { id: 'families-2' }, families: [{ id: 'shooters' }] };
    expect(realmDisplayName({ kind: 'family', family: 0, name: 'Shooters & Tactics' }, later, table)).toBe('Shooters & Tactics');
    expect(realmDisplayName({ kind: 'family', family: 9, name: 'Recorded' }, world, table)).toBe('Recorded');
    expect(familyLabel('families-1', 'constructor')).toBeNull();
  });
});
