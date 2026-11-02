/**
 * Private bench for the gate in the walking view: `/-/raid-gate?walkGate=<stage>` stands a kingdom at dusk at street
 * level, a HUD region shaped like play's top-centre, and mounts the production `mountWalkGate` against the gate bench's
 * real application (its Twitch, rooms and people are private simulated fixtures; nothing visible says so, decision 25).
 * Stages: `gathering`, `countdown`, `ride` (Twitch confirmed, the walker may ride out), `road` (a place is held and the
 * destination draws its world, so the journey layer covers the world) and `through` (the step is acknowledged and the
 * page would walk on; the bench records the path instead of leaving).
 */
import { onCleanup, onMount } from 'solid-js';
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import { createKingdomScene } from '../kingdom/scene';
import type { RaidGateController } from './controller';
import { mountWalkGate } from './walk-gate';
import './raid-gate.css';

type BenchWindow = Window & { __chatdomReady?: boolean; __walkGate?: { stage: string; phase: string | null; journey: string | null; walkedTo: string | null } };
const STAGES = ['gathering', 'countdown', 'ride', 'road', 'through'] as const;
type Stage = typeof STAGES[number];
const FERNHOLLOW = '41000002' as KingdomId;

export default function WalkGateBench(props: { stage: string }) {
  const stage: Stage = STAGES.find(each => each === props.stage) ?? 'gathering';
  const life = new AbortController();
  const bench = window as BenchWindow;
  bench.__chatdomReady = false;
  bench.__walkGate = { stage, phase: null, journey: null, walkedTo: null };
  let canvas!: HTMLCanvasElement;
  let region!: HTMLDivElement;
  onCleanup(() => life.abort());

  onMount(() => {
    document.body.classList.add('rg-page');
    let sceneReady = false, staged = false;
    const ready = () => { if (sceneReady && staged) requestAnimationFrame(() => requestAnimationFrame(() => { bench.__chatdomReady = true; })); };
    void createKingdomScene(canvas, {
      signal: life.signal, tier: 'town', seed: 'willowmere', realmName: 'Willowmere', hour: 19.6, time: 40, camera: 'citizen', source: 'simulated',
      onProgress: () => undefined, onNames: () => undefined, onSource: () => undefined, onError: () => { sceneReady = true; ready(); },
    }).then(scene => {
      if (life.signal.aborted) { scene.dispose(); return; }
      life.signal.addEventListener('abort', () => scene.dispose(), { once: true });
      const settle = () => { if (life.signal.aborted) return; if (scene.debug.ready && scene.debug.fieldSettled) { sceneReady = true; ready(); } else requestAnimationFrame(settle); };
      settle();
    }, () => { sceneReady = true; ready(); });

    void (async () => {
      const { createGateBench } = await import('./bench');
      const clock = () => Date.now();
      const made = createGateBench({ viewer: 'walker', authority: 'ready', clock, rooms: stage === 'road' ? 'hold' : 'ready' });
      let controller: RaidGateController | null = null;
      const heard = new Promise<RaidGateController>(resolve => {
        const dispose = mountWalkGate({
          kingdomId: made.source.kingdomId, host: region, api: made.api, origin: made.api.origin, storage: null, clock, mapBundled: false,
          readName: async () => made.source.name, keyHint: () => 'G',
          navigate: path => { bench.__walkGate!.walkedTo = path; },
          onController: next => { controller = next; if (next) resolve(next); },
        });
        life.signal.addEventListener('abort', dispose, { once: true });
      });
      const gate = await heard;
      const settled = (done: () => boolean) => new Promise<void>(resolve => {
        if (done()) { resolve(); return; }
        const stop = gate.subscribe(() => { if (done()) { stop(); resolve(); } });
      });
      await settled(() => gate.snapshot().phase !== 'loading');
      await made.monarchPreview(FERNHOLLOW);
      await gate.refresh();
      const requestId = gate.snapshot().requestId;
      if (requestId) {
        await made.walkersJoin(4, requestId);
        if (stage !== 'gathering') await gate.join();
        if (stage !== 'gathering') { await made.monarchStart(requestId); await gate.refresh(); }
        if (stage === 'ride' || stage === 'road' || stage === 'through') { await made.witness(requestId, 214); await gate.refresh(); }
        if (stage === 'road' || stage === 'through') {
          void gate.travel();
          await settled(() => stage === 'road' ? gate.snapshot().journey?.state === 'preparing' : gate.snapshot().journey?.state === 'committed');
        }
        await gate.refresh();
      }
      const s = (controller as RaidGateController | null)?.snapshot();
      bench.__walkGate = { ...bench.__walkGate!, phase: s?.phase ?? null, journey: s?.journey?.state ?? null };
      staged = true;
      // Let the plaque and the ink settle into the picture before the capture.
      setTimeout(ready, stage === 'road' || stage === 'through' ? 4200 : 900);
    })();
  });

  return <div class="wgb-route">
    <canvas ref={element => { canvas = element; }} class="rg-kingdom" aria-label="Willowmere at dusk, at street level" />
    <div ref={element => { region = element; }} class="wgb-region" />
    <style>{`
      .wgb-route { position: fixed; inset: 0; background: #0d0f1c; }
      .wgb-route .rg-kingdom { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
      /* Shaped like play's top-centre HUD region, so the piece is seen where it will live. */
      .wgb-region { position: absolute; z-index: 20; top: calc(16px + env(safe-area-inset-top)); left: 50%; translate: -50% 0; display: flex; flex-direction: column;
        align-items: center; gap: 8px; max-width: min(560px, calc(100% - 32px)); }
    `}</style>
  </div>;
}
