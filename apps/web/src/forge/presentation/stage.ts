import * as THREE from 'three';
import { FORGE_STAGE_TIMING } from '@chatdom/forge';
import type { ForgePhase, ForgeRitualFrame } from '@chatdom/shared';
import { createBlueprint } from './blueprint';
import { createCellUniforms } from './cells';
import { backOut, clamp01, readStageFrame, ritualSeed, smooth, smoother, type StageFrame } from './frame';
import { createMotes } from './motes';
import { createCrucible, createHammer, createStream, CRUCIBLE, HAMMER } from './props';
import { createRunes, RUNE_SLOTS } from './runes';
import { createFlash, createSeal } from './seal';
import { createShell, SHELL_MODE, type ShellState } from './shell';
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
  onFlight?(frame: ForgeRitualFrame | null, position: Point3 | null, socket?: Point3): void;
}
export interface ForgePresentation { update(frame: ForgeRitualFrame | null): void; dispose(): void }
/** What the host device asks of motion and particle budgets. Tests and the bench supply fixed answers. */
export interface StageEnvironment {
  reducedMotion(): boolean;
  /** Returns an unsubscribe function; called again whenever the motion preference changes. */
  subscribe(listener: () => void): () => void;
  phone: boolean;
}

/** Transient particles per adapter (sparks + dust). The whole-adapter caps are 192 (desktop/stream) and 80 (phone). */
export const MOTE_BUDGET = { full: { sparks: 150, dust: 36 }, phone: { sparks: 60, dust: 18 } } as const;
/** Owned draws per adapter, and the most this adapter ever shows at once. Caps are 12 and 8 (phone). */
export const DRAW_BUDGET = { owned: 11, phone: 8 } as const;
const RUNE_SIZE = .17, LIFT = .05;
/** Within the strike, the moment the hammer meets the metal. */
export const IMPACT = .34;
/** Within the flight, the moment the part meets its socket. */
export const CONTACT = .9;
/** The hammer's wound-up angle (radians, about +z from horizontal). */
const RAISED = 2.06;
const WARM = new THREE.Color('#ffbf6b'), PALE = new THREE.Color('#cfeaff'), EMBER = new THREE.Color('#ff9a4a');
const WHITE_HOT = new THREE.Color('#fff2cf'), MOLTEN = new THREE.Color('#ff7a22'), RED = new THREE.Color('#d2401c'), POUR = new THREE.Color('#ffc65c');
const STEAM = new THREE.Color('#c9d3dc'), DUST = new THREE.Color('#bba98c'), SNAP = new THREE.Color('#ffd9a0');
const SECONDS = Object.fromEntries(FORGE_STAGE_TIMING.map(([phase, from, to]) => [phase, to - from])) as Record<ForgePhase, number>;
const GRAVITY = 7.5;

function point(value: Point3, name: string): THREE.Vector3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`The Forge presentation needs a finite ${name} point.`);
  return new THREE.Vector3(value[0], value[1], value[2]);
}
const hash = (i: number, salt: number) => { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); };
/** One smooth hump over [a, b]; exactly zero outside it. */
const pulse = (a: number, b: number, v: number) => v <= a || v >= b ? 0 : Math.sin(Math.PI * (v - a) / (b - a));

