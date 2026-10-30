import { describe, expect, it } from 'vitest';
import { MAT } from '../materials';
import {
  composeForgeFixture, createForgePiece, findMates, mateConnectors, placeConnector, placeSpace, poseLeafBox, rasterize,
  FORGE_PIECES, FORGE_PROFILES, FORGE_REVIEW, REVIEW_LOT, type ForgeReviewFixture, type PlacedConnector,
} from './index';
import { normalVector, turnPoint, type QuarterTurn, type Space } from './grammar';

const [SX, SY, SZ] = REVIEW_LOT;
const index = (x: number, y: number, z: number) => x + SX * (y + SY * z);
const inLot = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ;
const pieceOf = (id: string) => FORGE_PIECES.find(p => p.id === id)!;

/** Rasterizes every instance into the lot with an owner per cell; any doubly claimed cell fails. */
function assemble(fixture: ForgeReviewFixture, leaf: 'closed' | 'open' | 'none') {
  const material = new Uint16Array(SX * SY * SZ), owner = new Int16Array(SX * SY * SZ).fill(-1);
  const overlaps: string[] = [];
  const stamp = (voxels: Uint16Array, size: readonly number[], place: (x: number, y: number, z: number) => Space, who: number) => {
    for (let z = 0; z < size[2]!; z++) for (let y = 0; y < size[1]!; y++) for (let x = 0; x < size[0]!; x++) {
      const m = voxels[x + size[0]! * (y + size[1]! * z)]!;
      if (!m) continue;
      const { from: [wx, wy, wz] } = place(x, y, z);
      if (!inLot(wx, wy, wz)) throw new Error(`${fixture.instances[who]!.id} leaves the lot at ${wx},${wy},${wz}.`);
      const i = index(wx, wy, wz);
      if (owner[i]! >= 0) overlaps.push(`${fixture.instances[owner[i]!]!.id}×${fixture.instances[who]!.id}@${wx},${wy},${wz}`);
      material[i] = m; owner[i] = who;
    }
  };
  fixture.instances.forEach((instance, who) => {
    const piece = pieceOf(instance.pieceId);
    const unit = (x: number, y: number, z: number): Space => ({ from: [x, y, z], to: [x + 1, y + 1, z + 1] });
    stamp(rasterize(piece.blueprint), piece.blueprint.size, (x, y, z) => placeSpace(unit(x, y, z), instance), who);
    if (piece.door && leaf !== 'none') {
      stamp(rasterize(piece.door.leaf), piece.door.leaf.size, (x, y, z) => placeSpace(poseLeafBox(unit(x, y, z), piece.door!, leaf), instance), who);
    }
  });
  const solid = (x: number, y: number, z: number) => inLot(x, y, z) && material[index(x, y, z)] !== MAT.air;
  return { material, owner, overlaps, solid };
}

/** Outside air reachable from the lot faces (cells beyond the lot count as open sky and ground-level air). */
function outsideAir(solid: (x: number, y: number, z: number) => boolean): Uint8Array {
  const seen = new Uint8Array(SX * SY * SZ), queue: number[] = [];
  for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
    if ((x === 0 || z === 0 || x === SX - 1 || z === SZ - 1 || y === SY - 1) && !solid(x, y, z)) { seen[index(x, y, z)] = 1; queue.push(index(x, y, z)); }
  }
  while (queue.length) {
    const i = queue.pop()!, x = i % SX, y = Math.floor(i / SX) % SY, z = Math.floor(i / (SX * SY));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (!inLot(nx, ny, nz) || solid(nx, ny, nz) || seen[index(nx, ny, nz)]) continue;
      seen[index(nx, ny, nz)] = 1; queue.push(index(nx, ny, nz));
    }
  }
  return seen;
}

function grounded(material: Uint16Array): number {
  const seen = new Uint8Array(material.length), queue: number[] = [];
  let solids = 0;
  for (let i = 0; i < material.length; i++) if (material[i]) solids++;
  for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) if (material[index(x, 0, z)]) { seen[index(x, 0, z)] = 1; queue.push(index(x, 0, z)); }
  while (queue.length) {
    const i = queue.pop()!, x = i % SX, y = Math.floor(i / SX) % SY, z = Math.floor(i / (SX * SY));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (!inLot(nx, ny, nz) || !material[index(nx, ny, nz)] || seen[index(nx, ny, nz)]) continue;
      seen[index(nx, ny, nz)] = 1; queue.push(index(nx, ny, nz));
    }
  }
  return solids - seen.reduce((n, v) => n + v, 0);
}

