import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { KingdomIdSchema } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM, WORLD_FIXTURE_TIME } from '@chatdom/shared/world-fixtures';
import { createKingdomScene } from '../kingdom/scene';
import { SkyCaptions, type ScreenCaption, type TwitchMomentFeed } from '../twitch-moments';
import './incoming.css';

/** Private art bench. Its synthetic evidence never leaves this page or enters a live feed. */
export default function IncomingRaid() {
  const query = new URLSearchParams(location.search);
  const viewers = Math.max(1, Math.min(1_000_000, Math.floor(Number(query.get('viewers')) || 140)));
  const requestedAt = Number(query.get('at'));
  const offset = query.has('at') && Number.isFinite(requestedAt) ? Math.max(0, Math.min(119_000, requestedAt)) : 16_000;
  const from = KingdomIdSchema.safeParse(query.get('from'));
  const raider = from.success ? from.data : KingdomIdSchema.parse('31337');
  const at = WORLD_FIXTURE_TIME + 40_000;
  const life = new AbortController();
  const [captions, setCaptions] = createSignal<readonly ScreenCaption[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  let canvas!: HTMLCanvasElement, scene: Awaited<ReturnType<typeof createKingdomScene>> | undefined;
  let deliver: Parameters<TwitchMomentFeed['subscribe']>[1] | undefined;
  let animation = 0;
  let presented = false, sceneReady = false;
  const priorReady = Object.getOwnPropertyDescriptor(window, '__chatdomReady');
  const feed: TwitchMomentFeed = {
    origin: 'simulated',
    subscribe(reset, receive) {
      deliver = receive;
      reset({ epoch: 'raid-show-art', asOf: at, throughSeq: 0, current: [] });
      return () => { deliver = undefined; };
    },
  };
  const frame = () => new Promise<void>(resolve => { animation = requestAnimationFrame(() => resolve()); });
  const fail = (message: string) => { presented = false; setError(message); };

  onMount(() => {
    // The host announces its first world frame earlier than this staged fact. Captures need both.
    Object.defineProperty(window, '__chatdomReady', { configurable: true, get: () => presented && sceneReady,
      set: (value: boolean) => { sceneReady = value; } });
    void (async () => {
      scene = await createKingdomScene(canvas, {
        signal: life.signal, tier: 'hamlet', seed: 'willowmere', realmName: 'Willowmere', kingdomId: WORLD_FIXTURE_KINGDOM,
        hour: 19.5, time: 40, camera: 'hero', source: 'simulated', momentFeed: feed,
        onMomentCaptions: setCaptions, onProgress: () => {}, onNames: () => {}, onSource: () => {}, onError: fail,
      });
      window.__chatdomRaidShow = { viewers, offset, inspect: () => scene?.inspect() };
      while (!life.signal.aborted) {
        const moments = scene.inspect().moments;
        if (moments?.preparation === 'failed') throw new Error(moments.preparationError ?? 'The caravan could not be prepared');
        if (moments?.preparation === 'ready' && scene.debug.ready && scene.debug.fieldSettled) break;
        await frame();
      }
      if (life.signal.aborted) return;
      // A fresh fact, rather than a restored snapshot, takes the same controller and camera lease as live ingress.
      deliver?.('raid-show-art', {
        version: 1, kingdomId: WORLD_FIXTURE_KINGDOM, seq: 1, occurredAt: at, receivedAt: at, committedAt: at,
        origin: 'simulated', type: 'twitch.moment', actor: null, cause: { kind: 'external', source: 'twitch', id: 'raid-show-art' },
        body: { kind: 'raid', key: 'raid.art', displayUntil: at + 60_000, raidKey: 'art',
          from: { kingdomId: raider, displayName: 'Mossbrook', crestKey: null }, viewers, founded: false },
      });
      // Poses and director eases use absolute time. Render the entrance and the final still, not a CPU recording.
      for (const elapsed of new Set([0, Math.max(0, offset - 800), offset])) {
        if (life.signal.aborted) return;
        scene.seek(40 + elapsed / 1000);
        await frame();
      }
      if (life.signal.aborted) return;
      await frame(); await frame();
      const inspect = scene.inspect().moments;
      if (!inspect || inspect.controller.admitted !== 1 || Number(inspect.view['raid.wagons']) < 1 && offset >= 5000 && offset < 50_000) {
        throw new Error('The incoming raid did not reach the scene');
      }
      presented = true;
      window.__chatdomReady = true;
    })().catch(reason => { if (!life.signal.aborted) fail(reason instanceof Error ? reason.message : 'The gate could not open'); });
  });
  onCleanup(() => {
    life.abort(); cancelAnimationFrame(animation); scene?.dispose();
    if (priorReady) Object.defineProperty(window, '__chatdomReady', priorReady); else delete window.__chatdomReady;
    delete window.__chatdomRaidShow;
  });
  return <div class="raid-show-picture">
    <canvas ref={element => { canvas = element; }} aria-label="Mossbrook's caravan arriving at Willowmere's gate" />
    <SkyCaptions captions={captions()} />
    <Show when={error()}>{message => <p class="raid-show-error" role="alert">{message()}</p>}</Show>
  </div>;
}

declare global { interface Window { __chatdomReady?: boolean; __chatdomRaidShow?: { viewers: number; offset: number; inspect(): unknown } } }
