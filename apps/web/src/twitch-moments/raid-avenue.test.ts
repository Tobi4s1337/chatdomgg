import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RAID_BEAT, raidScaleProfile, raidUnits, type RaidFrame } from './raid-beat';
import { BANNER_PONY_CELLS, RAID_WAGON_CELLS, bannerPonyRows, skyLanternsPerWagon, torchPairs } from './raid-art';
import { CART_CELLS, PONY_CELLS } from './gift-art';
import { CELL } from './banner';
import { RAID_PONY_LAYOUT, RAID_TORCH_LAYOUT, RAID_VIEW_LIMITS, createRaidLayer, type RaidChatGround, type RaidLayerHost } from './raid-view';

/** A straight street running +z from a gate at z 20, 4 m wide; the sampler refuses the street itself and one lot. */
function layer(ground?: RaidChatGround) {
  const root = new THREE.Group();
  const host: RaidLayerHost = {
    kit: 'hearth', material: new THREE.MeshBasicMaterial(),
    mesh: () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)),
    place: () => ({ position: [10, 0, 20], facing: [0, 0, 1] }),
    route: () => ({ inbound: [[10, 0, 20], [10, 0, 60]], outbound: [[10, 0, 60], [10, 0, 100]] }),
    ...(ground ? { ground } : {}),
  };
  return { root, view: createRaidLayer(root, host), dispose: () => host.material.dispose() };
}

const frame = (viewers: number, t: number, key = `raid.k${viewers}`): RaidFrame => {
  const units = raidUnits(viewers), timing = raidScaleProfile(viewers);
  const hold = Math.max(RAID_BEAT.minHold, RAID_BEAT.arrive + (units - 1) * timing.pitch + timing.pass + RAID_BEAT.holdAfter);
  return { id: key, key, t, from: { kingdomId: '31337', name: 'Mossbrook' } as RaidFrame['from'], founded: false, viewers, units, timing, seed: 7, hold, sleep: hold + RAID_BEAT.sleep };
};

const open: RaidChatGround = (x, z) => (Math.abs(x - 10) < 2.65 ? null : 0.25 + 0 * z);