function forEachCell(box: Space, visit: (x: number, y: number, z: number) => void) {
  for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++) for (let x = box.from[0]; x < box.to[0]; x++) visit(x, y, z);
}

/**
 * Section cells of a mate, read from connector `from`, on its own side (-1) or its partner's side (+1). Up/down
 * sections are read in the reading piece's own turned x/z axes.
 */
function sectionCells(from: PlacedConnector, turn: QuarterTurn, side: -1 | 1, section: readonly { u: readonly [number, number]; v: readonly [number, number] }[]) {
  const n = normalVector(from.normal), vertical = n[1] !== 0;
  const U = vertical ? turnPoint([1, 0, 0], turn) : [n[2], 0, -n[0]], V = vertical ? turnPoint([0, 0, 1], turn) : [0, 1, 0];
  const cells: [number, number, number][] = [];
  for (const { u, v } of section) for (let a = u[0]; a < u[1]; a++) for (let b = v[0]; b < v[1]; b++) {
    cells.push([0, 1, 2].map(k => Math.floor(from.point[k]! + (a + 0.5) * U[k]! + (b + 0.5) * V[k]! + side * 0.5 * n[k]!)) as [number, number, number]);
  }
  return cells;
}

/** Connectors that must find a partner in a finished assembly, by form. Floors and wall heads may stay open. */
const SHELL: Record<string, readonly string[]> = {
  wall: ['west', 'east', 'foot-west', 'foot-east'], door: ['west', 'east', 'foot-west', 'foot-east', 'canopy'], window: ['west', 'east', 'foot-west', 'foot-east', 'shutters'],
  'wall-corner': ['east', 'north', 'foot-east', 'foot-north'], 'roof-slope': ['west', 'east', 'seat', 'crest'],
  'roof-ridge': ['west', 'east', 'seat'], 'roof-gable': ['foot-west', 'foot-east', 'apex'], 'roof-verge': ['slope-west', 'slope-east', 'ridge'],
  'shutter-pair': ['mount'], 'porch-deck': ['floor'], chimney: ['seat'],
};
/** Each hand carries its porch differently: Hearth frames a beam between posts, Tide rests a lintel on braced posts. */
const REQUIRED: Record<string, Record<string, readonly string[]>> = {
  hearthfold: { ...SHELL, 'porch-post': ['foot', 'beam', 'head'], trim: ['west', 'east', 'top'], 'porch-canopy': ['wall', 'post-west', 'post-east', 'beam'] },
  tidewake: { ...SHELL, 'porch-post': ['foot', 'head', 'knee'], trim: ['post-west', 'post-east', 'top'], 'porch-canopy': ['wall', 'beam', 'knee-west', 'knee-east'] },
};

