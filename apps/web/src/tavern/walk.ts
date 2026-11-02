import * as THREE from 'three';
import { createVoxelMaterial } from '@chatdom/render';
import { MATERIALS } from '@chatdom/content/materials';
import { createInteractionRegistry } from '@chatdom/world/interactions';
import { tavernPlacement, tavernSeatOf } from '../../../../packages/world/src/interactions/places';
import { createCitizenRenderer, createDefaultCitizenLooks } from '../citizens';
import { createWalkController } from '../walk';
import { mountInteractionController } from '../interactions';
import { bindWalkInteractions } from '../kingdom/walk-interactions';
import { presentWalkers } from '../kingdom/walker-presentation';
import { createShotEase } from '../interactions/places/framing';
import type { InteractionPlaces } from '../interactions/ports';
import type { InteractionAccepted, InteractionSession } from '../interactions/session';
import type { RealmPrivateMessage } from '@chatdom/shared/realm';
import type { GameInputLease } from '../games/input';
import { bindPongHand } from '../games/input';
import { bindTurnHand } from '../games/turn-input';
import type { TavernClient } from './client';
import type { createTavernStage } from './stage';
import { tavernInteriorEnvironment, tavernLight, tavernLightSources } from './light';
import { seatApproachDriver } from '../games/walker';
import { TAVERN_ROOM_BOUNDS } from '../../../../packages/content/src/tavern';
import { tableGame } from '../games/boards';
import { createRetainedSeatRestore } from './retained-seat';
import { tavernTableFraming } from './framing';
import { createNameMeasurer, layoutNames, type NameCandidate } from './name-labels';

