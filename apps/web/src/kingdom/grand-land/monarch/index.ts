import * as THREE from 'three';
import type { VoxelRenderState } from '@chatdom/render';
import type { SettlementPlan } from '@chatdom/world';
import { MONARCH_CHANNEL, MonarchChannelReplySchema, REALM_CASTLE_SLOT, REALM_NO_HOME_SLOT, monarchCrownOf, monarchNameTag,
  type ArrivalStanding, type MonarchChannelReply, type MonarchTitle, type RealmWalkerFeed, type RealmWalkerFrame } from '@chatdom/shared/realm';
import { createMonarchPresence } from './presence';
import { createMonarchCrown } from './crown';
import { createHomeMark } from './home-mark';
import { provideWalkerGaze } from './gaze';
import { bearingWords, createArrivalLine, firstArrival, rememberArrival, type ArrivalLine } from './arrival-line';

export { createMonarchPresence, findMonarch, gazeToward, monarchBeacon } from './presence';
export { arrivalKey, bearingWords, firstArrival } from './arrival-line';
export { walkerGaze, provideWalkerGaze } from './gaze';

/** The walk's room, as far as the monarch needs it: the crown marks and the monarch channel. */
export interface MonarchRoom {
  readonly sessionId: string;
  readonly state: { readonly walkers: { get(id: string): { readonly crown?: string; readonly homeSlot?: number } | undefined } };
  send(type: string, message: unknown): void;
  onMessage(type: string, callback: (message: unknown) => void): (() => void) | unknown;
}
interface Pose { readonly id: string; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly self?: boolean }
interface Label { readonly id: string; readonly name: string; readonly self: boolean; readonly opacity?: number }
export interface MonarchPeople {
  readonly poses: readonly Pose[];
  readonly heads?: ReadonlyMap<string, THREE.Vector3>;
}
export interface MonarchViewOptions {
  readonly scene: THREE.Object3D;
  readonly lighting: VoxelRenderState;
  readonly kingdomId: string | null;
  readonly plan: SettlementPlan | null;
  /** The kingdom's own bell: rung once as the monarch walks in. */
  readonly bell: () => void;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** First arrival waits for the opening to settle and the realm to say who rules here, then speaks once. */
const SETTLE_MS = 1_200, NAME_WAIT_MS = 2_500;
const toRadians = (yaw: number) => yaw * Math.PI * 2 / 256;

/**
 * The monarch in the kingdom view, for the walk and the stream alike: the crown on their own head, their title on
 * their name tag, heads that turn and the bell and the beacon as they walk in; and for the person walking, the one
 * calm arrival line and a mark on their own home. Everything here reads the room's crown mark, which the realm
 * sets only for the verified broadcaster.
 */
export function createMonarchView(options: MonarchViewOptions) {
  const presence = createMonarchPresence(), crown = createMonarchCrown(options.scene, options.lighting), home = createHomeMark(options.scene);
  const observedCrowns = new Map<string, MonarchTitle>();
  let disposed = false, people: MonarchPeople | null = null, lastNow: number | null = null;
  let walk: { room: MonarchRoom; kingdomName: string; line: ArrivalLine; stop: () => void; firstSelfAt: number | null; asked: number;
    reply: MonarchChannelReply | null; spoken: boolean } | null = null;
  const stopGaze = provideWalkerGaze(pose => presence.gaze({ id: pose.id, x: pose.x, z: pose.z, heading: toRadians(pose.yaw) }, performance.now())?.yaw);
  const crownOf = (id: string): string | undefined => walk ? walk.room.state.walkers.get(id)?.crown : observedCrowns.get(id);
  const node = (id: string | undefined) => id ? options.plan?.nodes.find(candidate => candidate.id === id)?.position ?? null : null;
  const doorOf = (slot: number | undefined): readonly [number, number, number] | null => {
    if (slot === undefined || slot === REALM_NO_HOME_SLOT || slot === REALM_CASTLE_SLOT || !options.plan) return null;
    const plot = options.plan.homes.find(candidate => candidate.slot === slot);
    return plot ? node(plot.approachId) ?? plot.position : null;
  };

  function speak(now: number, camera: THREE.Camera) {
    if (!walk || walk.spoken || !options.kingdomId) return;
    const self = people?.poses.find(pose => pose.self), mark = self ? walk.room.state.walkers.get(self.id) : undefined;
    if (!self || !mark) return;
    walk.firstSelfAt ??= now;
    if (now - walk.firstSelfAt < SETTLE_MS || (!walk.reply && now - walk.asked < NAME_WAIT_MS)) return;
    walk.spoken = true;
    const standing: ArrivalStanding = monarchCrownOf(mark.crown) ? 'monarch'
      : mark.homeSlot !== undefined && mark.homeSlot !== REALM_NO_HOME_SLOT ? 'citizen' : 'guest';
    if (!firstArrival(options.storage ?? null, options.kingdomId, standing)) return;
    rememberArrival(options.storage ?? null, options.kingdomId, standing);
    const gate = node(options.plan?.castle.gateNodeId), forward = camera.getWorldDirection(new THREE.Vector3());
    const room = walk.room, title = monarchCrownOf(mark.crown) ?? walk.reply?.title;
    walk.line.show({ kingdom: walk.kingdomName, monarch: walk.reply?.name ?? null, standing,
      castle: gate ? bearingWords([self.x, self.z], [forward.x, forward.z], [gate[0], gate[2]]) : null,
      ...(title ? { title } : {}),
      ...(standing === 'monarch' ? { choose: (chosen: MonarchTitle) => room.send(MONARCH_CHANNEL, { version: 1, type: 'title', title: chosen }) } : {}) });
  }

  return {
    /** The stream's walker feed, read through so its crown marks reach this view; frames pass on unchanged. */
    observe(feed: RealmWalkerFeed): RealmWalkerFeed {
      return { subscribe(receive, unavailable) {
        return feed.subscribe((frame: RealmWalkerFrame) => {
          observedCrowns.clear();
          for (const walker of frame.walkers) if (walker.crown) observedCrowns.set(walker.id, walker.crown);
          receive(frame);
        }, () => { observedCrowns.clear(); unavailable(); });
      } };
    },
    attachWalk(room: MonarchRoom, kingdomName: string, host: HTMLElement | null) {
      this.detachWalk();
      if (disposed || !host) return;
      const line = createArrivalLine(host);
      const off = room.onMessage(MONARCH_CHANNEL, raw => {
        const reply = MonarchChannelReplySchema.safeParse(raw);
        if (!reply.success || !walk || walk.room !== room) return;
        walk.reply = reply.data;
        line.title(reply.data.title);
      });
      walk = { room, kingdomName: kingdomName.trim() || 'This kingdom', line, firstSelfAt: null, asked: performance.now(), reply: null, spoken: false,
        stop: () => { if (typeof off === 'function') (off as () => void)(); line.dispose(); } };
      presence.reset();
      try { room.send(MONARCH_CHANNEL, { version: 1, type: 'who' }); } catch { /* The line speaks without the name. */ }
    },
    detachWalk() { walk?.stop(); walk = null; presence.reset(); crown.place(null); },
    /**
     * Once per frame after the walkers are drawn (their head anchors are this frame's). Returns the beacon's
     * catch for the monarch, 0 to 1, to combine with the live beacon.
     */
    frame(now: number, frame: { readonly people: MonarchPeople | null; /** Your own body's opacity (it fades as the camera comes close). */ readonly selfOpacity?: number; readonly camera: THREE.Camera; readonly night: number; readonly time: number }): number {
      if (disposed) return 0;
      people = frame.people;
      const poses = people?.poses ?? [];
      const update = presence.update(now, poses.map(pose => ({ id: pose.id, x: pose.x, y: pose.y, z: pose.z, crown: crownOf(pose.id) ?? null, self: !!pose.self })));
      if (update.arrived) options.bell();
      const monarch = update.monarch, pose = monarch ? poses.find(candidate => candidate.id === monarch.id) : undefined;
      const opacity = monarch?.self ? frame.selfOpacity ?? 1 : 1;
      crown.place(monarch ? people?.heads?.get(monarch.id) : null, pose ? toRadians(pose.yaw) : 0, opacity);
      const dt = lastNow === null ? 0 : Math.min(.1, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      const self = walk ? poses.find(candidate => candidate.self) : undefined;
      const eye = new THREE.Vector3().setFromMatrixPosition(frame.camera.matrixWorld);
      home.update(self ? doorOf(walk!.room.state.walkers.get(self.id)?.homeSlot) : null, eye, frame.night, frame.time, dt);
      speak(now, frame.camera);
      return presence.beacon(now);
    },
    /** The name tags as drawn: the monarch's reads their title and name. */
    labels<T extends Label>(labels: readonly T[]): T[] {
      const monarch = presence.monarch;
      return labels.map(label => monarch && label.id === monarch.id ? { ...label, name: monarchNameTag(monarch.title, label.name) } : label);
    },
    inspect() { const monarch = presence.monarch; return { monarch: monarch ? { title: monarch.title, self: monarch.self } : null, arrivedAt: presence.arrivedAt, lineShown: walk?.line.shown ?? false }; },
    dispose() { if (disposed) return; disposed = true; this.detachWalk(); stopGaze(); crown.dispose(); home.dispose(); },
  };
}
export type MonarchView = ReturnType<typeof createMonarchView>;
