import * as THREE from 'three';
import type { ForgeRitualFrame } from '@chatdom/shared';
import { createBlueprint } from './blueprint';
import { backOut, clamp01, readStageFrame, ritualSeed, smooth, smoother, type StageFrame } from './frame';
import { createMotes } from './motes';
import { createRunes, RUNE_SLOTS } from './runes';
import { traceSilhouette } from './silhouette';

export type Point3 = readonly [number, number, number];
export interface ForgePresentationOptions {
  root: THREE.Group;
  /** Top centre of the anvil's work surface, world metres. */
  anvil: Point3;
  /** The clone's origin at its validated final socket transform, world metres. */
  landing: Point3;
  /** A disposable presentation clone supplied and owned by the host; never the placed piece. */
  piece: THREE.Object3D;
}
export interface ForgePresentation { update(frame: ForgeRitualFrame | null): void; dispose(): void }
/** What the host device asks of motion and particle budgets. Tests and the bench supply fixed answers. */
export interface StageEnvironment {
  reducedMotion(): boolean;
  /** Returns an unsubscribe function; called again whenever the motion preference changes. */
  subscribe(listener: () => void): () => void;
  phone: boolean;
}

/** Transient motes per adapter. The whole-adapter caps are 192 (desktop/stream) and 80 (phone). */
export const MOTE_BUDGET = { full: 56, phone: 24 } as const;
const RUNE_SIZE = .17, LIFT = .05;
const WARM = new THREE.Color('#ffbf6b'), PALE = new THREE.Color('#cfeaff'), EMBER = new THREE.Color('#ff9a4a');

function point(value: Point3, name: string): THREE.Vector3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`The Forge presentation needs a finite ${name} point.`);
  return new THREE.Vector3(value[0], value[1], value[2]);
}

