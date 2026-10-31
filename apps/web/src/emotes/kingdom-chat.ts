import * as THREE from 'three';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import {
  createEmoteChatPresentation, createEmoteWeather, EMOTE_CHAT_TUNING,
  type EmoteCatalogueView, type EmoteChatFrame, type EmoteWeatherStats, type EmoteChatInline, type EmoteChatSound, type InlineEmoteVisual,
} from '../../../../packages/emotes/src/index';
import { createWeatherBatchHost } from './weather-batch';

/** The SIMULATED chat's clock: its first message is at this caller time; it repeats every `CHAT_LOOP_MS`. */
export const CHAT_EPOCH_MS = 1_798_340_460_000;
export const CHAT_LOOP_MS = 26_000;
/** The held still: a chant three seconds into its weather, two lifted toads, three bubbles. */
export const CHAT_HELD_MS = 6_000;
export const CHAT_STREAM_EPOCH = 'simulated-stream-1';

/** The SIMULATED crowd in the square: real avatar looks, never more people than the bench shows. */
export const CHAT_CROWD = [
  { look: 'citizen-a', at: [-4.5, 5.7], facing: 2.6, waving: false },
  { look: 'hair-long-braid', at: [-2.05, 7.35], facing: 3.6, waving: false },
  { look: 'skin-darkest', at: [.85, 6.45], facing: 2.85, waving: true },
  { look: 'hair-rounded-curls', at: [3.35, 5.35], facing: 3.75, waving: false },
  { look: 'common-short-cloak-tide', at: [5.75, 6.75], facing: 3.95, waving: false },
  { look: 'hair-bob', at: [-7.4, 7.1], facing: 2.35, waving: false },
] as const;

type ScriptPart = { kind: 'text'; text: string } | { kind: 'emote'; id: string; alt: string };
interface ScriptLine { readonly at: number; readonly slot: number; readonly parts: readonly ScriptPart[] }

/**
 * What the SIMULATED chat says, in order, as Herald would deliver it: Twitch fragments mark the emote,
 * the rest is plain text. Three people use toadWave inside six seconds, so the square shares a chant;
 * `gonefish` is not in this channel's catalogue and stays words; the markup is just words.
 */
export function chatScript(emoteId: string, emoteAlt: string): readonly ScriptLine[] {
  const toad: ScriptPart = { kind: 'emote', id: emoteId, alt: emoteAlt };
  return [
    { at: 300, slot: 2, parts: [{ kind: 'text', text: 'evening, all' }] },
    { at: 900, slot: 0, parts: [{ kind: 'text', text: 'the toad is up! ' }, toad] },
    { at: 1_700, slot: 3, parts: [toad] },
    { at: 2_800, slot: 4, parts: [toad, { kind: 'text', text: ' ' }, toad] },
    { at: 3_300, slot: 5, parts: [{ kind: 'text', text: 'brb, feeding the ' }, { kind: 'emote', id: 'simgonefish', alt: 'gonefish' }] },
    { at: 4_300, slot: 1, parts: [{ kind: 'text', text: ' ' }, toad] },
    { at: 4_900, slot: 2, parts: [toad] },
    { at: 7_400, slot: 0, parts: [{ kind: 'text', text: '<b>loud</b> is just words here' }] },
    { at: 9_200, slot: 3, parts: [{ kind: 'text', text: 'that wave never gets old' }] },
    { at: 13_500, slot: 4, parts: [{ kind: 'text', text: 'again at the top of the hour' }] },
  ];
}

export interface ChatOverlayBubble { readonly cueId: string; readonly x: number; readonly y: number; readonly parts: readonly EmoteChatInline[] }
export interface ChatOverlayPop { readonly cueId: string; readonly x: number; readonly y: number; readonly scale: number; readonly opacity: number; readonly visual: InlineEmoteVisual; readonly alt: string }
export interface ChatOverlay { readonly bubbles: readonly ChatOverlayBubble[]; readonly pops: readonly ChatOverlayPop[] }

export interface KingdomChatReport {
  readonly delivered: number;
  readonly accepted: number;
  readonly rejected: Readonly<Record<string, number>>;
  readonly bubbles: number;
  readonly inlineImages: number;
  readonly unknownWords: number;
  readonly gestures: number;
  readonly weather: readonly { id: string; slots: number; particles: number; frame: number }[];
  readonly weatherParticles: number;
  readonly sounds: readonly EmoteChatSound['kind'][];
  readonly retained: ReturnType<ReturnType<typeof createEmoteChatPresentation>['stats']>;
  readonly weatherGeometryBytes: number;
}

export interface KingdomChat {
  /** Delivers the script up to `timeMs`, then places the weather and projects bubbles and pops. */
  update(timeMs: number, camera: THREE.Camera, width: number, height: number): void;
  report(): KingdomChatReport;
  dispose(): void;
}

export interface KingdomChatInput {
  /** The composition group: crowd positions and weather share its space. */
  readonly parent: THREE.Object3D;
  readonly material: THREE.Material;
  readonly mesh: (blueprint: VoxelBlueprint) => Promise<THREE.BufferGeometry>;
  readonly glow: THREE.Texture;
  readonly catalogue: EmoteCatalogueView;
  readonly emoteId: string;
  readonly emoteAlt: string;
  readonly kingdomId: string;
  /** Feet of each present slot, in the composition's space. */
  readonly positions: ReadonlyMap<number, Vec3>;
  readonly device: 'desktop' | 'phone';
  readonly onOverlay: (overlay: ChatOverlay) => void;
}

