import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { KingdomIdSchema, type RaidChatFeed, type RaidChatFrame, type RaidPennantFeed, type RaidPennant, parseRaidPennantArchiveCursor } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM, WORLD_FIXTURE_TIME } from '@chatdom/shared/world-fixtures';
import { createKingdomScene } from '../kingdom/scene';
import * as THREE from 'three';
import { giftRouteOf } from '../kingdom/moments/anchors';
import { SkyCaptions, type ScreenCaption, type TwitchMomentFeed } from '../twitch-moments';
import './incoming.css';

/** Private art bench. Its synthetic evidence never leaves this page or enters a live feed. */
export default function IncomingRaid() {
  const query = new URLSearchParams(location.search);
  const withArchive = query.get('browse') === '1';
  const withPennants = withArchive || query.get('pennants') === '1';
  const withChat = query.get('chat') === '1', raidId = `raid.${'a'.repeat(64)}`;
  const viewers = Math.max(1, Math.min(1_000_000, Math.floor(Number(query.get('viewers')) || 140)));
  const requestedAt = Number(query.get('at'));
  const offset = query.has('at') && Number.isFinite(requestedAt) ? Math.max(0, Math.min(600_000, requestedAt)) : 16_000;
  const requestedChatAge = Number(query.get('chatAge'));
  const chatAge = query.has('chatAge') && Number.isFinite(requestedChatAge) ? Math.max(500, Math.min(89_500, requestedChatAge)) : 2_000;
  const from = KingdomIdSchema.safeParse(query.get('from'));
  const raider = from.success ? from.data : KingdomIdSchema.parse('31337');
  const at = WORLD_FIXTURE_TIME + 40_000;
  const life = new AbortController();
  const [captions, setCaptions] = createSignal<readonly ScreenCaption[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  let canvas!: HTMLCanvasElement, scene: Awaited<ReturnType<typeof createKingdomScene>> | undefined;
  let deliver: Parameters<TwitchMomentFeed['subscribe']>[1] | undefined;
  let deliverChat: Parameters<RaidChatFeed['subscribe']>[0] | undefined;
  let deliverPennants: Parameters<RaidPennantFeed['subscribe']>[0] | undefined;
  let archiveReads = 0, redraws = 0;
  let lastArchiveIds: string[] = [];
  const archiveItems: RaidPennant[] = Array.from({ length: 73 }, (_, i) => ({
    raidId: i === 0 ? raidId : `raid.${(1000 + i).toString(16).padStart(64, '0')}`,
    from: i % 3 === 0 ? { kingdomId: raider, login: 'mossbrook', name: 'Mossbrook' }
      : i % 3 === 1 ? { kingdomId: KingdomIdSchema.parse('7331'), login: 'copperleaf', name: 'Copperleaf' }
        : { kingdomId: KingdomIdSchema.parse('91234'), login: 'emberford', name: 'Emberford' },
    occurredAt: at - i * 86_400_000,
  }));
  const fixtureHistory: RaidPennant[] = withArchive ? archiveItems : [
    { raidId, from: { kingdomId: raider, login: 'mossbrook', name: 'Mossbrook' }, occurredAt: at },
    { raidId: `raid.${'b'.repeat(64)}`, from: { kingdomId: KingdomIdSchema.parse('7331'), login: 'copperleaf', name: 'Copperleaf' }, occurredAt: at - 86_400_000 },
    { raidId: `raid.${'c'.repeat(64)}`, from: { kingdomId: KingdomIdSchema.parse('91234'), login: 'emberford', name: 'Emberford' }, occurredAt: at - 172_800_000 },
    { raidId: `raid.${'d'.repeat(64)}`, from: { kingdomId: raider, login: 'mossbrook', name: 'Mossbrook' }, occurredAt: at - 604_800_000 },
  ];
  let animation = 0;
  let presented = false, sceneReady = false;
  const priorReady = Object.getOwnPropertyDescriptor(window, '__chatdomReady');
  const feed: TwitchMomentFeed = {
    origin: 'simulated',
    raidPennantArchive: { origin: 'simulated', async read(before, signal) {
      signal.throwIfAborted();
      if (withArchive) await new Promise<void>(resolve => setTimeout(resolve, 120));
      signal.throwIfAborted();
      const cursor = before === null ? null : parseRaidPennantArchiveCursor(before);
      if (before !== null && (!cursor || cursor.origin !== 'simulated' || cursor.kingdomId !== WORLD_FIXTURE_KINGDOM || cursor.ceiling !== fixtureHistory.length)) throw new Error('Invalid private history cursor');
      const eligible = fixtureHistory.filter((_item, i) => fixtureHistory.length - i < (cursor?.before ?? fixtureHistory.length + 1));
      const items = eligible.slice(0, 12), tail = items.at(-1);
      archiveReads++; lastArchiveIds = items.map(item => item.raidId);
      return { version: 1, origin: 'simulated', kingdomId: WORLD_FIXTURE_KINGDOM, asOf: at + offset, items,
        next: eligible.length > 12 && tail ? `pennants:1:simulated:${WORLD_FIXTURE_KINGDOM}:${fixtureHistory.length}:${fixtureHistory.length - fixtureHistory.indexOf(tail)}` : null };
    } },
    raidPennants: { origin: 'simulated', subscribe(receive) { deliverPennants = receive; return () => { deliverPennants = undefined; }; } },
    raidChat: { origin: 'simulated', subscribe(receive) { deliverChat = receive; return () => { deliverChat = undefined; }; } },
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
      window.__chatdomRaidShow = { viewers, offset, redraw: () => scene?.seek(40 + offset / 1000 + ++redraws / 1000), inspect: () => ({ ...scene?.inspect(),
        raidPennants: { framing: 'private evidence pose, no raid camera lease', fixtures: withPennants, archiveReads, lastArchiveIds },
        raidChat: { chatAge, bubbles: [...document.querySelectorAll<HTMLElement>('.raid-chat-bubble')].filter(node => !node.hidden).length,
          framing: offset >= 120_000 ? 'private evidence pose, no raid camera lease' : 'production raid director' } }) };
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
        body: { kind: 'raid', key: raidId, displayUntil: at + 60_000, raidKey: raidId,
          from: { kingdomId: raider, displayName: 'Mossbrook', crestKey: null }, viewers, founded: false },
      });
      // Poses and director eases use absolute time. Render the entrance and the final still, not a CPU recording.
      for (const elapsed of new Set([0, Math.max(0, offset - 800), offset])) {
        if (life.signal.aborted) return;
        scene.seek(40 + elapsed / 1000);
        await frame();
      }
      if (life.signal.aborted) return;
      if (offset >= 120_000) {
        // The show has ended. Frame its actual gate for evidence without admitting another fact or camera focus.
        const route = giftRouteOf(scene.layout);
        if (!route || route.inbound.length < 2) throw new Error('The adopted gate has no incoming road');
        const gate = new THREE.Vector3(...route.inbound[0]!);
        const facing = new THREE.Vector3(...route.inbound[1]!).sub(gate).setY(0).normalize();
        const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), facing).normalize();
        const portrait = canvas.clientHeight > canvas.clientWidth;
        const eye = gate.clone().addScaledVector(facing, portrait ? -12 : -15).addScaledVector(side, portrait ? -4 : -8).add(new THREE.Vector3(0, portrait ? 9 : 12, 0));
        const target = gate.clone().addScaledVector(facing, 9).add(new THREE.Vector3(0, 1.5, 0));
        scene.pose(eye.toArray(), target.toArray(), portrait ? 60 : 52);
      }
      if (withChat) {
        // Public-shape art fixtures only. Authority/Herald correlation is demonstrated separately by room tests.
        const asOf = at + offset - chatAge, raid = { raidId, fromKingdomId: raider, fromName: 'Mossbrook' };
        const cues: RaidChatFrame['cues'] = ['Good evening, Willowmere!', 'A fine road to friends.', 'We brought the night lights.'].map((text, i) => ({
          version: 1, id: `raid-chat.${String(i + 1).repeat(64)}`, lightId: `raid-light.${String(i + 1).repeat(64)}`,
          kingdomId: WORLD_FIXTURE_KINGDOM, origin: 'simulated', asOf, expiresAt: asOf + 10_000, raid, parts: [{ kind: 'text', text }],
        }));
        deliverChat?.({ version: 1, kingdomId: WORLD_FIXTURE_KINGDOM, origin: 'simulated', asOf: at + offset,
          lights: cues.map(cue => ({ lightId: cue.lightId, kingdomId: cue.kingdomId, origin: cue.origin, raid: cue.raid,
            asOf: cue.asOf, expiresAt: cue.asOf + 90_000 })), cues: cues.filter(cue => cue.expiresAt > at + offset) });
      }
      if (withPennants) {
        await Promise.all([document.fonts.load('bold 49px "Alegreya"'), document.fonts.load('32px "IM Fell English"')]);
        // Art fixtures exercise reload-shaped history without replaying any older raid facts.
        deliverPennants?.({ version: 1, origin: 'simulated', kingdomId: WORLD_FIXTURE_KINGDOM, asOf: at + offset,
          items: fixtureHistory.slice(0, 24) });
        // Fixed-time benches must explicitly request a draw after asynchronous history arrives.
        scene.seek(40 + offset / 1000 + .001);
      }
      await frame(); await frame();
      if (withPennants) {
        const metrics = scene.inspect().moments?.view;
        if (!metrics || Number(metrics['pennantWall.pennants']) < 1 || Number(metrics['pennantWall.plaques']) < 1) throw new Error('No supported dated pennants to frame');
        const foot = new THREE.Vector3(Number(metrics['pennantWall.firstX']), Number(metrics['pennantWall.firstY']), Number(metrics['pennantWall.firstZ']));
        const face = new THREE.Vector3(Number(metrics['pennantWall.firstFaceX']), 0, Number(metrics['pennantWall.firstFaceZ']));
        const side = new THREE.Vector3(face.z, 0, -face.x);
        const target = foot.clone().add(new THREE.Vector3(0, 2, 0));
        const eye = target.clone().addScaledVector(face, 8).addScaledVector(side, 2.5).add(new THREE.Vector3(0, 2, 0));
        scene.pose(eye.toArray(), target.toArray(), canvas.clientHeight > canvas.clientWidth ? 60 : 52);
        await frame(); await frame();
      }
      if (withChat && offset >= 120_000) {
        const metrics = scene.inspect().moments?.view, route = giftRouteOf(scene.layout);
        if (!metrics || !route || Number(metrics['raid.chatGateLanterns']) < 1) throw new Error('No current gate lights to frame');
        // Frame the actual supported fixtures, which may sit beyond a reserved lot beside this junction.
        const centre = new THREE.Vector3(Number(metrics['raid.chatGateX']), Number(metrics['raid.chatGateY']), Number(metrics['raid.chatGateZ']));
        const facing = new THREE.Vector3(...route.inbound[1]!).sub(new THREE.Vector3(...route.inbound[0]!)).setY(0).normalize();
        const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), facing).normalize();
        const portrait = canvas.clientHeight > canvas.clientWidth, span = Number(metrics['raid.chatGateSpan']);
        const distance = Math.max(portrait ? 16 : 12, span * (portrait ? 2.2 : 1.2) + 6);
        const eye = centre.clone().addScaledVector(facing, -distance).addScaledVector(side, -3).add(new THREE.Vector3(0, distance * .4, 0));
        scene.pose(eye.toArray(), centre.clone().add(new THREE.Vector3(0, .4, 0)).toArray(), portrait ? 60 : 52);
        await frame(); await frame();
      }
      while (!life.signal.aborted && !scene.debug.fieldSettled) await frame();
      if (life.signal.aborted) return;
      const inspect = scene.inspect().moments;
      if (!inspect || inspect.controller.admitted !== 1 || Number(inspect.view['raid.wagons']) < 1 && offset >= 5000 && offset < 50_000) {
        throw new Error('The incoming raid did not reach the scene');
      }
      if (offset >= 120_000 && (Number(inspect.view['raid.caravans']) !== 0 || inspect.view.leased)) throw new Error('A past raid replayed its caravan or camera');
      if (withChat && offset >= 120_000 && Number(inspect.view['raid.chatGateLanterns']) < 1) throw new Error('The current chat lights have no supported gate fixtures');
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

declare global { interface Window { __chatdomReady?: boolean; __chatdomRaidShow?: { viewers: number; offset: number; redraw?(): void; inspect(): unknown } } }
