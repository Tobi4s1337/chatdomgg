import * as THREE from 'three';

/*
 * The flame, its sparks and the embers as tiny cubes in the world's palette (Artstyle §9: effects
 * are voxel-native). Every particle is a pure function of public time, so a frame is seekable and a
 * capture at a fixed instant is identical run to run. Colours stay below white so the flame never
 * blows out or buries a face.
 */

const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (t: number): number => t * t * (3 - 2 * t);

const CORE = new THREE.Color('#ffd98c'), BODY = new THREE.Color('#f59a3c'), TIP = new THREE.Color('#c4502a'), SMOKE = new THREE.Color('#5d5868');
const SPARK = new THREE.Color('#ffc66b'), EMBER = new THREE.Color('#e0662e'), EMBER_HOT = new THREE.Color('#ffb15a');

export interface FireState {
  /** 0 banked embers, 1 a tended fire. */
  readonly strength: number;
  /** Wind lean, metres per metre of rise along +X. */
  readonly wind: number;
}

export interface FireEffect {
  readonly group: THREE.Group;
  update(time: number, state: FireState): void;
  dispose(): void;
}

interface Pool { readonly mesh: THREE.InstancedMesh; readonly count: number }

function pool(count: number, size: number, opacity = 1): Pool {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, fog: false });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, CORE);
  mesh.frustumCulled = false;
  return { mesh, count };
}

/** A small wind-blown fire whose flame base sits at the group's origin. */
export function createFire(): FireEffect {
  const group = new THREE.Group();
  group.name = 'campfire.fire';
  const flame = pool(64, .085), sparks = pool(18, .028), embers = pool(26, .05), smoke = pool(14, .09, .32);
  for (const p of [smoke, flame, sparks, embers]) group.add(p.mesh);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), euler = new THREE.Euler(), colour = new THREE.Color();
  const place = (p: Pool, index: number, x: number, y: number, z: number, s: number, spin: number, c: THREE.Color): void => {
    position.set(x, y, z); scale.setScalar(Math.max(0.0001, s)); rotation.setFromEuler(euler.set(spin * .7, spin, spin * .4));
    p.mesh.setMatrixAt(index, matrix.compose(position, rotation, scale)); p.mesh.setColorAt(index, c);
  };
  return {
    group,
    update(time, state) {
      const strength = Math.max(0, Math.min(1, state.strength));
      // A slow breathing of the whole flame, plus a quicker licking; neither strobes.
      const breathe = .9 + .07 * Math.sin(time * 1.7) + .04 * Math.sin(time * 4.3 + 1.1);
      const height = (.25 + .5 * strength) * breathe;
      for (let i = 0; i < flame.count; i++) {
        const period = .62 + hash(i) * .5, age = ((time + hash(i + 50) * period) / period) % 1;
        const cycle = Math.floor((time + hash(i + 50) * period) / period);
        const angle = hash(i * 7 + cycle * 13) * Math.PI * 2, radius = (.04 + hash(i * 3 + cycle) * .13) * (1 - age * .75);
        const rise = smooth(age) * height * (.55 + hash(i + cycle * 3) * .6);
        const lick = Math.sin(time * 6 + i) * .015 * age;
        const x = Math.cos(angle) * radius + state.wind * rise * rise * 1.4 + lick, z = Math.sin(angle) * radius;
        const size = (1 - age) * (.7 + hash(i * 11) * .6) * (.35 + .65 * strength);
        colour.copy(CORE).lerp(BODY, smooth(Math.min(1, age * 1.6))).lerp(TIP, smooth(Math.max(0, age * 1.7 - .7)));
        place(flame, i, x, .02 + rise, z, i < flame.count * strength + 6 ? size : 0, time * 2 + i, colour);
      }
      for (let i = 0; i < sparks.count; i++) {
        // Sparse: most slots rest each cycle, so sparks arrive one or two at a time.
        const period = 2.2 + hash(i + 200) * 2.4, cycleTime = time + hash(i + 220) * period, cycle = Math.floor(cycleTime / period), age = (cycleTime / period) % 1;
        const live = hash(i * 17 + cycle * 29) < .45 * strength;
        const angle = hash(i + cycle * 5) * Math.PI * 2, drift = .05 + age * .35;
        const y = .25 + age * (1.1 + hash(i + cycle) * .9);
        const x = Math.cos(angle) * drift * .5 + state.wind * age * 1.2 + Math.sin(time * 3 + i) * .03, z = Math.sin(angle) * drift * .5;
        colour.copy(SPARK).lerp(TIP, age);
        place(sparks, i, x, y, z, live ? (1 - age) * 1.1 : 0, time * 5 + i, colour);
      }
      for (let i = 0; i < embers.count; i++) {
        const angle = hash(i + 300) * Math.PI * 2, radius = Math.sqrt(hash(i + 310)) * .36;
        const glow = .5 + .5 * Math.sin(time * (.7 + hash(i + 320)) + i * 2.3);
        colour.copy(EMBER).lerp(EMBER_HOT, glow * (.4 + .6 * strength));
        place(embers, i, Math.cos(angle) * radius, -.01 + hash(i + 330) * .03, Math.sin(angle) * radius, .55 + hash(i + 340) * .6, hash(i) * 3, colour);
      }
      for (let i = 0; i < smoke.count; i++) {
        // Smoke is thin above a tended fire and thickens a little as it banks down.
        const period = 5 + hash(i + 400) * 3, age = ((time + hash(i + 410) * period) / period) % 1;
        const y = height + .15 + age * 2.2, x = state.wind * (y * y * .55) + Math.sin(time * .5 + i) * .08 * age;
        colour.copy(SMOKE);
        place(smoke, i, x, y, Math.cos(time * .4 + i) * .06 * age, (.6 + age * 1.8) * (1 - age) * (.6 + (1 - strength) * .7), time * .3 + i, colour);
      }
      for (const p of [flame, sparks, embers, smoke]) { p.mesh.instanceMatrix.needsUpdate = true; if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true; }
    },
    dispose() { for (const p of [flame, sparks, embers, smoke]) { p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose(); p.mesh.dispose(); } },
  };
}

