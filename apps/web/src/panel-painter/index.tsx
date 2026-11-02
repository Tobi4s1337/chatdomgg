import { onCleanup, onMount } from 'solid-js';
import { KingdomIdSchema, KingdomPresenceFrameSchema, type KingdomPresenceFrame, type PresenceFeed } from '@chatdom/shared';
import { RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import { decodeFoundedScene } from '@chatdom/world/founded-scene';
import { createKingdomScene } from '../kingdom/scene';
import { createRealmSoulClock } from '../soul/realm-clock';
import './style.css';

interface PainterInput { snapshot: unknown; sceneBytes?: number[] }
interface PainterHost extends Window {
  __chatdomReady?: boolean;
  __chatdomPainterRead?: () => Promise<PainterInput>;
  __chatdomPainter?: { prepare(input: PainterInput): Promise<void>; freeze(): void; ready(): boolean; error(): string | null };
}

/** Private capture surface. Its runner supplies only checked public realm data, never a browser identity. */
export default function PanelPainter() {
  let canvas: HTMLCanvasElement | undefined;
  const host = window as PainterHost, abort = new AbortController();
  const listeners = new Set<(frame: KingdomPresenceFrame) => void>();
  let current: KingdomPresenceFrame | undefined, scene: Awaited<ReturnType<typeof createKingdomScene>> | undefined;
  let resume: (() => void) | undefined, sceneHash: string | undefined, failure: string | null = null, targetHour = 0, previousFrame = 0;
  const clock = createRealmSoulClock();
  const presenceFeed: PresenceFeed = { label: 'LIVE', subscribe(receive) {
    listeners.add(receive); if (current) receive(current);
    return () => { listeners.delete(receive); };
  } };
  const freeze = () => { if (scene && !resume) resume = scene.suspendRendering(); };
  const prepare = async (input: PainterInput) => {
    host.__chatdomReady = false; failure = null;
    previousFrame = scene?.inspect().renderCompletedAt ?? 0;
    if (typeof input.snapshot !== 'object' || input.snapshot === null) throw new Error('The kingdom is out of reach.');
    const snapshot = input.snapshot as Record<string, unknown>;
    if (snapshot.status !== 'kingdom') throw new Error('This kingdom is waiting to be founded.');
    const kingdomId = KingdomIdSchema.parse(snapshot.kingdomId);
    const manifest = RealmFoundedManifestSchema.parse(snapshot.manifest);
    const presence = KingdomPresenceFrameSchema.parse(snapshot.presence);
    if (manifest.kingdomId !== kingdomId || manifest.origin !== 'live' || presence.kingdomId !== kingdomId || presence.origin !== 'live') {
      throw new Error('The kingdom and its public presence do not agree.');
    }
    if (!await clock.sync(abort.signal)) throw new Error('The kingdom clock is out of reach.');
    const epoch = clock.now();
    if (epoch === null) throw new Error('The kingdom clock is out of reach.');
    targetHour = ((epoch % 86_400_000) + 86_400_000) % 86_400_000 / 3_600_000;
    current = presence;
    if (sceneHash !== manifest.sceneHash) {
      if (!input.sceneBytes) throw new Error('The kingdom painting needs its approved streets.');
      const founded = await decodeFoundedScene(new Uint8Array(input.sceneBytes), manifest);
      abort.signal.throwIfAborted();
      resume = undefined; scene?.dispose(); scene = undefined;
      sceneHash = undefined;
      if (!canvas) throw new Error('The painter canvas is unavailable.');
      scene = await createKingdomScene(canvas, {
        ...founded.plan.config, founded, kingdomId, presenceFeed, source: 'herald', presenceOrigin: 'live',
        hour: targetHour, time: null, camera: 'hero', directArrivals: false, signal: abort.signal,
        onProgress: () => {}, onNames: () => {}, onSource: () => {},
        onError: () => { failure = 'The kingdom could not be painted.'; host.__chatdomReady = false; },
      });
      sceneHash = manifest.sceneHash;
    } else {
      resume?.(); resume = undefined;
      for (const receive of listeners) receive(presence);
      scene?.setHour(targetHour);
    }
  };
  onMount(() => {
    host.__chatdomPainter = {
      async prepare(input) { try { await prepare(input); } catch (error) { failure = 'The kingdom could not be painted.'; throw error; } },
      freeze,
      ready: () => !!scene?.debug.ready && scene.inspect().renderCompletedAt > previousFrame && scene.debug.fieldSettled && Math.abs(scene.debug.hour - targetHour) < .01 && failure === null,
      error: () => failure,
    };
    if (host.__chatdomPainterRead) void host.__chatdomPainterRead().then(input => host.__chatdomPainter!.prepare(input)).catch(() => {
      failure = 'The kingdom could not be painted.';
    });
    else failure = 'This window opens through the kingdom painter.';
  });
  onCleanup(() => { abort.abort(); scene?.dispose(); listeners.clear(); delete host.__chatdomPainter; host.__chatdomReady = false; });
  return <div class="panel-painter" data-chatdom-panel-painter><canvas ref={element => { canvas = element; }} aria-label="The kingdom, painted from its public realm" /></div>;
}
