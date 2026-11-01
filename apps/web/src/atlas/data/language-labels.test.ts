import { expect, it, vi } from 'vitest';
import { LANGUAGE_NAMES } from '../../../../surveyor/src/cartography/language-labels';
import { makeWorld } from './fixtures.test-support';
import { geographyOf, labelWorld } from './model';

it('projects reviewed language labels over hostile historic labels without touching frozen geography', () => {
  const world = makeWorld();
  world.regions[0] = { ...world.regions[0]!, language: 'ru', name: 'Russia', englishName: 'Russia' };
  world.regions[1] = { ...world.regions[1]!, language: 'uk', name: 'Россия', englishName: 'Russia' };
  world.realms[4] = { ...world.realms[4]!, name: 'Russia' };
  const snapshot = structuredClone(world);
  const table = { ...LANGUAGE_NAMES, names: { ...LANGUAGE_NAMES.names, ru: { label: 'Russian revised', mapLabel: 'Russian map' }, uk: { label: 'Ukrainian revised', mapLabel: 'Ukrainian map' } } };
  const broken = vi.spyOn(Intl, 'DisplayNames').mockImplementation(() => { throw new Error('locale data unavailable'); });
  try {
    const original = labelWorld(world);
    const revised = labelWorld(world, table);
    expect(original.regions.map(r => r.name)).toEqual(['Russian', 'Ukrainian', 'The Outer Isles']);
    expect(original.realms[4]!.name).toBe('Ukrainian');
    expect(revised.regions.map(r => r.name)).toEqual(['Russian revised', 'Ukrainian revised', 'The Outer Isles']);
    expect(revised.realms[4]!.name).toBe('Ukrainian revised');
    expect(revised.coasts).toBe(world.coasts);
    expect(revised.head).toBe(world.head);
    expect(revised.regions.map(r => r.chunk)).toEqual(world.regions.map(r => r.chunk));
    expect(world).toEqual(snapshot);
    const before = geographyOf(world);
    const after = geographyOf(world, table);
    expect(before.regions.map(r => r.name)).toEqual(['Streams in\nRussian', 'Streams in\nUkrainian', 'The Outer Isles']);
    expect(after.regions.map(r => r.name)).toEqual(['Russian map', 'Ukrainian map', 'The Outer Isles']);
    expect(after.realms[4]!.name).toBe('Ukrainian revised');
    const strip = (geo: typeof before) => ({ ...geo, regions: geo.regions.map(region => ({ ...region, name: '', englishName: '' })), realms: geo.realms.map(realm => ({ ...realm, name: '' })) });
    expect(strip(after)).toEqual(strip(before));
    expect(world).toEqual(snapshot);
  } finally { broken.mockRestore(); }
});
