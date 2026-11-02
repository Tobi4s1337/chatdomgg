// The growth set piece (S13): the product's growth stage, staged by read-only import, watched from one locked camera
// while the town grows in seconds. The history, ledger and score are built exactly as the growth sequence builds
// them; this page only chooses which slice of the score each shot time shows, and holds the camera still.
//
//   /studio/set.html?scene=growth&shot=S13[&from=2.5][&hour=19.6]
//
// Time-lapse: the growth (neighbours settling, the quarter's streets, homes and windows) runs on the shot's eased
// slice of the sequence, about four times its own pace; the living air (smoke, water, leaves, fireflies) keeps
// its ordinary pace, as it does in the product's own sequence.
//
// `window.__set.idle()` is true once the light fields have solved for the frame at the current t and that frame
// has been drawn again with them, so the recorder never captures stale window light.
import * as THREE from 'three';
import { shotClock } from '../contract';
import { simulateGrowthHistory } from '../../../../web/src/growth/history';
import { createCeremonyLedger, createRecordedGrowthFeed, type GrowthCeremony } from '../../../../web/src/growth/ledger';
import { composeScore, sampleScore, type GrowthScore, type Shot } from '../../../../web/src/growth/score';
import { createGrowthStage, type GrowthStage } from '../../../../web/src/growth/stage/stage';
import { neighbourHistory, planGrowthTown } from '../../../../web/src/growth/town';
import type { GrowthSceneFrame } from '../../../../../packages/shared/src/growth';
import { SHOTS, sequenceTime, type Anchor, type GrowthShot } from './shots';

/** The growth sequence's own town and year: the same kingdom the product's sequence shows. */
const SEED = 'hearthmoor', TOWN_YEAR = 2025;

function buildScore(): { score: GrowthScore; town: ReturnType<typeof planGrowthTown> } {
  const town = planGrowthTown(SEED, TOWN_YEAR);
  const history = simulateGrowthHistory({ heroPlotId: town.hero.id, neighbours: neighbourHistory(town) });
  // The stage hears the history only through the feed contract and the ledger, as the product's sequence does.
  const ledger = createCeremonyLedger(), owed: GrowthCeremony[] = [];
  let bootstrap: GrowthSceneFrame | undefined, latest: GrowthSceneFrame | undefined, failed = false;
  const stop = createRecordedGrowthFeed(history.frames).subscribe(frame => {
    const update = ledger.accept(frame);
    if (!update.accepted) return;
    bootstrap ??= frame; latest = frame; owed.push(...update.ceremonies);
  }, () => { failed = true; });
  stop();
  if (failed || !bootstrap || !latest) throw new Error('The growth history could not be read.');
  const turned = new Date(latest.asOf).getUTCFullYear() > TOWN_YEAR;
  const openedAt = history.frames.find(frame => new Date(frame.asOf).getUTCFullYear() > TOWN_YEAR)?.asOf ?? latest.asOf;
  const score = composeScore({ heroPlotId: town.hero.id, street: town.hero.street, bootstrap, ceremonies: owed,
    quarter: turned ? { name: town.quarter.name, year: town.quarter.year, openedAt } : null });
  return { score, town };
}

function anchor(score: GrowthScore, at: Anchor): number {
  const act = score.acts.filter(item => item.kind === at.act)[at.index ?? 0];
  if (!act) throw new Error(`The growth score has no ${at.act} act.`);
  return act.start + at.at;
}

/**
 * The stage caps its pixel ratio at 1.5 for players' GPUs; a film plate wants every device pixel (4K takes run at
 * device scale 2). While the stage builds its renderer, let it take the page's full ratio.
 */
async function withFullPixelRatio<T>(build: () => Promise<T>): Promise<T> {
  const proto = THREE.WebGLRenderer.prototype as unknown as { setPixelRatio(value: number): void };
  const original = proto.setPixelRatio;
  proto.setPixelRatio = function (this: THREE.WebGLRenderer) { original.call(this, window.devicePixelRatio || 1); };
  try { return await build(); } finally { proto.setPixelRatio = original; }
}

/**
 * The held camera: the shot's own, or `?cam=` to try another of the stage's poses (`wide`, `quarter`, or a held
 * point between two of them, `wide-quarter:0.4`, optionally `@local` for where along their drift it is held).
 */
function cameraFor(own: GrowthShot['camera'], param: string | null): { from: Shot; to: Shot; blend: number; local: number } {
  if (!param) return { ...own };
  const match = /^(wide|quarter)(?:-(wide|quarter):([0-9.]+))?(?:@([0-9.]+))?$/.exec(param);
  if (!match) throw new Error(`Unknown growth camera ${param}.`);
  const pose = (kind: string): Shot => kind === 'wide' ? { kind: 'wide', drift: 0 } : { kind: 'quarter', drift: 0 };
  const from = pose(match[1]!), to = match[2] ? pose(match[2]) : from;
  return { from, to, blend: match[3] ? Math.min(1, Number(match[3])) : 1, local: Number(match[4] ?? 0) };
}

export async function start(query: URLSearchParams, canvas: HTMLCanvasElement): Promise<void> {
  const shot = SHOTS[query.get('shot') ?? 'S13'];
  if (!shot) throw new Error(`The growth set has no shot ${query.get('shot')}.`);
  const hourParam = Number(query.get('hour'));
  const hour = query.has('hour') && Number.isFinite(hourParam) ? hourParam : shot.hour;
  const clock = shotClock(Number(query.get('from') ?? 0) || 0);

  const { score, town } = buildScore();
  const keys = shot.keys.map(key => ({ t: key.t, at: anchor(score, key.at) }));
  const from = keys[0]!.at, at = (t: number) => sequenceTime(keys, shot.endPace, t);
  const abort = new AbortController();
  const stage: GrowthStage = await withFullPixelRatio(() => createGrowthStage({ canvas, town, hour, signal: abort.signal, onProgress: () => {} }));
  const held = cameraFor(shot.camera, query.get('cam'));
  const camera = { ...held, fromLocal: held.local };

  // The frame on screen: which shot time it shows, and whether it was drawn after its light fields solved.
  let drawn: number | null = null, final = false, frames = 0;
  function render(t: number): void {
    const growth = sampleScore(score, at(t));
    // Ambient time runs at its ordinary pace from the slice's start; every window and hearth time the stage derives
    // is relative to the sample's own clock, so the growth keeps the slice's pace.
    const ambient = from + Math.max(0, t);
    stage.frame({ ...growth, t: ambient, camera }, 1 / 60, true);
    drawn = t; final = false; frames++;
  }

  const loop = () => {
    try { if (clock.started()) render(clock.t()); } catch (error) { console.error('Growth set failed', error); }
    requestAnimationFrame(loop);
  };

  function idle(): boolean {
    const t = clock.t();
    if (drawn !== t) { render(t); return false; }
    if (!stage.settled()) return false;
    if (!final) {
      // The fields have published for this frame's lights: draw it once more with them, then it is final.
      render(t);
      final = stage.settled();
      return final;
    }
    return true;
  }

  render(clock.t());
  window.addEventListener('resize', () => { stage.resize(); drawn = null; });
  window.__set = {
    scene: 'growth',
    duration: shot.duration,
    canvas,
    idle,
    t: () => clock.t(),
    stats: () => ({ shot: shot.id, hour, sequence: at(clock.t()), frames,
      pixels: [canvas.width, canvas.height], ...stage.report() }),
  };
  requestAnimationFrame(loop);
  clock.begin();
  window.__chatdomReady = true;
}
