import type * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial, type VoxelRenderState } from '@chatdom/render';
import { RAID_PARTY_FRAME_MAX_BYTES, RaidPartyReplySchema, parseRaidPartyFrame, type KingdomId, type RaidPartyPublicFeed } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
import { createCitizenRenderer, createDefaultCitizenLooks } from '../../citizens';
import type { MomentPeople, MomentPeoplePort } from '../../twitch-moments/raid-party-view';
import type { RaidChatGround } from '../../twitch-moments/raid-view';
import { raidPropGroundOf, type RaidChatSupport } from './raid-chat-ground';

/** How often the gate is asked who stands at it; a gathering changes at the pace of chat, not of frames. */
export const RAID_PARTY_POLL_MS = 1000;
const RAID_PARTY_TIMEOUT_MS = 6000;
/** The reply wraps one public frame in a small envelope. */
const RAID_PARTY_REPLY_MAX_BYTES = RAID_PARTY_FRAME_MAX_BYTES + 512;

/** Uniforms that belong to the avatar lattice itself; everything else is the scene's light, sky and weather, shared live. */
const OWN_UNIFORMS = new Set(['uScale', 'uPalette']);

/**
 * The avatar material for the party's marchers. Every light, sky, fog, night and terrain uniform is the scene clay's own
 * uniform object, so the marchers are lit by exactly the same braziers, window light and dusk as the houses they stand
 * among, with no copying per frame. Only the avatar cell size and palette stay its own.
 */
export function createRaidPartyMaterial(clay: VoxelRenderState): VoxelRenderState {
  const material = createVoxelMaterial(MATERIALS, 'avatar');
  // The same open-sky fill the town's walkers get, so a darker face does not go to silhouette between two torches.
  material.material.fragmentShader = material.material.fragmentShader
    .replace('float sky=mix(.24,1.,vSky);', 'float sky=mix(.72,1.,vSky);')
    .replace('vec3 colour=base*edge*light*ao;', 'vec3 colour=base*edge*(light+vec3(.4,.32,.25)*(1.-.85*smithyInfluence))*ao;');
  for (const [key, uniform] of Object.entries(clay.material.uniforms)) if (!OWN_UNIFORMS.has(key)) material.material.uniforms[key] = uniform;
  return material;
}

/**
 * The host's people renderer for the gate party: the town's own citizen renderer and looks, on a material lit by the
 * scene. Created when a party first gathers; the view poses everyone from its own clock.
 */
export function createRaidPartyPeople(scene: THREE.Scene, clay: VoxelRenderState): MomentPeoplePort {
  return {
    async create(capacity) {
      const material = createRaidPartyMaterial(clay), looks = createDefaultCitizenLooks();
      let renderer: Awaited<ReturnType<typeof createCitizenRenderer>>;
      try { renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks, capacity }); }
      catch (error) { material.dispose(); throw error; }
      let disposed = false;
      const people: MomentPeople = {
        looks: new Set(looks.map(look => look.id)),
        get grips() { return renderer.grips; },
        // No camera culling: at most forty people, and the party's own shot may move the camera after this update.
        update(samples, atMs) { if (!disposed) renderer.update(samples, undefined, atMs); },
        dispose() { if (disposed) return; disposed = true; renderer.dispose(); material.dispose(); },
      };
      return people;
    },
  };
}

/** A marcher's footprint and headroom: shoulder-wide, a torch held high, a step or two of rise across the body. */
export const RAID_PARTY_FOOT = { radius: 0.45, height: 2.6, maxRise: 0.3 } as const;

/**
 * Where a marcher may stand in and around the gate's street: the street itself and open land in front of the gate,
 * never a lot, a square, the castle or water, and only where the scene's own occupancy says the space is free.
 */
export function raidPartyGroundOf(plan: SettlementPlan, ground: (x: number, z: number) => number, support?: RaidChatSupport): RaidChatGround {
  return raidPropGroundOf(plan, ground, { ...RAID_PARTY_FOOT, road: true, ...(support ? { support } : {}) });
}

/**
 * The realm's public current-state reader for the gate party. It polls once a second while the page is visible,
 * bounds every read in time and size, and answers `null` for nobody at the gate as well as for any failed, malformed,
 * foreign or stale read: a gathering is only ever drawn from a fresh, valid frame.
 */
export function createRaidPartyFeed(kingdomId: KingdomId, origin: RaidPartyPublicFeed['origin'], clock: () => number): RaidPartyPublicFeed {
  return { origin, subscribe(receive) {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined;
    const schedule = () => { if (!stopped && !document.hidden) timer = setTimeout(poll, RAID_PARTY_POLL_MS); };
    async function poll() {
      if (stopped || document.hidden || request) return;
      const controller = new AbortController(); request = controller;
      const timeout = setTimeout(() => controller.abort(), RAID_PARTY_TIMEOUT_MS);
      try {
        const response = await fetch(`/live-realm-data/realm/raid-party/${encodeURIComponent(kingdomId)}`, {
          signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
        });
        if (!response.ok) throw new Error('Raid party unavailable');
        const length = Number(response.headers.get('content-length'));
        if (length > RAID_PARTY_REPLY_MAX_BYTES) throw new Error('Raid party reply too large');
        if (!response.body) throw new Error('Raid party reply has no body');
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > RAID_PARTY_REPLY_MAX_BYTES) { await reader.cancel(); throw new Error('Raid party reply too large'); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let text = '';
        for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
        text += decoder.decode();
        const reply = RaidPartyReplySchema.safeParse(JSON.parse(text) as unknown);
        if (!reply.success || reply.data.kingdomId !== kingdomId || reply.data.origin !== origin) throw new Error('Invalid raid party reply');
        const party = reply.data.party && parseRaidPartyFrame(reply.data.party, clock());
        if (reply.data.party && !party) throw new Error('Stale raid party frame');
        if (!stopped && request === controller) receive(party ?? null);
      } catch {
        if (!stopped && request === controller) receive(null);
      } finally {
        clearTimeout(timeout);
        if (request === controller) { request = undefined; schedule(); }
      }
    }
    const visibility = () => {
      if (document.hidden) { clearTimeout(timer); request?.abort(); request = undefined; receive(null); }
      else { clearTimeout(timer); void poll(); }
    };
    document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); request = undefined; document.removeEventListener('visibilitychange', visibility); };
  } };
}
