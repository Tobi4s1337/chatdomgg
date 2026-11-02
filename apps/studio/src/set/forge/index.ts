// The Forge ritual set piece (S11): the wish "a chimney shaped like a sleeping dragon" forged on main's anvil,
// from the runes rising off it to the hammer strike, staged by read-only import of the product's ritual
// presentation and shot like a film. Shot time is ritual time; every pose is a function of it.
//
//   /studio/set.html?scene=forge&shot=S11[&from=<seconds>][&hour=19.5][&quality=high|capture|balanced|low|none]
//   framing checks: &eye=x,y,z&look=x,y,z&fov=deg (metres from the anvil's top centre) fixes the lens
//
// `window.__set.idle()` is true once the world is built (every mesh installed, shaders compiled) and the frame on
// screen was drawn at the current shot time. Nothing loads after ready: the light volume is solved on the spot.
import * as THREE from 'three';
import { shotClock } from '../contract';
import { sampleCamera } from './camera';
import { SHOTS } from './shots';
import { createForgeWorld } from './world';
import type { PostQuality } from '../../../../../packages/render/src/index';

/** A fixed ritual id: it seeds which authored runes appear (ten here) and where they start on the ring. */
const RITUAL_ID = 'teaser-dragon';
const QUALITIES = ['high', 'capture', 'balanced', 'low', 'none'] as const;

function triple(raw: string | null): [number, number, number] | null {
  if (raw === null) return null;
  const v = raw.split(',').map(Number);
  if (v.length !== 3 || !v.every(Number.isFinite)) throw new Error(`expected x,y,z metres, got ${raw}`);
  return [v[0]!, v[1]!, v[2]!];
}

export async function start(query: URLSearchParams, canvas: HTMLCanvasElement): Promise<void> {
  const shot = SHOTS[query.get('shot') ?? 'S11'];
  if (!shot) throw new Error(`the forge set has no shot ${query.get('shot')}; it has ${Object.keys(SHOTS).join(', ')}`);
  const offset = Number(query.get('from') ?? 0);
  const hour = Number(query.get('hour') ?? 19.5);
  const quality = (query.get('quality') ?? 'high') as PostQuality | 'none';
  if (!Number.isFinite(offset) || !Number.isFinite(hour) || !(QUALITIES as readonly string[]).includes(quality)) throw new Error('bad from, hour or quality');
  const fixedEye = triple(query.get('eye')), fixedLook = triple(query.get('look'));
  const fixedFov = query.has('fov') ? Number(query.get('fov')) : null;

  const world = await createForgeWorld(canvas, { ritualId: RITUAL_ID, hour, family: 'hearth', quality });
  const clock = shotClock(offset);
  const fit = () => world.resize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), window.devicePixelRatio || 1);
  fit();

  const eye = new THREE.Vector3(), look = new THREE.Vector3();
  let drawnAt: number | null = null;
  function draw(t: number) {
    const lens = sampleCamera(shot!.keys, t);
    eye.copy(world.anvil).add(fixedEye ? new THREE.Vector3(...fixedEye) : lens.eye);
    look.copy(world.anvil).add(fixedLook ? new THREE.Vector3(...fixedLook) : lens.look);
    world.camera.fov = fixedFov ?? lens.fov;
    world.camera.position.copy(eye);
    world.camera.lookAt(look);
    world.camera.updateProjectionMatrix();
    world.draw(shot!.ritual + t, eye.distanceTo(look));
    drawnAt = t;
  }

  // Shaders compile on first draw. Never compileAsync: without parallel compile it polls on a timer, which the
  // virtual clock holds still during loading.
  draw(offset);
  draw(offset);
  window.addEventListener('resize', () => { fit(); draw(clock.t()); });
  const loop = () => { draw(clock.t()); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  clock.begin();
  window.__set = {
    scene: 'forge',
    duration: shot.duration,
    canvas,
    idle: () => clock.started() && drawnAt === clock.t(),
    t: clock.t,
    stats: () => ({ shot: shot.id, moments: shot.moments, ritualId: RITUAL_ID, hour, quality, t: clock.t(), ...world.stats() }),
  };
  window.__chatdomReady = true;
}