export interface TavernWalkState {
  readonly ready: boolean;
  readonly connected: boolean;
  readonly seated: string | null;
  readonly column: number | null;
  readonly names: readonly { readonly id: string; readonly name: string; readonly x: number; readonly y: number }[];
}
/** Compose existing movement, citizen and interaction owners around the tavern's room and tabletop. */
export async function mountTavernWalk(stage: ReturnType<typeof createTavernStage>, client: TavernClient, options: {
  readonly host: HTMLElement;
  readonly requestInput: (reason: string) => GameInputLease;
  readonly onState: (state: TavernWalkState) => void;
  readonly onAffordance?: (table: string) => void;
  /** Loopback test-session route only; never a spawn or a seat grant. */
  readonly benchSeat?: string;
}) {
  const kit = stage.tavern.kit;
  const registry = createInteractionRegistry({ layoutRevision: client.interior.layoutRevision, world: client.world,
    placements: [tavernPlacement({ tavern: 'main', origin: [0, 0, 0], turn: 0, seats: kit.tables.flatMap(t => t.seats), source: 'tavern:interior-v1' })] });
  if (registry.disabled.length || JSON.stringify(registry.targets()) !== JSON.stringify(client.interior.targets)) throw new Error('The tavern chairs have changed. Enter again.');
  const avatar = createVoxelMaterial(MATERIALS, 'avatar');
  const light = tavernLight(tavernLightSources(kit.hearth)); avatar.setLight(light);
  avatar.setEnvironment(tavernInteriorEnvironment(19));
  const bench = client.room.state.origin === 'simulated' ? (await import('./bench-looks')).benchCitizenLooks() : [];
  const looks = [...createDefaultCitizenLooks(), ...bench], people = await createCitizenRenderer(stage.scene, { registry: MATERIALS, material: avatar, looks, capacity: 128 });
  if ([...client.room.state.walkers.values()].some(walker => !looks.some(look => look.id === walker.look))) {
    people.dispose(); avatar.dispose(); throw new Error('A citizen’s clothes could not be opened. Enter again shortly.');
  }
  const destination = options.benchSeat && client.room.state.origin === 'simulated' ? registry.get(options.benchSeat) : undefined;
  const drive = destination ? seatApproachDriver(client.world, [client.predicted.x, client.predicted.y, client.predicted.z], destination.target.approach, TAVERN_ROOM_BOUNDS) : null;
  let drivenInput: ReturnType<NonNullable<typeof drive>['input']> | null = null;
  let asked = false;
  const realm = { selfId: client.selfId, room: client.room, predicted: client.predicted, clearInput: () => client.clearInput?.(),
    tick(now: number, input: Parameters<TavernClient['tick']>[1]) {
      const sample = drive && !asked ? drive.input(client.predicted) : input;
      drivenInput = drive && !asked ? sample : null;
      const poses = client.tick(now, sample);
      if (drive?.done && !asked && destination) {
        asked = true;
        if (connection.session.snapshot().self.mode !== 'seated') connection.session.request(destination.target.id, 'tavern');
      }
      return poses;
    } };
  const controller = createWalkController({ camera: stage.camera, surface: stage.canvas, realm, collision: client.world,
    hud: options.host, heading: client.interior.entry.yaw * Math.PI / 128 });
  const connection = bindWalkInteractions(client.room);
  // Restore a retained seat only from a fresh room bootstrap, through the existing camera/interaction owner.
  // A late answer to an abandoned local request never passes through this restoration path.
  const restored = new Set<(accepted: InteractionAccepted) => void>();
  const retainedSeat = createRetainedSeatRestore();
  const offRestore = client.room.onMessage('private', (message: RealmPrivateMessage) => {
    if (message.type === 'interaction' && message.requestId === null && message.writerEpoch === client.room.state.writerEpoch) retainedSeat.witness(message.state);
  });
  const session: InteractionSession = { ...connection.session, onAccepted(listener) {
    restored.add(listener); const off = connection.session.onAccepted(listener);
    return () => { restored.delete(listener); off(); };
  } };
  let tableView: { frame(dt: number, now: number): void; column(): number | null; close(): void } | null = null;
  let selected: string | null = null, disposed = false;
  const places: InteractionPlaces = {
    open({ action, record }) {
      const chair = tavernSeatOf(record.target.id), table = kit.tables.find(t => t.id === chair?.table);
      if (action !== 'tavern' || !chair || !table) return null;
      const seat = Number(chair.seat) - 1, authoredSeat = table.seats.find(s => s.key === `${table.id}:${chair.seat}`);
      if (!authoredSeat) return null;
      const game = tableGame(table.id);
      let aspect = stage.camera.aspect;
      // Same board as the miniature. Frame over this end, above the actual seat; hide only the local body.
      const framing = () => tavernTableFraming(table.centre, authoredSeat.facing, game, stage.camera.aspect, client.world);
      const shot = framing();
      if (!shot) return null;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      stage.camera.fov = shot.fov; stage.camera.filmOffset = 0; stage.camera.updateProjectionMatrix();
      let ease = createShotEase(stage.camera, shot, { reducedMotion });
      const lease = options.requestInput(`${game}:${table.id}`);
      const turnHand = game === 'pong' ? null : bindTurnHand(lease, () => ({
        table: client.self.table === table.id ? client.tables.tables.find(t => t.table === table.id) ?? null : null,
        playerIndex: client.self.playerIndex ?? null, physicalSeat: client.self.seatIndex ?? client.self.seat,
        connected: client.connected,
      }), { start: id => { options.onAffordance?.(id); client.start(id); },
        move: (action, column) => { options.onAffordance?.(table.id); client.move(action, column); } });
      const hand = game === 'pong' ? bindPongHand(lease, seat as 0 | 1, { target: () => client.presentations.get(table.id)?.aimPosition ?? 0,
        aim: (value, now) => client.aim(value, now), start: () => { options.onAffordance?.(table.id); client.start(table.id); } }, () => performance.now()) : turnHand!;
      selected = table.id;
      const view = { frame(dt: number, now: number) {
        if (aspect !== stage.camera.aspect) {
          aspect = stage.camera.aspect;
          const next = framing(); if (next) { ease = createShotEase(stage.camera, next, { reducedMotion }); stage.camera.fov = next.fov; }
          stage.camera.updateProjectionMatrix();
        }
        ease.frame(now); hand.frame(dt, now);
      },
        column: () => game === 'stones' ? turnHand!.column() : null,
        close() { retainedSeat.clear(); hand.dispose(); if (tableView === view) { tableView = null; selected = null; } } };
      tableView = view;
      return { close: () => view.close() };
    },
  };
  const interactions = mountInteractionController({ host: options.host, surface: stage.canvas, session, camera: controller, places });
  const direction = new THREE.Vector3(), projected = new THREE.Vector3(), raycaster = new THREE.Raycaster();
  const offResize = stage.onResize((width, height) => controller.resize(width, height));
  const offFeet = stage.localFeet(() => [client.predicted.x, client.predicted.y, client.predicted.z]);
  const nameMeasurer = createNameMeasurer(options.host);
  let nameViewport = { width: 0, height: 0 };
  let lastNames = -Infinity, ready = false, wasConnected = client.connected, lastColumn: number | null = null;
  let observedDisconnects = client.disconnects;
  // A fast reconnect can fit between rendered frames. Retire the old lease at the transport event itself.
  const offConnection = client.subscribe(() => {
    if (!client.connected && (wasConnected || observedDisconnects !== client.disconnects)) {
      controller.release(); tableView?.close(); retainedSeat.clear(); wasConnected = false;
      observedDisconnects = client.disconnects;
    }
  });
  const offFrame = stage.onFrame((dt, now) => {
    if (disposed) return;
    if (!client.connected) { controller.release(); tableView?.close(); }
    else if (!wasConnected) controller.resume();
    wasConnected = client.connected;
    tableView?.frame(dt, now);
    const poses = presentWalkers(controller.frame(now), connection.session.snapshot().seats, registry);
    const gameFrame = client.gameFrame(now); stage.tavern.games(gameFrame);
    const self = controller.debug.self;
    if (self) {
      stage.camera.getWorldDirection(direction);
      interactions.frame({ now, look: { feet: [self.x, self.y, self.z], forward: [direction.x, direction.y, direction.z] },
        records: registry.records, world: client.connected ? client.world : null, actor: { walkerId: client.selfId, zone: 'tavern:main', ownedPlotId: null },
        project(point) {
          projected.set(...point).project(stage.camera); if (projected.z < -1 || projected.z > 1) return null;
          return { x: (projected.x + 1) * stage.canvas.clientWidth / 2, y: (1 - projected.y) * stage.canvas.clientHeight / 2 };
        },
        ray(x, y) {
          raycaster.setFromCamera(new THREE.Vector2(x / stage.canvas.clientWidth * 2 - 1, 1 - y / stage.canvas.clientHeight * 2), stage.camera);
          return { origin: raycaster.ray.origin.toArray() as [number, number, number], direction: raycaster.ray.direction.toArray() as [number, number, number] };
        },
      });
      if (destination && !asked) {
        if (session.snapshot().self.mode === 'seated') asked = true;
        // A visible prompt can precede the authority's next position patch. A sent request is not an
        // accepted chair: finish the authored approach before the one bench request in realm.tick.
      }
      // Duplicate bootstrap must not leave a latent restore behind an already open view.
      if (tableView) retainedSeat.clear();
      const accepted = client.connected ? retainedSeat.next(session.snapshot(), controller.owner) : null;
      if (accepted) for (const listener of restored) listener(accepted);
    }
    people.update(poses.map(pose => ({ id: pose.id, look: pose.look, position: [pose.x, pose.y, pose.z], heading: pose.yaw * Math.PI / 128,
      distance: pose.distance, moving: Math.min(1, pose.speed / 1.2), speed: pose.speed, time: now / 1000,
      ...(pose.posture ? { posture: pose.posture } : {}), opacity: pose.self ? selected ? 0 : controller.selfOpacity : 1 })), stage.camera);
    const candidates: NameCandidate[] = [];
    const column = tableView?.column() ?? null;
    if (now - lastNames > 200 || !ready || column !== lastColumn) {
      for (const pose of poses) {
        // Your own name never floats over a body you cannot see: seated, or faded as the camera comes in.
        if (pose.self && (selected || controller.selfOpacity < .5)) continue;
        const head = people.heads.get(pose.id); if (!head || head.distanceTo(stage.camera.position) > 20) continue;
        projected.copy(head).project(stage.camera); if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) continue;
        candidates.push({ id: pose.id, name: pose.name, x: (projected.x + 1) * stage.canvas.clientWidth / 2, y: (1 - projected.y) * stage.canvas.clientHeight / 2, distance: head.distanceTo(stage.camera.position), width: nameMeasurer.width(pose.name) });
      }
      nameViewport = { width: stage.canvas.clientWidth, height: stage.canvas.clientHeight };
      const names = layoutNames(candidates, nameViewport.width, nameViewport.height);
      ready ||= controller.debug.ready && poses.length > 0; lastNames = now; lastColumn = column;
      options.onState({ ready, connected: client.connected, seated: selected, column, names });
    }
    (window as Window & { __chatdomTavernLive?: unknown }).__chatdomTavernLive = {
      ready, nameViewport, connected: client.connected, disconnects: client.disconnects, reconnects: client.reconnects,
      ended: client.ended, resumeStored: client.resumeStored,
      self: controller.debug.self, input: controller.debug.input,
      ...(drive ? { approach: { done: drive.done, requested: asked, ...drive.progress, input: drivenInput,
        predicted: { x: client.predicted.x, y: client.predicted.y, z: client.predicted.z }, authority: controller.debug.authority } } : {}),
      walkers: poses.map(pose => ({ id: pose.id, name: pose.name, x: pose.x, y: pose.y, z: pose.z, posture: pose.posture ?? 'standing' })),
      seated: selected, column, interaction: interactions.debug, tables: gameFrame.tables,
    };
  });
  return { registry, controller, interactions,
    dispose() { if (disposed) return; disposed = true; nameMeasurer.dispose(); offFrame(); offResize(); offFeet(); offRestore(); offConnection(); retainedSeat.clear(); restored.clear(); tableView?.close(); interactions.dispose(); connection.dispose(); controller.dispose(); people.dispose(); avatar.dispose(); },
  };
}
