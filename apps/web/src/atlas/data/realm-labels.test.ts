// @vitest-environment node
import { expect, it } from 'vitest';
import { REALM_NAMES } from '../../../../surveyor/src/cartography/realm-labels';
import { makeWorld } from './fixtures.test-support';
import { geographyOf, labelWorld, realmWord } from './model';

it('names family realms and fixed lands from the realm table without touching frozen geography', () => {
  const world = makeWorld();
  const snapshot = structuredClone(world);
  const family = world.realms.findIndex(realm => realm.kind === 'family');
  const fixed = world.realms.findIndex(realm => realm.kind === 'crossroads' || realm.kind === 'wilds');
  expect(family).toBeGreaterThanOrEqual(0);
  expect(fixed).toBeGreaterThanOrEqual(0);
  const familyId = world.families[world.realms[family]!.family]!.id;
  const kind = world.realms[fixed]!.kind as 'crossroads' | 'wilds';
  const table = {
    ...REALM_NAMES,
    taxonomies: [world.taxonomy.id],
    families: { ...REALM_NAMES.families, [familyId]: { label: 'The Renamed Realm' } },
    lands: { ...REALM_NAMES.lands, [kind]: { label: 'The Renamed Land' }, outer: { label: 'The Far Isles' } },
  };
  const named = labelWorld(world, undefined, table);
  expect(named.realms[family]!.name).toBe('The Renamed Realm');
  expect(named.families[world.realms[family]!.family]!.name).toBe('The Renamed Realm');
  expect(named.realms[fixed]!.name).toBe('The Renamed Land');
  expect(named.outer.name).toBe('The Far Isles');
  expect(realmWord(world, family, undefined, table)).toBe('The Renamed Realm');
  expect(named.coasts).toBe(world.coasts);
  expect(named.head).toBe(world.head);
  const unnamed = (realms: typeof world.realms) => realms.map(realm => ({ ...realm, name: '' }));
  expect(unnamed(named.realms)).toEqual(unnamed(world.realms));
  const geo = geographyOf(world, undefined, table);
  expect(geo.realms[family]!.name).toBe('The Renamed Realm');
  expect(geo.outer.name).toBe('The Far Isles');
  // Another taxonomy's world keeps the words it recorded.
  const foreign = { ...world, taxonomy: { ...world.taxonomy, id: 'families-9' } };
  expect(labelWorld(foreign, undefined, table).realms[family]!.name).toBe(world.realms[family]!.name);
  expect(world).toEqual(snapshot);
});