export function createForgeStage(options: ForgePresentationOptions, environment: StageEnvironment): ForgePresentation {
  const { root, piece } = options;
  const anvil = point(options.anvil, 'anvil');
  point(options.landing, 'landing');
  if (piece === root || piece.parent === root) throw new Error('The Forge presentation poses the host clone; it must not live under the effect root.');

  // Borrowed clone state, restored exactly on clear and dispose.
  const saved = { position: piece.position.clone(), quaternion: piece.quaternion.clone(), scale: piece.scale.clone(), visible: piece.visible };
  const silhouette = traceSilhouette(piece, RUNE_SLOTS);
  const worldQuaternion = new THREE.Quaternion(), worldScale = new THREE.Vector3();
  piece.matrixWorld.decompose(new THREE.Vector3(), worldQuaternion, worldScale);

  // The blueprint stands on the anvil in the clone's own final orientation and scale.
  const blueprint = createBlueprint(silhouette);
  const footing = new THREE.Vector3(silhouette.bounds.getCenter(new THREE.Vector3()).x, silhouette.bounds.min.y, silhouette.bounds.getCenter(new THREE.Vector3()).z);
  blueprint.object.quaternion.copy(worldQuaternion); blueprint.object.scale.copy(worldScale);
  blueprint.object.position.copy(anvil).add(new THREE.Vector3(0, LIFT, 0)).sub(footing.multiply(worldScale).applyQuaternion(worldQuaternion));
  blueprint.object.updateMatrix();
  const landings = (silhouette.landings.length ? silhouette.landings : [silhouette.bounds.getCenter(new THREE.Vector3())]).map(p => p.clone().applyMatrix4(blueprint.object.matrix));
  const size = silhouette.bounds.getSize(new THREE.Vector3()).multiply(worldScale);
  const reach = Math.max(size.x, size.z) * .5, base = anvil.y + LIFT;
  const orbitRadius = Math.max(1.3, reach + .62), orbitHeight = base + THREE.MathUtils.clamp(size.y * .5, .45, 1.4);

  const runes = createRunes(), motes = createMotes(environment.phone ? MOTE_BUDGET.phone : MOTE_BUDGET.full);
  const owned = [blueprint.object, runes.mesh, motes.points];
  root.add(...owned);

  let ritual = '', runeCount = 0, startAngle = 0, last: StageFrame | null = null, disposed = false;
  const scratch = new THREE.Vector3(), colour = new THREE.Color();
  const look = { visible: false, reveal: 0, ink: 0, inkAlpha: 1, dissolve: 0, glow: 1, lock: 0 };

  const ring = (i: number, radius: number, angle: number, height: number) =>
    scratch.set(anvil.x + Math.cos(angle) * radius, height, anvil.z + Math.sin(angle) * radius);
  const hash = (i: number, salt: number) => { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); };

  function words(f: StageFrame, reduced: boolean) {
    const p = f.progress;
    for (let i = 0; i < runeCount; i++) {
      const k = i / runeCount, start = .04 + .3 * k, angle = startAngle + k * Math.PI * 2;
      const alpha = smooth(start, start + .14, p), place = runes.place[i]!, glyph = runes.look[i]!;
      if (reduced) {
        // Same stage, no circling: the runes surface in place around the anvil.
        ring(i, orbitRadius, angle, orbitHeight);
        place.set(scratch.x, scratch.y, scratch.z, alpha * .95);
        glyph.set(RUNE_SIZE, 0, 1, 0);
        continue;
      }
      const rise = smoother(start, start + .36, p), converge = smoother(.72 + .06 * k, 1, p);
      const theta = angle + .85 * f.elapsed, radius = THREE.MathUtils.lerp(.42, orbitRadius, backOut(rise));
      const height = THREE.MathUtils.lerp(base + .06, orbitHeight + .16 * Math.sin(i * 2.1), rise) + .07 * Math.sin(f.elapsed * 1.6 + i * 1.3) * rise;
      ring(i, radius, theta, height).lerp(landings[i % landings.length]!, converge);
      place.set(scratch.x, scratch.y, scratch.z, alpha);
      glyph.set(RUNE_SIZE * (.55 + .45 * rise) * (1 - .32 * converge), .14 * Math.sin(i * 3.7 + f.elapsed * .9) * (1 - converge), 1 - .55 * converge, .4 * converge);
      // Embers trail each rune along its orbit and settle as it converges.
      for (let j = 0; j < 3; j++) {
        const lag = theta - (j + 1) * .15, fade = alpha * rise * (1 - converge) * (.5 - j * .13);
        ring(i, radius, lag, height - (j + 1) * .02);
        motes.push(scratch.x, scratch.y, scratch.z, colour.copy(EMBER).lerp(WARM, j / 3), fade);
      }
    }
  }

  function drawn(f: StageFrame, p: number, reduced: boolean) {
    look.visible = true;
    if (reduced) {
      look.dissolve = 1; look.reveal = smooth(.05, .7, p); look.ink = 1; look.inkAlpha = smooth(.45, .9, p);
      for (let i = 0; i < runeCount; i++) {
        const k = i / runeCount;
        ring(i, orbitRadius, startAngle + k * Math.PI * 2, orbitHeight);
        runes.place[i]!.set(scratch.x, scratch.y, scratch.z, .95 * (1 - smooth(0, .4, p)));
        runes.look[i]!.set(RUNE_SIZE, 0, 1, 0);
      }
      return;
    }
    look.dissolve = 0; look.reveal = smoother(.02, .62, p); look.ink = smoother(.42, .86, p); look.inkAlpha = 1;
    look.lock = Math.sin(Math.PI * clamp01((p - .8) / .2)) * .9;
    // A held, locked blueprint breathes slowly and never escalates.
    look.glow = 1 + .055 * Math.sin(f.elapsed * Math.PI * 2 / 6.5) * smooth(.9, 1, p);
    for (let i = 0; i < runeCount; i++) {
      const k = i / runeCount, landing = landings[i % landings.length]!;
      const fade = 1 - smooth(.02 + .1 * k, .2 + .12 * k, p);
      runes.place[i]!.set(landing.x, landing.y, landing.z, fade);
      runes.look[i]!.set(RUNE_SIZE * .68 * (1 - .4 * smooth(0, .25, p)), 0, .45 - .25 * smooth(0, .2, p), 1 - smooth(0, .3, p));
      // The snap: a few cool motes leap from where each rune lands.
      for (let j = 0; j < 3; j++) {
        const t = clamp01((p - (.02 + .1 * k)) / .4);
        if (t <= 0 || t >= 1) continue;
        const a = hash(i * 3 + j, 1) * Math.PI * 2, out = .08 + .42 * (1 - (1 - t) * (1 - t));
        motes.push(landing.x + Math.cos(a) * out, landing.y + .26 * t + (hash(i * 3 + j, 2) - .5) * .2, landing.z + Math.sin(a) * out, colour.copy(WARM).lerp(PALE, t), .95 * (1 - t));
      }
    }
    // Calm drifting motes rise around a finished blueprint for as long as it is held.
    const settled = smooth(.6, 1, p), drift = Math.min(14, motes.capacity - runeCount * 3);
    for (let i = 0; i < drift && settled > 0; i++) {
      const phase = (hash(i, 3) + f.elapsed * .045) % 1, angle = hash(i, 4) * Math.PI * 2 + f.elapsed * .12;
      const radius = reach * (.75 + .4 * hash(i, 5)) + .15;
      motes.push(anvil.x + Math.cos(angle) * radius, base + phase * (size.y * 1.15 + .2), anvil.z + Math.sin(angle) * radius, PALE, settled * .5 * Math.sin(Math.PI * phase));
    }
  }

  function render(f: StageFrame) {
    const reduced = environment.reducedMotion();
    if (f.ritualId !== ritual) {
      ritual = f.ritualId;
      const seed = ritualSeed(ritual);
      runeCount = 7 + (seed % 5); startAngle = ((seed >>> 8) % 360) * Math.PI / 180;
      runes.setGlyphs(seed, runeCount);
    }
    // The clone is not shown until molten metal fills it; the blueprint stands in its place.
    piece.visible = false;
    look.visible = false; look.reveal = 0; look.ink = 0; look.inkAlpha = 1; look.dissolve = reduced ? 1 : 0; look.glow = 1; look.lock = 0;
    for (const place of runes.place) place.w = 0;
    motes.begin();
    if (f.phase === 'words') words(f, reduced);
    // Later stages are not presented yet: they hold the locked blueprint and never imply a seal or strike.
    else drawn(f, f.phase === 'blueprint' ? f.progress : 1, reduced);
    motes.end();
    blueprint.set(look);
    let lit = false;
    for (const place of runes.place) lit ||= place.w > .001;
    runes.mesh.visible = lit;
  }

  function clear() {
    last = null;
    blueprint.set({ ...look, visible: false });
    runes.mesh.visible = false; motes.begin(); motes.end();
    piece.position.copy(saved.position); piece.quaternion.copy(saved.quaternion); piece.scale.copy(saved.scale); piece.visible = saved.visible;
  }

  const unsubscribe = environment.subscribe(() => { if (!disposed && last) render(last); });
  clear();

  return {
    update(frame) {
      if (disposed) return;
      if (frame === null) { clear(); return; }
      const read = readStageFrame(frame);
      // An untrustworthy frame never advances or clears the show; the last valid pose holds.
      if (!read) return;
      last = read;
      render(read);
    },
    dispose() {
      if (disposed) return;
      clear(); disposed = true; unsubscribe();
      root.remove(...owned);
      blueprint.dispose(); runes.dispose(); motes.dispose();
    },
  };
}