describe.each(FORGE_REVIEW.map(f => [f.familyId, f] as const))('%s review cottage', { timeout: 30_000 }, (family, fixture) => {
  const shell = assemble(fixture, 'none');
  const placed = fixture.instances.flatMap(instance => pieceOf(instance.pieceId).connectors.map(c => placeConnector(c, instance)));
  const profiles = new Map(FORGE_PROFILES[family].map(p => [p.id, p]));

  it('composes the real definitions without overlap inside the hut active depth', () => {
    expect(shell.overlaps).toEqual([]);
    for (const leaf of ['closed', 'open'] as const) expect(assemble(fixture, leaf).overlaps).toEqual([]);
    const rear = SZ - 64;
    let behind = 0;
    shell.material.forEach((m, i) => { if (m && Math.floor(i / (SX * SY)) < rear) behind++; });
    expect(behind).toBe(0);
    const composed = composeForgeFixture(fixture, FORGE_PIECES, 'closed').blueprint;
    expect(composed.boxes.length).toBeLessThanOrEqual(2000);
    expect(new Set(composed.windows.map(w => w.id)).size).toBe(composed.windows.length);
  });

  it('joins every wall, roof and end piece through solid documented sections', () => {
    const mates = findMates(placed);
    const mated = new Set(mates.flatMap(([a, b]) => [`${a.instance}/${a.id}`, `${b.instance}/${b.id}`]));
    const missing = fixture.instances.flatMap(instance => {
      const form = instance.pieceId.replace(`forge-${family}-`, '');
      return (REQUIRED[family]![form] ?? []).filter(id => !mated.has(`${instance.id}/${id}`)).map(id => `${instance.id}/${id}`);
    });
    expect(missing).toEqual([]);
    const ownerOf = (x: number, y: number, z: number) => inLot(x, y, z) && shell.solid(x, y, z) ? fixture.instances[shell.owner[index(x, y, z)]!]!.id : null;
    const cracks: string[] = [];
    for (const [a, b] of mates) {
      const profile = profiles.get(a.profile);
      if (!profile) throw new Error(`Undocumented profile ${a.profile}.`);
      const twins = (normal: string) => new Set(placed.filter(c => c.profile === a.profile && c.normal === normal && c.point.every((v, i) => v === a.point[i])).map(c => c.instance));
      const holds = (reader: PlacedConnector, other: PlacedConnector) => [-1, 1].every(side => {
        const owners = twins(side < 0 ? reader.normal : other.normal);
        const turn = fixture.instances.find(i => i.id === reader.instance)!.quarterTurns;
        return sectionCells(reader, turn, side as -1 | 1, profile.section).every(cell => owners.has(ownerOf(...cell) ?? ''));
      });
      if (!(holds(a, b) || (profile.chiral && holds(b, a)))) cracks.push(`${a.instance}/${a.id}↔${b.instance}/${b.id}`);
    }
    expect(cracks).toEqual([]);
    expect(mates.length).toBeGreaterThanOrEqual(40);
  });

  it('stands on the ground and closes into a sealed room with the door shut', () => {
    const closed = assemble(fixture, 'closed'), open = assemble(fixture, 'open');
    expect(grounded(closed.material)).toBe(0);
    expect(grounded(open.material)).toBe(0);
    const room: [number, number, number] = [fixture.entrance[0], fixture.entrance[1], fixture.entrance[2] - 16];
    expect(closed.solid(...room)).toBe(false);
    expect(outsideAir(closed.solid)[index(...room)]).toBe(0);
    expect(outsideAir(open.solid)[index(...room)]).toBe(1);
  });

  it('keeps a supported 10×20 entry from the street through the open door into the room', () => {
    const open = assemble(fixture, 'open');
    const door = fixture.instances.find(i => pieceOf(i.pieceId).door)!;
    const spec = pieceOf(door.pieceId).door!;
    const passage = placeSpace(spec.passage, door);
    expect([passage.to[0] - passage.from[0], passage.to[2] - passage.from[2]].sort((a, b) => a - b)[1]).toBeGreaterThanOrEqual(10);
    expect(passage.to[1] - passage.from[1]).toBeGreaterThanOrEqual(20);
    forEachCell(passage, (x, y, z) => expect(open.solid(x, y, z), `passage ${x},${y},${z}`).toBe(false));
    forEachCell({ from: [passage.from[0], passage.from[1] - 1, passage.from[2]], to: [passage.to[0], passage.from[1], passage.to[2]] }, (x, y, z) => expect(open.solid(x, y, z), `floor ${x},${y},${z}`).toBe(true));
    // Approach: from the threshold to the street edge, headroom stays clear and every rise is at most two cells.
    const threshold = placeConnector({ id: 't', profile: 't', point: spec.threshold, normal: 'south' }, door).point;
    expect(door.quarterTurns).toBe(0);
    let surface = threshold[1];
    for (let z = passage.to[2]; z < SZ; z++) {
      let top = 0;
      for (let x = passage.from[0]; x < passage.to[0]; x++) {
        for (let y = surface + 1; y < surface + 21; y++) expect(open.solid(x, y, z), `approach ${x},${y},${z}`).toBe(false);
        for (let y = surface; y > 0; y--) if (open.solid(x, y - 1, z)) { top = Math.max(top, y); break; }
      }
      expect(surface - top).toBeLessThanOrEqual(2);
      surface = top;
    }
  });

  it('opens every window onto clear air and reserves the leaf swing', () => {
    const composed = composeForgeFixture(fixture, FORGE_PIECES, 'none').blueprint;
    expect(composed.windows.length).toBeGreaterThanOrEqual(2);
    for (const w of composed.windows) {
      const across = w.facing === 'south' || w.facing === 'north' ? 0 : 2, normal = 2 - across, out = w.facing === 'south' || w.facing === 'east' ? 1 : -1;
      let glass = 0;
      for (let y = w.centre[1] - w.height / 2; y < w.centre[1] + w.height / 2; y++) for (let u = w.centre[across] - w.width / 2; u < w.centre[across] + w.width / 2; u++) {
        const cell: [number, number, number] = [...w.centre]; cell[1] = y; cell[across] = u;
        cell[normal] = w.centre[normal]! - (out > 0 ? 1 : 0);
        if (shell.material[index(...cell)] === MAT.glass) glass++;
        for (let k = 0; k < 2; k++) { cell[normal] = w.centre[normal]! + (out > 0 ? k : -1 - k); expect(shell.solid(...cell), `${w.id} outward ${cell}`).toBe(false); }
      }
      expect(glass, w.id).toBeGreaterThan(w.width * w.height / 2);
    }
    for (const instance of fixture.instances) for (const box of pieceOf(instance.pieceId).clearanceBoxes) {
      forEachCell(placeSpace(box, instance), (x, y, z) => expect(shell.solid(x, y, z), `${instance.id} clearance ${x},${y},${z}`).toBe(false));
    }
    const door = fixture.instances.find(i => pieceOf(i.pieceId).door)!, spec = pieceOf(door.pieceId).door!;
    // The door's clearance boxes together reserve the sweep (a stepped leaf reserves a stepped band).
    const inside = (p: readonly number[]) => pieceOf(door.pieceId).clearanceBoxes.some(swing => p.every((v, k) => v >= swing.from[k]! - 1e-9 && v <= swing.to[k]! + 1e-9));
    const leafCells: Space[] = [];
    const leaf = rasterize(spec.leaf), [lx, ly, lz] = spec.leaf.size;
    for (let z = 0; z < lz; z++) for (let y = 0; y < ly; y++) for (let x = 0; x < lx; x++) if (leaf[x + lx * (y + ly * z)]) leafCells.push({ from: [x, y, z], to: [x + 1, y + 1, z + 1] });
    for (const pose of ['closed', 'open'] as const) for (const cell of leafCells) {
      const posed = poseLeafBox(cell, spec, pose);
      expect(inside(posed.from) && inside(posed.to), `${pose} leaf ${posed.from}`).toBe(true);
    }
    // Every corner of every leaf cell stays inside the reservation through the whole quarter turn.
    for (let step = 0; step <= 90; step++) {
      const angle = spec.openQuarterTurns * step * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
      for (const cell of leafCells) for (const x of [cell.from[0], cell.to[0]]) for (const z of [cell.from[2], cell.to[2]]) {
        const dx = x - spec.hinge[0], dz = z - spec.hinge[2];
        expect(inside([spec.hinge[0] + dx * c + dz * s, cell.from[1], spec.hinge[2] - dx * s + dz * c]), `swing ${step}°`).toBe(true);
      }
    }
  });
});