describe('raid torch avenue and sky lanterns', () => {
  it('lines the street with more torch pairs for a bigger column, from one pair to six', () => {
    expect([3, 140, 10_000, 70_000].map(v => torchPairs(raidUnits(v)))).toEqual([1, 2, 5, 6]);
    for (const viewers of [3, 140, 10_000, 70_000]) {
      const { view, dispose } = layer(open);
      view.apply([frame(viewers, 6000)], 6000);
      expect(view.stats().torches).toBe(2 * torchPairs(raidUnits(viewers)));
      view.dispose(); dispose();
    }
  });

  it('plants torches only on supported ground beside the street, never in it or the gateway', () => {
    const planted: [number, number][] = [];
    const { view, dispose } = layer((x, z) => {
      const height = open(x, z);
      if (height !== null) planted.push([x, z]);
      // A house lot on the right of the second pair refuses that side.
      return x > 10 && z > 26 && z < 29 ? null : height;
    });
    view.apply([frame(140, 6000)], 6000);
    expect(view.stats().torches).toBe(3);
    expect(view.torchSites()).toHaveLength(3);
    expect(view.torchSites().every(site => site.radius === 0.65 && site.foot[1] === 0.25)).toBe(true);
    for (const [x, z] of planted) {
      expect(Math.abs(x - 10)).toBeGreaterThanOrEqual(RAID_TORCH_LAYOUT.aside[0] - 1e-9);
      expect(z - 20).toBeGreaterThan(2.2);
    }
    view.dispose(); dispose();
  });

  it('draws no torch without a ground sampler rather than guessing a height', () => {
    const { view, dispose } = layer();
    view.apply([frame(10_000, 6000)], 6000);
    expect(view.stats().torches).toBe(0);
    view.dispose(); dispose();
  });

  it('lights the torches in a wave from the gate and puts them out with it', () => {
    const { view, dispose } = layer(open);
    const quiet = view.stats().lights;
    view.apply([frame(10_000, 200)], 200);
    const before = view.stats().lights;
    view.apply([frame(10_000, 1300)], 1300);
    const early = view.stats().lights;
    view.apply([frame(10_000, 4200)], 4200);
    const blazing = view.stats().lights;
    expect(quiet).toBe(0);
    expect(early).toBeGreaterThan(before);
    expect(blazing).toBeGreaterThan(early);
    const asleep = frame(10_000, 0);
    view.apply([{ ...asleep, t: asleep.sleep + RAID_BEAT.sleepFade + 50 }], 900_000);
    expect(view.stats().torches).toBe(0);
    expect(view.torchSites()).toEqual([]);
    view.dispose(); dispose();
  });

  it('releases a bounded number of sky lanterns over the biggest columns only', () => {
    expect([3, 140, 9_999, 10_000, 70_000].map(skyLanternsPerWagon)).toEqual([0, 0, 0, 6, 9]);
    for (const viewers of [140, 10_000, 70_000]) {
      const { view, dispose } = layer(open);
      let most = 0;
      for (let t = 0; t < 70_000; t += 1500) { view.apply([frame(viewers, t)], t); most = Math.max(most, view.stats().skyLanterns); }
      if (viewers < 10_000) expect(most).toBe(0);
      else { expect(most).toBeGreaterThan(10); expect(most).toBeLessThanOrEqual(RAID_VIEW_LIMITS.sky); }
      view.dispose(); dispose();
    }
  }, 20_000);

  it('leads banner ponies two abreast between the wagons of a longer column, never for a single wagon', () => {
    expect([3, 140, 10_000, 70_000].map(v => bannerPonyRows(raidUnits(v)))).toEqual([0, 1, 2, 2]);
    const most: number[] = [];
    for (const viewers of [3, 140, 10_000, 70_000]) {
      const { view, dispose } = layer(open);
      let peak = 0;
      for (let t = 0; t < 90_000; t += 2000) {
        view.apply([frame(viewers, t)], t);
        const { ponies } = view.stats();
        expect(ponies % 2).toBe(0);
        peak = Math.max(peak, ponies);
      }
      most.push(peak);
      view.dispose(); dispose();
    }
    expect(most[0]).toBe(0);
    expect(most[1]).toBeGreaterThan(0);
    expect(most[2]).toBeGreaterThan(most[1]!);
    // 10,000 and 70,000 both lead two rows per gap; how many are on the road at once depends on the pitch.
    expect(most[3]).toBeGreaterThan(most[1]!);
    expect(Math.max(...most)).toBeLessThanOrEqual(RAID_VIEW_LIMITS.ponies);
  }, 20_000);

  it('keeps every banner pony row clear of the wagon ahead and the pony of the wagon behind', () => {
    // On this 80 m road the column's pace sets the gap; the rows that fit must leave the authored air on each side.
    for (const viewers of [140, 10_000, 70_000]) {
      const timing = raidScaleProfile(viewers), length = 80;
      const speed = Math.min(3, Math.max(1.6, (length + 3) / ((timing.travel - RAID_BEAT.vanish * 0.5) / 1000)));
      const gap = timing.pitch / 1000 * speed;
      const tail = RAID_WAGON_CELLS.pivot[0] * CELL;
      const nose = (CART_CELLS.pony[0] - RAID_WAGON_CELLS.pivot[0] + PONY_CELLS.size[0] - PONY_CELLS.pivot[0]) * CELL;
      const free = gap - tail - nose, body = BANNER_PONY_CELLS.back + BANNER_PONY_CELLS.front;
      let rows = bannerPonyRows(raidUnits(viewers));
      while (rows > 0 && free - rows * body < (rows + 1) * RAID_PONY_LAYOUT.clear) rows--;
      expect(rows, `${viewers}`).toBeGreaterThan(0);
      expect((free - rows * body) / (rows + 1)).toBeGreaterThanOrEqual(RAID_PONY_LAYOUT.clear);
    }
  });
});
