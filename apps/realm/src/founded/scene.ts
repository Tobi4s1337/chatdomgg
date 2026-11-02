import { MATERIALS } from '@chatdom/content';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import { KingdomIdSchema, VOXEL_METRES, VoxelBlueprintSchema, type KingdomId, type MaterialRegistry, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { REALM_CASTLE_SLOT, castleHostId, type RealmFoundedManifest, type RealmOwnedForgeHost, type RealmOwnedHome, type RealmPrivateState } from '@chatdom/shared/realm';
import { homeOrigin, transformCardinalPoint, type CardinalTurn, type RealmFoundedBlueprint, type RealmFoundedPlacement, type RealmFoundedScene, type SettlementPlan } from '@chatdom/world';
import { assetHashOf, canonicalSceneJson, sha256Hex, utf8 } from './codec';
import { createNativeTown, type NativeTown } from './native';
import { FoundedSceneError, encodeFoundedScene, validateFoundedScene } from './validate';
import { FOUNDED_PHYSICS_VERSION } from './collision';
import { arrivalFurnishings } from './arrival-furnishings';
import { installFoundedCivicGrowth, type FoundedCivicDiagnostic } from './civic-growth';
import { pierFurnishings } from '../fishing/site';
import { campfireClearingPieces } from '../campfire/clearing';

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

export interface FoundedCastleBinding {
  readonly moduleId: string;
  readonly revision: string;
  readonly digest: string;
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
  readonly castle: FoundedCastleBinding | null;
  /** Physical places that could not be installed without changing accepted content or reserved ground. */
  readonly civicUnavailable: readonly FoundedCivicDiagnostic[];
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
  const attach = (home: RealmOwnedForgeHost, origin: Vec3, rotation: CardinalTurn, plotId?: string): string[] => {
    const profile = 'moduleId' in home ? 'castle-keep' : 'street-home';
    const blueprint = home.blueprint;
    // Each part reconstructs with the kit revision it was forged and approved with (SEAMS.md §9).
    const fingerprint = Object.keys(home.attachments).length ? homeFingerprint(blueprint) : '';
    const parts: string[] = [];
    for (const socketId of Object.keys(home.attachments).sort()) {
      const id = home.attachments[socketId]!, item = Object.hasOwn(state.attachments, id) ? state.attachments[id] : undefined;
      if (!item || !item.attached || item.homeId !== home.id) fail(`home ${home.id} lists part ${id} that is not attached to it`);
      const part = item!.attachment;
      if (part.socketId !== socketId || part.hostId !== blueprint.id || part.slot !== home.slot || part.kingdomId !== kingdomId
        || part.hostFingerprint !== fingerprint || (part.hostProfile ?? 'street-home') !== profile) fail(`part ${id} does not fit the committed home ${home.id}`);
      let kit: ReturnType<typeof forgeStyleKit>;
      try { kit = forgeStyleKit(part.family, part.kitRevision); } catch { return fail(`part ${id} names an unregistered kit`); }
      if (kit.id !== part.kitId) fail(`part ${id} names an unregistered kit`);
      const sockets = findForgeSockets(blueprint, profile, kit.revision);
      const socket = sockets.find(s => s.id === socketId) ?? fail(`home ${home.id} no longer has socket ${socketId}`);
      if (socket.origin.some((n, axis) => n !== part.origin[axis])) fail(`part ${id} sits away from its socket`);
      let piece: VoxelBlueprint;
      try { const assembled = assembleForge(part.draft.plan, kit, socket); checkForge(assembled, blueprint, profile); piece = assembled.blueprint; }
      catch { return fail(`part ${id} no longer assembles on home ${home.id}`); }
      const local: Vec3 = [part.origin[0] * VOXEL_METRES.build, part.origin[1] * VOXEL_METRES.build, part.origin[2] * VOXEL_METRES.build];
      pieces.push({ id: `forge:${part.id}`, blueprint: piece, position: transformCardinalPoint(origin, rotation, local), rotation, ...(plotId === undefined ? {} : { plotId }) });
      attachedIds.add(id); parts.push(part.id);
    }
    return parts;
  };

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
    const parts = attach(home, origin, plot.rotation, plot.id);
    homes.push({ plotId: plot.id, source: 'owned', revision: home.revision, digest: home.digest, attachments: parts });
  }
  let castle: FoundedCastleBinding | null = null;
  const ownedCastle = state.castle;
  const keepId = castleHostId(plan.castle.beaconModuleId);
  const keep = native.fixtures.find(fixture => fixture.id === keepId) ?? fail('the native town has no beacon keep');
  if (ownedCastle) {
    if (ownedCastle.id !== keepId || ownedCastle.moduleId !== plan.castle.beaconModuleId || ownedCastle.slot !== REALM_CASTLE_SLOT
      || ownedCastle.layoutRevision !== plan.revision) fail('the committed castle disagrees with the adopted keep');
    if (!VoxelBlueprintSchema.safeParse(ownedCastle.blueprint).success || ownedCastle.blueprint.kind !== 'civic') fail('the committed castle is not a civic blueprint');
    const parts = attach(ownedCastle, keep.position, keep.rotation);
    castle = { moduleId: ownedCastle.moduleId, revision: ownedCastle.revision, digest: ownedCastle.digest, attachments: parts };
  }
  for (const [id, item] of Object.entries(state.attachments)) if (item.attached && !attachedIds.has(id)) fail(`attached part ${id} is not listed by its host`);
  const civic = installFoundedCivicGrowth(plan, native, state.growth);
  for (const fixture of civic.fixtures) pieces.push({ id: fixture.id,
    blueprint: ownedCastle && fixture.id === keepId ? ownedCastle.blueprint : fixture.blueprint,
    position: fixture.position, rotation: fixture.rotation });
  pieces.push(...arrivalFurnishings(plan, pieces));
  pieces.push(...pierFurnishings(plan, pieces));
  pieces.push(...campfireClearingPieces(plan, pieces));

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
  const geometry = { compiler: FOUNDED_PHYSICS_VERSION, version: scene.version, kingdomId: scene.kingdomId, origin: scene.origin, layoutRevision: scene.layoutRevision,
    plan: scene.plan, materials: scene.materials, assets: scene.assets, placements: scene.placements };
  const geometryDigest = await sha256Hex(utf8(canonicalSceneJson(geometry)));
  return { scene, bytes, manifest, geometryDigest, homes, castle, civicUnavailable: civic.unavailable,
    counts: { assets: scene.assets.length, placements: scene.placements.length, boxes: scene.assets.reduce((n, a) => n + a.blueprint.boxes.length, 0),
      ownedHomes: owned.size, attachments: attachedIds.size } };
}