export function createForgeStage(options: ForgePresentationOptions, environment: StageEnvironment): ForgePresentation {
  const { root, piece } = options;
  const anvil = point(options.anvil, 'anvil'), landing = point(options.landing, 'landing');
  if (piece === root || piece.parent === root) throw new Error('The Forge presentation poses the host clone; it must not live under the effect root.');

  // Borrowed clone state, restored exactly on clear and dispose.
  const saved = { position: piece.position.clone(), quaternion: piece.quaternion.clone(), scale: piece.scale.clone(), visible: piece.visible };
  const silhouette = traceSilhouette(piece, RUNE_SLOTS);
  const socketPose = piece.matrixWorld.clone();
  const worldQuaternion = new THREE.Quaternion(), worldScale = new THREE.Vector3(), socketOrigin = new THREE.Vector3();
  socketPose.decompose(socketOrigin, worldQuaternion, worldScale);
  if (socketOrigin.distanceTo(landing) > .01) throw new Error('The Forge presentation needs the clone at its validated landing transform.');

  const cells = createCellUniforms(silhouette);
  const centre = silhouette.bounds.getCenter(new THREE.Vector3()), extent = silhouette.bounds.getSize(new THREE.Vector3());
  const footing = new THREE.Vector3(centre.x, silhouette.bounds.min.y, centre.z);

  // The blueprint, the molten shell and the cooling clone all stand on the anvil in the clone's own final
  // orientation and scale, so the anvil pose and the socket pose differ only by where they stand.
  const blueprint = createBlueprint(silhouette, cells);
  blueprint.object.quaternion.copy(worldQuaternion); blueprint.object.scale.copy(worldScale);
  blueprint.object.position.copy(anvil).add(new THREE.Vector3(0, LIFT, 0)).sub(footing.clone().multiply(worldScale).applyQuaternion(worldQuaternion));
  blueprint.object.updateMatrix();
  const anvilPose = blueprint.object.matrix.clone();
  const landings = (silhouette.landings.length ? silhouette.landings : [centre]).map(p => p.clone().applyMatrix4(anvilPose));
  const size = extent.clone().multiply(worldScale);
  const reach = Math.max(size.x, size.z) * .5, base = anvil.y + LIFT;
  const orbitRadius = Math.max(1.3, reach + .62), orbitHeight = base + THREE.MathUtils.clamp(size.y * .5, .45, 1.4);

  // The strike lands on the part's highest face nearest its middle; the pour falls onto its centre.
  let strikeLocal = centre.clone().setY(silhouette.bounds.max.y);
  {
    let best = Infinity;
    const p = silhouette.positions, n = silhouette.normals;
    for (let i = 0; i < p.length; i += 9) {
      if (n[i + 1]! < .9) continue;
      const x = (p[i]! + p[i + 3]! + p[i + 6]!) / 3, y = p[i + 1]!, z = (p[i + 2]! + p[i + 5]! + p[i + 8]!) / 3;
      const score = (silhouette.bounds.max.y - y) * 3 + Math.hypot(x - centre.x, z - centre.z);
      if (score < best) { best = score; strikeLocal = new THREE.Vector3(x, y, z); }
    }
  }
  const strike = strikeLocal.clone().applyMatrix4(anvilPose);
  const shell = createShell(blueprint.body, cells, strikeLocal);
  // The hammer and crucible are sized to the part, so a tall chimney gets a smith's hammer, not a toy tack hammer.
  const heft = THREE.MathUtils.clamp(Math.max(size.y, reach * 2) / 1.5, 1, 1.8);
  const top = centre.clone().setY(silhouette.bounds.max.y).applyMatrix4(anvilPose);
  const lip = new THREE.Vector3(top.x, top.y + .9 * Math.sqrt(heft), top.z);
  const pivot = strike.clone().add(new THREE.Vector3(-HAMMER.reach * heft, HAMMER.head * heft / 2, 0));
  const middle = centre.clone().applyMatrix4(anvilPose);
  const sealPlace = new THREE.Vector3(middle.x, base + size.y * .3, middle.z);

  // The flight: straight up off the anvil, over in one arc, straight down onto the socket.
  const from = footing.clone().applyMatrix4(anvilPose), to = footing.clone().applyMatrix4(socketPose);
  const span = from.distanceTo(to), crest = Math.max(from.y, to.y) + THREE.MathUtils.clamp(span * .32, 2.4, 9);
  const arc = new THREE.CubicBezierCurve3(from, new THREE.Vector3(from.x, crest, from.z), new THREE.Vector3(to.x, crest, to.z), to);
  const travel = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize(), bankAxis = new THREE.Vector3(0, 1, 0).cross(travel).normalize();
  if (!Number.isFinite(bankAxis.x) || bankAxis.lengthSq() < .5) bankAxis.set(1, 0, 0);

  const phone = environment.phone, budget = phone ? MOTE_BUDGET.phone : MOTE_BUDGET.full;
  const share = (n: number) => phone ? Math.max(1, Math.round(n * .42)) : n;
  const runes = createRunes(), sparks = createMotes(budget.sparks, 'forge-motes', { size: .05 * Math.sqrt(heft) }), dust = createMotes(budget.dust, 'forge-dust', { size: .085 * Math.sqrt(heft), additive: false });
  const crucible = createCrucible(), stream = createStream(), hammer = createHammer(), seal = createSeal(), flash = createFlash();
  const owned = [blueprint.object, shell.mesh, crucible.mesh, stream.mesh, hammer.mesh, runes.mesh, sparks.points, dust.points, seal.mesh, flash.mesh];
  root.add(...owned);

  let ritual = '', runeCount = 0, startAngle = 0, last: StageFrame | null = null, disposed = false;
  const scratch = new THREE.Vector3(), colour = new THREE.Color(), pose = new THREE.Matrix4(), parentInverse = new THREE.Matrix4();
  const squashMatrix = new THREE.Matrix4(), shift = new THREE.Matrix4(), struck = new THREE.Matrix4();
  const spinQuaternion = new THREE.Quaternion(), bankQuaternion = new THREE.Quaternion(), rotation = new THREE.Quaternion();
  let shellPose = anvilPose;
  const up = new THREE.Vector3(0, 1, 0), along = new THREE.Vector3(), velocity = new THREE.Vector3();
  const look = { visible: false, reveal: 0, ink: 0, inkAlpha: 1, bodyAlpha: 1, dissolve: 0, glow: 1, lock: 0 };
  const shellState: ShellState = { visible: false, mode: SHELL_MODE.molten, cool: 0, flash: 0, cover: 0, vanish: 0, time: 0 };
  const sealState = { visible: false, place: sealPlace, side: reach + 1.25, below: size.y * .5 + .75, alpha: 0, stamp: 0, emboss: 0, hot: 0, ribbon: 0, live: false };

  const ring = (radius: number, angle: number, height: number) =>
    scratch.set(anvil.x + Math.cos(angle) * radius, height, anvil.z + Math.sin(angle) * radius);

  /** base · T(footing) · squash · T(−footing): a squash that keeps the part's foot planted. */
  function squashed(base: THREE.Matrix4, k: number, out: THREE.Matrix4) {
    if (k === 0) return out.copy(base);
    squashMatrix.makeScale(1 + k * .5, 1 - k, 1 + k * .5);
    shift.makeTranslation(footing.x, footing.y, footing.z);
    out.copy(base).multiply(shift).multiply(squashMatrix);
    return out.multiply(shift.makeTranslation(-footing.x, -footing.y, -footing.z));
  }
  /** Poses the borrowed clone at a world matrix without reparenting it. */
  function placePiece(world: THREE.Matrix4) {
    const parent = piece.parent;
    if (parent) { parent.updateWorldMatrix(true, false); parentInverse.copy(parent.matrixWorld).invert(); pose.multiplyMatrices(parentInverse, world); } else pose.copy(world);
    pose.decompose(piece.position, piece.quaternion, piece.scale);
  }
  function restorePiece() { piece.position.copy(saved.position); piece.quaternion.copy(saved.quaternion); piece.scale.copy(saved.scale); }

  function words(f: StageFrame, reduced: boolean) {
    const p = f.progress;
    for (let i = 0; i < runeCount; i++) {
      const k = i / runeCount, start = .04 + .3 * k, angle = startAngle + k * Math.PI * 2;
      const alpha = smooth(start, start + .14, p), place = runes.place[i]!, glyph = runes.look[i]!;
      if (reduced) {
        // Same stage, no circling: the runes surface in place around the anvil.
        ring(orbitRadius, angle, orbitHeight);
        place.set(scratch.x, scratch.y, scratch.z, alpha * .95);
        glyph.set(RUNE_SIZE, 0, 1, 0);
        continue;
      }
      const rise = smoother(start, start + .36, p), converge = smoother(.72 + .06 * k, 1, p);
      const theta = angle + .85 * f.elapsed, radius = THREE.MathUtils.lerp(.42, orbitRadius, backOut(rise));
      const height = THREE.MathUtils.lerp(base + .06, orbitHeight + .16 * Math.sin(i * 2.1), rise) + .07 * Math.sin(f.elapsed * 1.6 + i * 1.3) * rise;
      ring(radius, theta, height).lerp(landings[i % landings.length]!, converge);
      place.set(scratch.x, scratch.y, scratch.z, alpha);
      glyph.set(RUNE_SIZE * (.55 + .45 * rise) * (1 - .32 * converge), .14 * Math.sin(i * 3.7 + f.elapsed * .9) * (1 - converge), 1 - .55 * converge, .4 * converge);
      // Embers trail each rune along its orbit and settle as it converges.
      for (let j = 0; j < 3; j++) {
        const lag = theta - (j + 1) * .15, fade = alpha * rise * (1 - converge) * (.5 - j * .13);
        ring(radius, lag, height - (j + 1) * .02);
        sparks.push(scratch.x, scratch.y, scratch.z, colour.copy(EMBER).lerp(WARM, j / 3), fade);
      }
    }
  }

  /** The blueprint at progress `p`; `drift` adds the calm motes of a finished, held drawing. */
  function drawn(f: StageFrame, p: number, reduced: boolean, drift: boolean) {
    look.visible = true;
    if (reduced) {
      look.dissolve = 1; look.reveal = smooth(.05, .7, p); look.ink = 1; look.inkAlpha = smooth(.45, .9, p);
      for (let i = 0; i < runeCount; i++) {
        const k = i / runeCount;
        ring(orbitRadius, startAngle + k * Math.PI * 2, orbitHeight);
        runes.place[i]!.set(scratch.x, scratch.y, scratch.z, .95 * (1 - smooth(0, .4, p)));
        runes.look[i]!.set(RUNE_SIZE, 0, 1, 0);
      }
      return;
    }
    look.dissolve = 0; look.reveal = smoother(.02, .62, p); look.ink = smoother(.42, .86, p); look.inkAlpha = 1;
    look.lock = Math.sin(Math.PI * clamp01((p - .8) / .2)) * .9;
    // A held, locked blueprint breathes slowly and never escalates.
    if (drift) look.glow = 1 + .055 * Math.sin(f.elapsed * Math.PI * 2 / 6.5) * smooth(.9, 1, p);
    if (p >= 1) return;
    for (let i = 0; i < runeCount; i++) {
      const k = i / runeCount, at = landings[i % landings.length]!;
      const fade = 1 - smooth(.02 + .1 * k, .2 + .12 * k, p);
      runes.place[i]!.set(at.x, at.y, at.z, fade);
      runes.look[i]!.set(RUNE_SIZE * .68 * (1 - .4 * smooth(0, .25, p)), 0, .45 - .25 * smooth(0, .2, p), 1 - smooth(0, .3, p));
      // The snap: a few cool motes leap from where each rune lands.
      for (let j = 0; j < 3; j++) {
        const t = clamp01((p - (.02 + .1 * k)) / .4);
        if (t <= 0 || t >= 1) continue;
        const a = hash(i * 3 + j, 1) * Math.PI * 2, out = .08 + .42 * (1 - (1 - t) * (1 - t));
        sparks.push(at.x + Math.cos(a) * out, at.y + .26 * t + (hash(i * 3 + j, 2) - .5) * .2, at.z + Math.sin(a) * out, colour.copy(WARM).lerp(PALE, t), .95 * (1 - t));
      }
    }
  }
  function driftMotes(f: StageFrame, settled: number) {
    // Calm drifting motes rise around a finished blueprint for as long as it is held.
    for (let i = 0; i < share(14) && settled > 0; i++) {
      const phase = (hash(i, 3) + f.elapsed * .045) % 1, angle = hash(i, 4) * Math.PI * 2 + f.elapsed * .12;
      const radius = reach * (.75 + .4 * hash(i, 5)) + .15;
      sparks.push(anvil.x + Math.cos(angle) * radius, base + phase * (size.y * 1.15 + .2), anvil.z + Math.sin(angle) * radius, PALE, settled * .5 * Math.sin(Math.PI * phase));
    }
  }

  /** The surface of the molten metal, in world metres, for a given fill. */
  function fillSurface(fill: number) {
    const local = silhouette.bounds.min.y + Math.min(extent.y, fill * (cells.uLayers.value + .6) * silhouette.cell);
    return scratch.set(centre.x, local, centre.z).applyMatrix4(anvilPose).y;
  }

  function pour(f: StageFrame, reduced: boolean) {
    const p = f.progress, fill = smooth(.1, .9, p);
    cells.uFill.value = fill;
    // The crucible arrives above the part, tips, pours, rights itself and leaves.
    const arrive = smoother(0, .1, p), leave = smoother(.94, 1, p);
    const tilt = CRUCIBLE.tilt * smoother(.06, .16, p) * (1 - smoother(.86, .95, p));
    crucible.mesh.visible = leave < 1;
    crucible.mesh.position.set(lip.x, lip.y + .55 * (1 - arrive) + .7 * leave, lip.z);
    crucible.mesh.rotation.set(0, 0, reduced ? tilt * .6 : tilt);
    crucible.mesh.scale.setScalar((1 - .35 * leave) * Math.sqrt(heft));
    crucible.material.opacity = arrive * (1 - leave);
    // The stream runs from the lip to the rising surface: its head falls in, its tail falls away.
    const surface = fillSurface(fill), drop = Math.max(.05, lip.y - surface);
    const head = smooth(.11, .16, p), tail = smooth(.89, .94, p);
    stream.begin();
    if (head > 0 && tail < 1) {
      for (let i = 0; i < 26; i++) {
        const phase = reduced ? (i + .5) / 26 : (i / 26 + f.elapsed * 1.7) % 1, fall = phase * phase;
        if (fall > head || fall < tail) continue;
        const width = .018 + .05 * fall, a = i * 2.39996;
        colour.copy(POUR).lerp(MOLTEN, .25 + .6 * fall).multiplyScalar(1.15 - .2 * fall);
        stream.push(lip.x + Math.cos(a) * width, lip.y - drop * fall, lip.z + Math.sin(a) * width, silhouette.cell * worldScale.y * (.95 - .35 * fall), a + phase * 5, colour);
      }
    }
    stream.end();
    // Embers spit where the stream meets the surface.
    const spitting = head * (1 - tail);
    if (!reduced && spitting > 0) {
      for (let i = 0; i < share(18); i++) {
        const phase = (hash(i, 7) + f.elapsed * (.9 + .7 * hash(i, 8))) % 1, t = phase * .6, a = hash(i, 9) * Math.PI * 2;
        const out = .5 + .9 * hash(i, 10);
        sparks.push(lip.x + Math.cos(a) * out * t, surface + (1.5 + 1.2 * hash(i, 11)) * t - .5 * GRAVITY * t * t, lip.z + Math.sin(a) * out * t,
          colour.copy(WHITE_HOT).lerp(EMBER, phase), spitting * (1 - phase) * .95);
      }
    }
  }

  /** The hammer at angle `a` about its pivot, faded by `alpha`. */
  function hammerAt(a: number, alpha: number) {
    hammer.mesh.visible = alpha > .002;
    hammer.mesh.position.copy(pivot); hammer.mesh.rotation.set(0, 0, a); hammer.mesh.scale.setScalar(heft);
    hammer.material.opacity = alpha;
  }

  /** The strike's sparks, `t` seconds after impact: a fixed, seeded burst under gravity. */
  function burst(t: number) {
    if (t < 0) return;
    for (let i = 0; i < share(46); i++) {
      const life = .45 + .55 * hash(i, 12);
      if (t >= life) continue;
      const a = hash(i, 13) * Math.PI * 2, lift = .25 + .75 * hash(i, 14), speed = 2.2 + 2.6 * hash(i, 15);
      velocity.set(Math.cos(a) * (1 - lift * .6), lift, Math.sin(a) * (1 - lift * .6)).normalize().multiplyScalar(speed);
      const age = t / life;
      sparks.push(strike.x + velocity.x * t, strike.y + velocity.y * t - .5 * GRAVITY * t * t, strike.z + velocity.z * t,
        colour.copy(WHITE_HOT).lerp(MOLTEN, smooth(0, .5, age)).lerp(RED, smooth(.5, 1, age)), 1 - age * age);
    }
  }

  function sealAt(phase: ForgePhase, p: number, f: StageFrame, reduced: boolean) {
    sealState.visible = true; sealState.live = f.live;
    if (phase !== 'seal') {
      sealState.alpha = phase === 'cool' ? 1 - smooth(.7, 1, p) : 1;
      sealState.stamp = 1; sealState.emboss = 1; sealState.hot = 0; sealState.ribbon = 1;
      return;
    }
    if (reduced) {
      sealState.alpha = smooth(0, .35, p); sealState.stamp = 1; sealState.emboss = 1; sealState.hot = 0; sealState.ribbon = 1;
      return;
    }
    // A warm bead of wax, the press, a settle; then the ribbon unrolls.
    const bead = backOut(smooth(0, .18, p)) * .72, press = smooth(.22, .36, p);
    sealState.alpha = smooth(0, .08, p);
    sealState.stamp = p < .22 ? bead : p < .36 ? THREE.MathUtils.lerp(1.55, .92, press * press) : THREE.MathUtils.lerp(.92, 1, backOut(smooth(.36, .52, p)));
    sealState.emboss = smooth(.34, .4, p); sealState.hot = 1 - smooth(.36, .75, p); sealState.ribbon = smoother(.42, .8, p);
  }

  function render(f: StageFrame) {
    const reduced = environment.reducedMotion();
    if (f.ritualId !== ritual) {
      ritual = f.ritualId;
      const seed = ritualSeed(ritual);
      runeCount = 7 + (seed % 5); startAngle = ((seed >>> 8) % 360) * Math.PI / 180;
      runes.setGlyphs(seed, runeCount);
    }
    const phase = f.phase, p = f.progress, later = (of: ForgePhase) => FORGE_STAGE_TIMING.findIndex(s => s[0] === phase) >= FORGE_STAGE_TIMING.findIndex(s => s[0] === of);
    // Every owned value is set on every frame, so any sampling interval or seek draws the same picture.
    piece.visible = false; restorePiece();
    look.visible = false; look.reveal = 0; look.ink = 0; look.inkAlpha = 1; look.bodyAlpha = 1; look.dissolve = reduced ? 1 : 0; look.glow = 1; look.lock = 0;
    cells.uFill.value = later('seal') ? 1 : 0;
    Object.assign(shellState, { visible: false, mode: SHELL_MODE.molten, cool: 0, flash: 0, cover: 0, vanish: 0, time: f.elapsed });
    sealState.visible = false; sealState.alpha = 0;
    for (const place of runes.place) place.w = 0;
    // Props at rest between appearances, so a hidden prop never carries an earlier frame's pose.
    crucible.mesh.visible = false; crucible.mesh.position.copy(lip); crucible.mesh.rotation.set(0, 0, 0); crucible.mesh.scale.setScalar(1); crucible.material.opacity = 0;
    hammerAt(RAISED, 0);
    shellPose = anvilPose;
    flash.set(false, strike, 1, 0, 0, 0, WHITE_HOT);
    sparks.begin(); dust.begin(); stream.begin(); stream.end();

    if (phase === 'words') words(f, reduced);
    else if (phase === 'blueprint') { drawn(f, p, reduced, true); if (!reduced) driftMotes(f, smooth(.6, 1, p)); }
    else if (phase === 'pour') {
      // The drawing gives way to the rising metal as the stream arrives.
      drawn(f, 1, reduced, false);
      pour(f, reduced);
      look.bodyAlpha = 1 - smooth(.06, .2, p);
      look.inkAlpha = 1 - smooth(.06, .23, p);
      look.visible = look.inkAlpha > .001 || look.bodyAlpha > .001;
      shellState.visible = true;
    } else if (phase === 'seal' || phase === 'strike') {
      shellState.visible = true;
      sealAt(phase, p, f, reduced);
      if (phase === 'seal') {
        // Anticipation: the hammer rises into view and winds up, then waits; it never strikes on its own.
        const rise = smoother(.55, .75, p), wind = smoother(.72, 1, p);
        const hover = reduced ? 0 : .025 * Math.sin(f.elapsed * 1.7) * smooth(.95, 1, p);
        if (!reduced) hammerAt(THREE.MathUtils.lerp(1.2, RAISED, wind) + hover, rise);
      } else if (reduced) {
        hammerAt(0, smooth(0, .3, p));
        shellState.flash = .35 * pulse(IMPACT - .1, 1, p);
      } else {
        const down = clamp01(p / IMPACT), after = p - IMPACT;
        const a = p < IMPACT ? RAISED * (1 - Math.pow(down, 2.3)) : p < .5 ? .24 * Math.sin(Math.PI * after / (.5 - IMPACT)) : .3 * smooth(.6, 1, p);
        hammerAt(a, 1);
        if (after >= 0) {
          const k = .05 * pulse(IMPACT, IMPACT + .24, p);
          shellPose = squashed(anvilPose, k, struck);
          shellState.flash = Math.exp(-after * 7);
          flash.set(true, strike, 1.5, 1.35 * Math.exp(-after * 13), .18 + .82 * smooth(0, .66, after), .85 * (1 - smooth(0, .66, after)), WHITE_HOT);
          burst(after * SECONDS.strike);
        }
      }
    } else if (phase === 'cool') {
      // The real clone takes the anvil; its heat lies over it and gives way to the kingdom's colours.
      placePiece(anvilPose); piece.visible = true;
      Object.assign(shellState, { visible: true, mode: SHELL_MODE.heat, cool: p });
      sealAt(phase, p, f, reduced);
      const away = smoother(0, .32, p);
      if (reduced) hammerAt(0, 1 - smooth(0, .3, p));
      else {
        hammerAt(.3 + 1.2 * away, 1 - smooth(.12, .32, p));
        burst((1 - IMPACT) * SECONDS.strike + p * SECONDS.cool);
      }
      // Steam leaves the cooling faces; a few bright ticks pop as the skin contracts.
      for (let i = 0; i < share(16); i++) {
        const t = p * SECONDS.cool - hash(i, 18) * 1.6, life = 1.3;
        if (t < 0 || t > life) continue;
        const at = landings[i % landings.length]!, k = t / life;
        dust.push(at.x + (hash(i, 19) - .5) * .3 * k, at.y + .1 + .7 * k, at.z + (hash(i, 20) - .5) * .3 * k, STEAM, .38 * Math.sin(Math.PI * k) * (1 - p * .4));
      }
      for (let i = 0; i < share(10); i++) {
        const at = landings[(i * 3 + 1) % landings.length]!, tick = .12 + .7 * hash(i, 21);
        const glint = 1 - Math.abs(p - tick) / .035;
        if (glint > 0) sparks.push(at.x, at.y + .03, at.z, WHITE_HOT, glint);
      }
    } else if (phase === 'flight') flight(f, reduced);
    else {
      // Landed: flush on the socket at its validated transform; the dust of arrival settles.
      piece.visible = true;
      if (!reduced) arrival((1 - CONTACT) * SECONDS.flight + p * SECONDS.landed);
    }

    shell.set(shellState, shellPose);
    seal.set(sealState);
    blueprint.set(look);
    sparks.end(); dust.end();
    let lit = false;
    for (const place of runes.place) lit ||= place.w > .001;
    runes.mesh.visible = lit;
  }

  /** Dust and a soft warm ring where the part met its socket, `t` seconds after contact. */
  function arrival(t: number) {
    const ringAt = scratch.copy(to);
    flash.set(t < .6, ringAt, Math.max(.9, reach * 1.6), .55 * Math.exp(-t * 9), .25 + .75 * smooth(0, .6, t), .55 * (1 - smooth(0, .6, t)), SNAP);
    for (let i = 0; i < share(24); i++) {
      const life = .9 + .6 * hash(i, 22);
      if (t >= life) continue;
      const a = (i / 24) * Math.PI * 2 + hash(i, 23) * .4, k = t / life, out = reach * .8 + .2 + (1.1 + .6 * hash(i, 24)) * (1 - (1 - k) * (1 - k)) * .7;
      dust.push(to.x + Math.cos(a) * out, to.y + .05 + .35 * k * hash(i, 25), to.z + Math.sin(a) * out, DUST, .7 * (1 - k));
    }
  }

  function flight(f: StageFrame, reduced: boolean) {
    const p = f.progress;
    if (reduced) {
      // No streak and no flash: the part dissolves into light on the anvil and settles out of light at home.
      const atHome = p >= .5;
      piece.visible = atHome ? p >= .8 : p < .3;
      if (piece.visible) { if (atHome) restorePiece(); else placePiece(anvilPose); }
      Object.assign(shellState, atHome
        ? { visible: p < 1, mode: SHELL_MODE.light, cover: smooth(.55, .78, p), vanish: smooth(.8, .98, p) }
        : { visible: p < .45, mode: SHELL_MODE.light, cover: smooth(0, .28, p), vanish: smooth(.3, .45, p) });
      shellPose = atHome ? socketPose : anvilPose;
      return;
    }
    piece.visible = true;
    if (p >= CONTACT) {
      // Contact: the final millimetre lands flush on the socket, with a short planted squash and no rebound.
      squashed(socketPose, .06 * pulse(CONTACT, 1, p), pose);
      if (p >= 1) restorePiece(); else placePiece(pose);
      arrival((p - CONTACT) * SECONDS.flight);
      return;
    }
    // A crouch, then up, over and down: the arc accelerates into the socket so the arrival has weight.
    const crouch = .05 * pulse(0, .1, p), u = clamp01((p - .06) / (CONTACT - .06)), s = (3 * u * u - u * u * u) / 2;
    arc.getPoint(s, along);
    const spin = Math.PI * 2 * smoother(.1, .8, p), bank = .2 * Math.sin(Math.PI * u);
    spinQuaternion.setFromAxisAngle(up, spin); bankQuaternion.setFromAxisAngle(bankAxis, bank);
    rotation.copy(worldQuaternion).multiply(spinQuaternion).premultiply(bankQuaternion);
    pose.compose(along, rotation, worldScale);
    pose.multiply(shift.makeTranslation(-footing.x, -footing.y, -footing.z));
    if (crouch > 0) squashed(anvilPose, crouch, pose);
    placePiece(pose);
    // A short warm trail marks where it has been.
    for (let i = 1; !options.onFlight && i <= share(16) && u > 0; i++) {
      const back = s - i * .012;
      if (back <= 0) break;
      arc.getPoint(back, scratch);
      sparks.push(scratch.x + (hash(i, 26) - .5) * .25, scratch.y + size.y * (.2 + .5 * hash(i, 27)), scratch.z + (hash(i, 28) - .5) * .25,
        colour.copy(WARM).lerp(EMBER, i / 16), (1 - i / 17) * .8 * Math.sin(Math.PI * u));
    }
  }

  function clear() {
    options.onFlight?.(null, null);
    last = null;
    cells.uFill.value = 0;
    blueprint.set({ ...look, visible: false });
    shell.set({ ...shellState, visible: false }, anvilPose);
    seal.set({ ...sealState, visible: false });
    flash.set(false, strike, 1, 0, 0, 0, WHITE_HOT);
    runes.mesh.visible = false; crucible.mesh.visible = false; hammer.mesh.visible = false;
    sparks.begin(); sparks.end(); dust.begin(); dust.end(); stream.begin(); stream.end();
    restorePiece(); piece.visible = saved.visible;
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
      if (options.onFlight) {
        if (!environment.reducedMotion() && (read.phase === 'flight' || read.phase === 'landed')) {
          piece.updateWorldMatrix(true, false);
          const world = centre.clone().setY(silhouette.bounds.max.y + .15).applyMatrix4(piece.matrixWorld);
          options.onFlight(frame, [world.x, world.y, world.z], options.landing);
        } else options.onFlight(null, null);
      }
    },
    dispose() {
      if (disposed) return;
      clear(); disposed = true; unsubscribe();
      root.remove(...owned);
      blueprint.dispose(); shell.dispose(); runes.dispose(); sparks.dispose(); dust.dispose();
      crucible.dispose(); stream.dispose(); hammer.dispose(); seal.dispose(); flash.dispose();
    },
  };
}
