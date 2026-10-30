import { MATERIALS } from '@chatdom/content';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import { KingdomIdSchema, VOXEL_METRES, VoxelBlueprintSchema, type KingdomId, type MaterialRegistry, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import type { RealmFoundedManifest, RealmOwnedHome, RealmPrivateState } from '@chatdom/shared/realm';
import { homeOrigin, transformCardinalPoint, type CardinalTurn, type RealmFoundedBlueprint, type RealmFoundedPlacement, type RealmFoundedScene, type SettlementPlan } from '@chatdom/world';
import { assetHashOf, canonicalSceneJson, sha256Hex, utf8 } from './codec';
import { createNativeTown, type NativeTown } from './native';
import { FoundedSceneError, encodeFoundedScene, validateFoundedScene } from './validate';

export interface FoundedSceneInput {
  readonly kingdomId: KingdomId;
  /** The exact adopted plan, as loaded by `loadAdoptedPlan`; never regenerated. */
  readonly plan: SettlementPlan;
  /** The committed private state under the held writer. Read through an allowlist; never serialized. */
  readonly state: RealmPrivateState;
  /** Checked uint32 chosen by the revision owner for exactly this geometry (see `geometryDigest`). */
  readonly collisionRevision: number;
  /** Prepared native content for `plan`, e.g. from `NativeTownCache`; built here when absent. */
  readonly native?: NativeTown;
  readonly materials?: MaterialRegistry;
}

/** What each street plot shows from committed authority. Private-free; FW03 compares this with the public checkpoint. */
export interface FoundedHomeBinding {
  readonly plotId: string;
  readonly source: 'native' | 'owned';
  /** Owned only: the committed home revision/digest and the attached part IDs, in socket order. */
  readonly revision?: string;
  readonly digest?: string;
  readonly attachments: readonly string[];
}

export interface FoundedSceneBuild {
  readonly scene: RealmFoundedScene;
  /** Exact immutable response bytes; `manifest.sceneHash` is their SHA-256. */
  readonly bytes: Uint8Array;
  readonly manifest: RealmFoundedManifest;
  /**
   * SHA-256 over every geometry input except the collision revision itself: plan, material registry, assets and
   * placements. One digest maps to one collision revision; a different digest must never reuse a revision.
   */
  readonly geometryDigest: string;
  readonly homes: readonly FoundedHomeBinding[];
  readonly counts: { readonly assets: number; readonly placements: number; readonly boxes: number; readonly ownedHomes: number; readonly attachments: number };
}

/**
 * Assemble the public scene for an exact adopted plan and committed state (spec 38 R2/R3): accepted native content,
 * each committed owned home replacing its plot's native home at the plot's own frame (origin derived from the
 * approved size), and only the parts currently attached to it, rebuilt from their committed registered plans and
 * checked against that host. The scene is constructed field by field; owners, receipts, words and names never enter.
 * Validates and encodes before returning. Any inconsistency throws FoundedSceneError.
 */
export async function assembleFoundedScene(input: FoundedSceneInput): Promise<FoundedSceneBuild> {
  const fail = (detail: string): never => { throw new FoundedSceneError(detail); };
  const { plan, state } = input, kingdomId = KingdomIdSchema.parse(input.kingdomId);
  if (state.kingdomId !== kingdomId) fail('the committed state belongs to another kingdom');
  if (!Number.isInteger(input.collisionRevision) || input.collisionRevision < 0 || input.collisionRevision > 0xffffffff) fail('the collision revision is not a uint32');
  const native = input.native ?? createNativeTown(plan);
  if (native.revision !== plan.revision) fail('the native content was prepared for another layout revision');

  const owned = new Map<string, RealmOwnedHome>();
  for (const home of Object.values(state.homes)) {
    const plot = native.homes.get(home.id) ?? fail(`committed home ${home.id} has no plot in layout ${plan.revision}`);
    if (plot.plot.slot !== home.slot) fail(`committed home ${home.id} disagrees with its plot slot`);
    owned.set(home.id, home);
  }
  const attachedIds = new Set<string>();
  const pieces: { id: string; blueprint: VoxelBlueprint; position: Vec3; rotation: CardinalTurn; plotId?: string }[] = [];
  const homes: FoundedHomeBinding[] = [];
  for (const plotHome of native.homes.values()) {
    const plot = plotHome.plot, home = owned.get(plot.id);
    if (!home) {
      pieces.push({ id: plotHome.id, blueprint: plotHome.blueprint, position: plotHome.position, rotation: plotHome.rotation, plotId: plot.id });
      homes.push({ plotId: plot.id, source: 'native', attachments: [] });
      continue;
    }
    // Strict schema: no field beyond the public blueprint. Keep the committed object itself, because Forge host
    // fingerprints hash its exact JSON text, key order included.
    if (!VoxelBlueprintSchema.safeParse(home.blueprint).success) fail(`committed home ${home.id} has an invalid blueprint`);
    const blueprint = home.blueprint;
    if (blueprint.kind !== 'home') fail(`committed home ${home.id} is not a home blueprint`);
    let origin: Vec3;
    try { origin = homeOrigin(plot, blueprint.size[2] * VOXEL_METRES.build); }
    catch { return fail(`committed home ${home.id} is deeper than its plot`); }
    pieces.push({ id: plotHome.id, blueprint, position: origin, rotation: plot.rotation, plotId: plot.id });
    const sockets = Object.keys(home.attachments).length ? findForgeSockets(blueprint) : [];
    const fingerprint = sockets.length ? homeFingerprint(blueprint) : '';
    const parts: string[] = [];
    for (const socketId of Object.keys(home.attachments).sort()) {
      const id = home.attachments[socketId]!, item = Object.hasOwn(state.attachments, id) ? state.attachments[id] : undefined;
      if (!item || !item.attached || item.homeId !== home.id) fail(`home ${home.id} lists part ${id} that is not attached to it`);
      const part = item!.attachment;
      if (part.socketId !== socketId || part.hostId !== blueprint.id || part.slot !== home.slot || part.kingdomId !== kingdomId
        || part.hostFingerprint !== fingerprint) fail(`part ${id} does not fit the committed home ${home.id}`);
      const socket = sockets.find(s => s.id === socketId) ?? fail(`home ${home.id} no longer has socket ${socketId}`);
      if (socket.origin.some((n, axis) => n !== part.origin[axis])) fail(`part ${id} sits away from its socket`);
      const kit = forgeStyleKit(part.family);
      if (kit.id !== part.kitId || kit.revision !== part.kitRevision) fail(`part ${id} names an unregistered kit`);
      let piece: VoxelBlueprint;
      try { const assembled = assembleForge(part.draft.plan, kit, socket); checkForge(assembled, blueprint); piece = assembled.blueprint; }
      catch { return fail(`part ${id} no longer assembles on home ${home.id}`); }
      const local: Vec3 = [part.origin[0] * VOXEL_METRES.build, part.origin[1] * VOXEL_METRES.build, part.origin[2] * VOXEL_METRES.build];
      pieces.push({ id: `forge:${part.id}`, blueprint: piece, position: transformCardinalPoint(origin, plot.rotation, local), rotation: plot.rotation, plotId: plot.id });
      attachedIds.add(id); parts.push(part.id);
    }
    homes.push({ plotId: plot.id, source: 'owned', revision: home.revision, digest: home.digest, attachments: parts });
  }
  for (const [id, item] of Object.entries(state.attachments)) if (item.attached && !attachedIds.has(id)) fail(`attached part ${id} is not listed by its home`);
  for (const fixture of native.fixtures) pieces.push({ id: fixture.id, blueprint: fixture.blueprint, position: fixture.position, rotation: fixture.rotation });

  // Content identity is the exact bytes; one factory object is hashed once, distinct bytes stay distinct.
  const hashes = new Map<VoxelBlueprint, string>(), assets = new Map<string, RealmFoundedBlueprint>();
  const placements: RealmFoundedPlacement[] = [];
  for (const piece of pieces) {
    let assetHash = hashes.get(piece.blueprint);
    if (!assetHash) { assetHash = await assetHashOf(piece.blueprint); hashes.set(piece.blueprint, assetHash); }
    if (!assets.has(assetHash)) assets.set(assetHash, { assetHash, blueprint: piece.blueprint });
    const position: Vec3 = [piece.position[0], piece.position[1], piece.position[2]];
    placements.push(piece.plotId === undefined ? { id: piece.id, assetHash, position, rotation: piece.rotation }
      : { id: piece.id, assetHash, position, rotation: piece.rotation, plotId: piece.plotId });
  }
  const candidate: RealmFoundedScene = {
    version: 1, kingdomId, origin: state.origin, layoutRevision: plan.revision, collisionRevision: input.collisionRevision,
    plan, materials: input.materials ?? MATERIALS, assets: [...assets.values()], placements,
  };
  const scene = await validateFoundedScene(JSON.parse(canonicalSceneJson(candidate)));
  const { bytes, manifest } = await encodeFoundedScene(scene);
  const geometry = { version: scene.version, kingdomId: scene.kingdomId, origin: scene.origin, layoutRevision: scene.layoutRevision,
    plan: scene.plan, materials: scene.materials, assets: scene.assets, placements: scene.placements };
  const geometryDigest = await sha256Hex(utf8(canonicalSceneJson(geometry)));
  return { scene, bytes, manifest, geometryDigest, homes,
    counts: { assets: scene.assets.length, placements: scene.placements.length, boxes: scene.assets.reduce((n, a) => n + a.blueprint.boxes.length, 0),
      ownedHomes: owned.size, attachments: attachedIds.size } };
}