describe('the Forge grammar is finite and explicit', () => {
  it('returns the catalogued definition and rejects unknown or unfinished input', () => {
    for (const piece of FORGE_PIECES) {
      const [, family, ...form] = piece.id.split('-');
      expect(JSON.stringify(createForgePiece(family as never, form.join('-') as never))).toBe(JSON.stringify(piece));
    }
    expect(() => createForgePiece('hearthfold', 'gate' as never)).toThrow('Unknown Forge form');
    expect(() => createForgePiece('lanternmere' as never, 'wall')).toThrow('Unknown Forge family');
  });

  it('rejects a mismatched connector pair even at a shared point', () => {
    const fixture = FORGE_REVIEW[0]!;
    const wall = fixture.instances.find(i => i.id === 'wall-east')!, floor = fixture.instances.find(i => i.pieceId.endsWith('-floor'))!;
    const side = placeConnector(pieceOf(wall.pieceId).connectors.find(c => c.id === 'east')!, wall);
    const edge = { ...placeConnector(pieceOf(floor.pieceId).connectors.find(c => c.id === 'west')!, floor), point: side.point };
    expect(() => mateConnectors(side, edge)).toThrow('cannot mate');
    expect(() => mateConnectors(side, { ...side, instance: 'twin' })).toThrow('do not face each other');
    expect(() => mateConnectors(side, { ...side, instance: 'apart', normal: 'west', point: [side.point[0], side.point[1] + 1, side.point[2]] })).toThrow('do not meet');
  });
});
