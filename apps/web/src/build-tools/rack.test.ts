import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { VoxelBlueprint } from '@chatdom/shared';
import * as copy from './copy';
import { allowanceWords, draftWords, pieceShelf, privateDraft, rackHeading, shelveMaterials, welcomeWords } from './copy';
import { piecePicture } from './picture';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, path), 'utf8');

describe('the rack’s words', () => {
  it('heads the rack with the owner’s home, or plainly without a name', () => {
    expect(rackHeading('Juniper')).toBe('Juniper’s home');
    expect(rackHeading('  tobi4s_ ')).toBe('tobi4s_’s home');
    expect(rackHeading()).toBe('Your home');
    expect(rackHeading('   ')).toBe('Your home');
    // The component draws exactly this heading from its ownerName prop.
    expect(read('index.tsx')).toContain('rackHeading(props.ownerName)');
  });

  it('says in plain words what happens to the work, never the engine’s mode name', () => {
    expect(privateDraft('SIMULATED')).toBe(true);
    expect(privateDraft('LIVE')).toBe(false);
    expect(draftWords('SIMULATED')).toEqual({ title: 'Private to you', detail: 'Saved in this browser until the street opens to building.', unsent: 'Not yet on your street' });
    expect(draftWords('LIVE').title).toBe('Not open to building yet');
    expect(welcomeWords('SIMULATED', false)).toMatchObject({ title: 'Welcome the street', detail: 'Your street in this browser' });
    expect(welcomeWords('SIMULATED', true).title).toBe('Opening the shutters…');
    const all = [draftWords('SIMULATED'), draftWords('LIVE'), welcomeWords('SIMULATED', false), welcomeWords('LIVE', false)].flatMap(Object.values).join(' ');
    expect(all).not.toMatch(/SIMULATED|simulat/i);
  });

  it('shows the allowance as used of budget, what is left, and a gauge fraction', () => {
    expect(allowanceWords(1234, 32768)).toMatchObject({ used: '1,234 of 32,768', left: '31,534 left', near: false, full: false });
    expect(allowanceWords(1234, 32768).fraction).toBeCloseTo(1234 / 32768);
    expect(allowanceWords(32767, 32768)).toMatchObject({ left: '1 block left', near: true });
    expect(allowanceWords(40000, 32768)).toMatchObject({ fraction: 1, left: 'No blocks left', full: true });
    expect(allowanceWords(10, 0).fraction).toBe(1);
    expect(allowanceWords(5, 100).spoken).toBe('5 of 100 blocks used, 95 left');
  });

  it('draws the pieces shelf only when the core offers pieces', () => {
    expect(pieceShelf(undefined)).toBeNull();
    expect(pieceShelf([])).toBeNull();
    const offered = [{ id: 'a' }];
    expect(pieceShelf(offered)).toBe(offered);
  });

  it('keeps every supplied material on exactly one named shelf', () => {
    const materials = ['plaster', 'timber', 'stone', 'slate', 'glass', 'brass', 'grass', 'petal'].map((name, id) => ({ id, name, colour: '#808080' }));
    const shelves = shelveMaterials(materials);
    expect(shelves.flatMap(shelf => shelf.items)).toHaveLength(materials.length);
    expect(shelves.find(shelf => shelf.name === 'Accents')?.items.map(item => item.name)).toEqual(['glass', 'brass']);
  });
});

describe('mirror mode is gone (decision 35)', () => {
  it('has no mirror fitting, mark or words on the rack or the fallback kit', () => {
    expect(Object.keys(copy)).not.toContain('MIRRORS');
    for (const file of ['index.tsx', 'copy.ts', 'marks.tsx', 'build-tools.css', 'capture.mjs', '../build/Tools.tsx', '../build/build.css'])
      expect(read(file), file).not.toMatch(/mirror/i);
  });
});

describe('no SIMULATED words where a person can read them (decision 25)', () => {
  it('keeps the engine word out of the rack, the fallback kit and their styles', () => {
    for (const file of ['index.tsx', 'marks.tsx', 'build-tools.css', '../build/Surface.tsx', '../build/TemplatePicker.tsx', '../build/build.css']) {
      const visible = read(file).replace(/mode === 'SIMULATED'/g, '');
      expect(visible, file).not.toMatch(/SIMULATED/);
    }
    const fallback = read('../build/Tools.tsx').replace(/state\(\)\.mode !== 'SIMULATED'/g, '');
    expect(fallback).not.toMatch(/SIMULATED/);
  });

  it('never puts the engine word in a status line the core shows', () => {
    const source = read('../build/session.ts');
    const literals = source.match(/'[^'\n]*'|`[^`\n]*`/g) ?? [];
    const spoken = literals.filter(text => text.includes('SIMULATED') && text !== `'SIMULATED'` && !text.startsWith('`chatdom:build:SIMULATED:'));
    expect(spoken).toEqual([]);
  });
});

describe('a piece drawn from its own voxels', () => {
  const blueprint: VoxelBlueprint = { version: 1, id: 'piece-test', styleId: 'hearth' as VoxelBlueprint['styleId'], kind: 'prop', lattice: 'build', size: [8, 8, 8],
    boxes: [{ from: [0, 0, 0], to: [8, 2, 8], material: 3 as VoxelBlueprint['boxes'][number]['material'] }, { from: [2, 2, 2], to: [4, 8, 4], material: 0 as VoxelBlueprint['boxes'][number]['material'] }], windows: [] };

  it('draws three lit faces per solid box in its material colour and skips air', () => {
    const picture = piecePicture(blueprint, id => id === 3 ? '#8080c0' : undefined);
    expect(picture?.faces).toHaveLength(3);
    expect(picture?.faces.map(face => face.fill)).toEqual(['#69699d', '#4f4f77', '#8a8acf']);
    expect(picture?.viewBox.split(' ').map(Number).every(Number.isFinite)).toBe(true);
  });

  it('has no picture for a piece with nothing solid', () => {
    expect(piecePicture({ ...blueprint, boxes: [blueprint.boxes[1]!] }, () => '#ffffff')).toBeNull();
  });
});