/** One game lantern's flame this frame. `level` 1 burns, 0 is out; `smoke` 0..1 is the wisp after a flame goes out. */
export interface LanternFlame { readonly flame: THREE.Vector3; readonly level: number; readonly smoke: number; readonly seed: number }

/** The little flame inside each game lantern; one going out shrinks and leaves a thread of smoke. */
export function createLanternFlames(capacity: number): {
  readonly group: THREE.Group;
  update(time: number, lanterns: readonly LanternFlame[], count?: number): void;
  dispose(): void;
} {
  const group = new THREE.Group();
  const flames = pool(capacity * 3, .045), wisps = pool(capacity * 3, .03, .4);
  group.add(flames.mesh, wisps.mesh);
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), colour = new THREE.Color();
  return {
    group,
    update(time, lanterns, count = lanterns.length) {
      if (count > capacity) throw new Error(`At most ${capacity} game lanterns.`);
      flames.mesh.count = wisps.mesh.count = count * 3;
      for (let l = 0; l < count; l++) {
        const lantern = lanterns[l]!, level = Math.max(0, Math.min(1, lantern.level)), smoke = Math.max(0, Math.min(1, lantern.smoke));
        for (let k = 0; k < 3; k++) {
          const i = l * 3 + k, t = time * (1.3 + k * .4) + lantern.seed * 9.1;
          const flicker = .85 + .15 * Math.sin(t * 3.1) * Math.sin(t * 1.7 + k);
          // A dying flame gutters: it shrinks into the wick, its tip going first.
          const size = level <= 0 ? 0 : (1 - k * .28) * flicker * Math.min(1, level * (1.6 - k * .3));
          position.copy(lantern.flame); position.x += Math.sin(t) * .006; position.y += k * .028 * flicker * level; position.z += Math.cos(t * 1.3) * .006;
          scale.setScalar(Math.max(0, size));
          colour.copy(CORE).lerp(BODY, k * .45 + (1 - level) * .4);
          flames.mesh.setMatrixAt(i, matrix.compose(position, rotation, scale)); flames.mesh.setColorAt(i, colour);
          const age = ((time * .35 + lantern.seed + k / 3) % 1);
          position.copy(lantern.flame); position.x += Math.sin(time + k) * .02 * age; position.y += .1 + age * .45;
          scale.setScalar(smoke * (1 - age) * .9);
          wisps.mesh.setMatrixAt(i, matrix.compose(position, rotation, scale)); wisps.mesh.setColorAt(i, SMOKE);
        }
      }
      for (const p of [flames, wisps]) { p.mesh.instanceMatrix.needsUpdate = true; if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true; }
    },
    dispose() { for (const p of [flames, wisps]) { p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose(); p.mesh.dispose(); } },
  };
}

/** Gallery suspicion: a few motes rising from a small ember beside a log. Advisory, never a mark on a person. */
export function createSuspicionEmbers(capacity: number): {
  readonly group: THREE.Group;
  update(time: number, embers: readonly { readonly at: THREE.Vector3; readonly glow: number }[], count?: number): void;
  dispose(): void;
} {
  const per = 7, group = new THREE.Group(), motes = pool(capacity * per, .032);
  group.add(motes.mesh);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), colour = new THREE.Color();
  return {
    group,
    update(time, embers, count = embers.length) {
      if (count > capacity) throw new Error(`At most ${capacity} suspicion embers.`);
      motes.mesh.count = count * per;
      for (let e = 0; e < count; e++) for (let k = 0; k < per; k++) {
        const ember = embers[e]!;
        const i = e * per + k, period = 1.8 + hash(i + 600) * 1.4, age = ((time + hash(i + 610) * period) / period) % 1;
        const live = k === 0 || k < 1 + ember.glow * 2;
        position.copy(ember.at); position.x += Math.sin(time * 1.3 + k) * .04 * age; position.y += k === 0 ? .02 : age * (.25 + ember.glow * .12); position.z += Math.cos(time + k * 2) * .04 * age;
        scale.setScalar(!live ? 0 : k === 0 ? 1.3 + .2 * Math.sin(time * 2) : (1 - age) * .9);
        colour.copy(EMBER).lerp(EMBER_HOT, k === 0 ? .4 + .2 * Math.sin(time * 2.2) : 1 - age);
        motes.mesh.setMatrixAt(i, matrix.compose(position, rotation, scale)); motes.mesh.setColorAt(i, colour);
      }
      motes.mesh.instanceMatrix.needsUpdate = true; if (motes.mesh.instanceColor) motes.mesh.instanceColor.needsUpdate = true;
    },
    dispose() { motes.mesh.geometry.dispose(); (motes.mesh.material as THREE.Material).dispose(); motes.mesh.dispose(); },
  };
}