const HEAD_METRES = 2.05;

/**
 * The bench's chat layer: a SIMULATED feed of shared cues through the real `createEmoteChatPresentation`,
 * real weather through `createEmoteWeather` on instanced clay, and parchment bubbles and lifted tokens
 * projected over the speakers. All time is the stage's caller time; nothing is kept past the cue window.
 */
export async function createKingdomChat(input: KingdomChatInput): Promise<KingdomChat> {
  const script = chatScript(input.emoteId.replace(/^twitch\./, ''), input.emoteAlt);
  const presentation = createEmoteChatPresentation({ kingdomId: input.kingdomId, epoch: CHAT_STREAM_EPOCH, origin: 'simulated', catalogue: input.catalogue, device: input.device });
  const host = createWeatherBatchHost({ parent: input.parent, material: input.material, mesh: input.mesh, glow: input.glow });
  const effect = input.catalogue.resolveApprovedEmote(input.emoteId, 'effect');
  if (effect) await host.prepare(effect);
  const weather = createEmoteWeather(host, { capacity: EMOTE_CHAT_TUNING.particles[input.device] / EMOTE_CHAT_TUNING.maxWeathers });
  let loop = 0, line = 0, delivered = 0, accepted = 0, lastTime = -Infinity;
  const rejected: Record<string, number> = {};
  let sounds: EmoteChatSound['kind'][] = [];
  let frame: EmoteChatFrame = { atMs: CHAT_EPOCH_MS, bubbles: [], gestures: [], weather: [] };
  let weatherStats: EmoteWeatherStats = { batches: 0, particles: 0, motifs: [] };
  const point = new THREE.Vector3();

  const project = (feet: Vec3, lift: number, camera: THREE.Camera, width: number, height: number): { x: number; y: number } | null => {
    point.set(feet[0], feet[1] + HEAD_METRES + lift, feet[2]);
    input.parent.localToWorld(point).project(camera);
    if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1.05 || Math.abs(point.y) > 1.05) return null;
    return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
  };

  return {
    update(timeMs, camera, width, height) {
      // Caller time only moves forward; a jump back (a replay) starts the stream over cleanly.
      if (timeMs < lastTime) { presentation.clearEpoch(); loop = 0; line = 0; }
      lastTime = timeMs;
      for (;;) {
        const next = script[line]!;
        const asOf = CHAT_EPOCH_MS + loop * CHAT_LOOP_MS + next.at;
        if (asOf > CHAT_EPOCH_MS + timeMs) break;
        const cue = {
          version: 1, id: `sim.${loop}.${line}`, kingdomId: input.kingdomId, epoch: CHAT_STREAM_EPOCH, origin: 'simulated',
          slot: next.slot, asOf, expiresAt: asOf + 7_000, parts: next.parts,
        };
        const receipt = presentation.receive(cue, asOf, input.positions);
        delivered++;
        if (receipt.status === 'accepted') { accepted++; if (receipt.sound) sounds = [...sounds.slice(-7), receipt.sound.kind]; }
        else rejected[receipt.reason] = (rejected[receipt.reason] ?? 0) + 1;
        if (++line >= script.length) { line = 0; loop++; }
      }
      const atMs = CHAT_EPOCH_MS + timeMs;
      frame = presentation.frame(atMs, input.positions);
      weatherStats = weather.update(frame.weather, atMs);
      const bubbles: ChatOverlayBubble[] = [], pops: ChatOverlayPop[] = [];
      for (const bubble of frame.bubbles) {
        const at = project(bubble.position, 0, camera, width, height);
        if (at) bubbles.push({ cueId: bubble.cueId, x: at.x, y: at.y, parts: bubble.parts });
      }
      for (const gesture of frame.gestures) {
        const at = project(gesture.position, gesture.lift, camera, width, height);
        if (at) pops.push({ cueId: gesture.cueId, x: at.x, y: at.y, scale: gesture.scale, opacity: gesture.opacity, visual: gesture.emote.visual, alt: gesture.emote.alt });
      }
      input.onOverlay({ bubbles, pops });
    },
    report: () => {
      const parts = frame.bubbles.flatMap(b => b.parts);
      return {
        delivered, accepted, rejected: { ...rejected }, bubbles: frame.bubbles.length,
        inlineImages: parts.filter(p => p.kind === 'emote' && p.visual).length,
        unknownWords: parts.filter(p => p.kind === 'emote' && !p.visual).length,
        gestures: frame.gestures.length,
        weather: frame.weather.map(w => ({ id: w.id, slots: w.slots, particles: weatherStats.motifs.find(m => m.id === w.id)?.particles ?? 0, frame: weatherStats.motifs.find(m => m.id === w.id)?.frame ?? -1 })),
        weatherParticles: weatherStats.particles, sounds, retained: presentation.stats(), weatherGeometryBytes: host.stats.bytes,
      };
    },
    dispose() { weather.dispose(); host.dispose(); presentation.clearEpoch(); input.onOverlay({ bubbles: [], pops: [] }); },
  };
}
