/**
 * The exact settlement content of a kingdom, as explicit voxel pieces for the grand view's kingdom layer.
 *
 * Every piece here is a piece today's kingdom view installs, with the same blueprint object, metres and yaw:
 * - an adopted (or SIMULATED founded) kingdom: its `RealmFoundedScene` placements, through `foundedContent`;
 * - a potential Genesis kingdom: the composition `genesis/index.tsx` opens, placed as `createKingdomScene` places a
 *   potential plan (homes and garden edges, the shifted market, the water structures, the castle or the kingdom's
 *   own seat, the court, and the picture groves on the same planting sites).
 *
 * Left out on purpose, because the grand land supplies them: the small-world terrain and its horizon, the water
 * surfaces, ground-cover dressing (`planAdoptedCover`) and shore reeds and lilies (`planShoreDressing`).
 * Positions stay in settlement metres; the kingdom layer places the whole set at its `GrandSeat.offset`.
 */
import { createHorizonSurface } from '../../../kingdom/horizon';
import { createCastleContent, createCastleCourtContent } from '../../../kingdom/castle-content';
import { foundedContent } from '../../../kingdom/founded-content';
import { foundedForgeSites, foundedLifeSites } from '../../../kingdom/home-life-sites';
import { royalWindow } from '../../../kingdom/royal-window';
import { placeMarketContent, type Dressing } from '../../../kingdom/settlement-content';
import { groveBatches, plantGrove, type TreeSite } from '../../../kingdom/trees';
import type { RoyalBrazier } from '../../../kingdom/royal-life';
import { GENESIS_CHANNELS, PROFILE_CAPTURED_AT } from '../../../genesis/channels';
import { genesisKingdomComposer } from '../../../genesis/kingdom-composer';
import { GENESIS_KINGDOMS } from '../../../genesis/kingdoms';
import { composeMashaKingdom, MASHA_ID } from '../../../genesis/kingdoms/masha';
import { createGenesisSeatContent, type GenesisSeatContent } from '../../../genesis/seat-content';
import { createGenesisWaterContent } from '../../../genesis/water-content';
import { assembleFoundedScene } from '../../../../../realm/src/founded/scene';
import { createNativeTown } from '../../../../../realm/src/founded/native';
import { enrichNativeMarket } from '../../../../../realm/src/founded/market-furnishings';
import { enrichNativeMarketSeats } from '../../../../../realm/src/founded/market-seats';
import { enrichNativeForgeHearth, enrichNativeForgeWorkshop } from '../../../../../realm/src/founded/forge-hearth-furnishings';
import { enrichNativePictureGroves } from '../../../../../realm/src/founded/picture-groves';
import { createStreetProp, type StreetPropForm } from '@chatdom/content';
import { createNativeForgeHost } from '@chatdom/forge';
import type { WindowHouse } from '@chatdom/render';
import { KingdomIdSchema, VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { generateSettlementPlan, homeOrigin, randomUnit, samplePublicGround, seedHash, terrainHeight, transformCardinalPoint, type KingdomConfig, type RealmFoundedScene, type SettlementHome, type SettlementPlan } from '@chatdom/world';
import { compileChannelGenesis, compileGenesisSettlement, sampleGenesisSurface, type ChannelKingdomRecipe, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '@chatdom/world/genesis/observed';
import { createRealmState } from '@chatdom/world/realm';

export type GrandPieceRole = 'home' | 'castle' | 'civic' | 'prop' | 'tree' | 'seat';
export type GrandStyle = 'hearth' | 'tide' | 'grove';

/**
 * One placed voxel blueprint, in settlement metres at the blueprint's local origin, turned by `yaw` radians about +Y
 * (the kingdom view's instancing convention).
 *
 * Roles: `home` a citizen's street home (`slot` set); `castle` the castle buildings (plan modules, or the keep a
 * seat raises in their place); `civic` market, Forge square, court fires, arrival fixtures, piers and bridges;
 * `prop` garden edges, door lanterns and forged parts; `tree` the settlement's own groves; `seat` a kingdom's
 * authored seat dressing (The_AGGman's harbour, MashaD4's city, PinkKittyRose's hall, tavern and keepers' places).
 */
export interface GrandPiece {
  readonly id: string;
  readonly blueprint: VoxelBlueprint;
  readonly position: Vec3;
  readonly yaw: number;
  /** The plot's citizen slot, for presence windows. Homes only. */
  readonly slot?: number;
  readonly role: GrandPieceRole;
  /** Founded content only: the producer's content identity and placement ID. */
  readonly assetHash?: string;
  readonly placementId?: string;
}

export type GrandEvidence = 'adopted' | 'potential' | 'simulated';

export interface GrandKingdomContent {
  readonly kingdomId: string;
  readonly name: string;
  readonly login: string;
  readonly plan: SettlementPlan;
  readonly style: GrandStyle;
  /** `adopted`: live founded bytes. `potential`: Genesis scenery, no deeds. `simulated`: shown as SIMULATED. */
  readonly evidence: GrandEvidence;
  readonly recipe: DeepReadonly<ChannelKingdomRecipe> | null;
  readonly landscape: DeepReadonly<GenesisLandscape> | null;
  readonly pieces: GrandPiece[];
  /** What `createWindowLights` lights: the street homes, plus the monarch's keep window on a founded kingdom. */
  readonly houses: WindowHouse[];
  /** Hosts a Forge flight can land on (founded: homes and the beacon keep; potential: the homes). */
  readonly forgeHosts: WindowHouse[];
  /** Open flames the court and arrival fixtures carry (gate braziers, seat lanterns). */
  readonly braziers: RoyalBrazier[];
  /** Forge square fires on a founded kingdom; none on potential land. */
  readonly forgeFires: RoyalBrazier[];
  readonly beaconPosition: Vec3 | null;
  readonly founded: RealmFoundedScene | null;
}

export interface FoundedKingdomMeta {
  readonly name: string;
  readonly login: string;
  /** The kingdom's family for banners and Forge; the kingdom view's default is `tide`. */
  readonly style?: GrandStyle;
}

/** tobi4s_'s kingdom as the realm founds it. With no adopted bytes read here, everything shown from it is SIMULATED. */
export const WILLOWMERE = {
  kingdomId: '129634568', name: 'Willowmere', login: 'tobi4s_',
  config: { seed: 'tobi4s_', tier: 'town', firstYear: 2019, year: 2026 } satisfies KingdomConfig,
} as const;

/** The adopted path: every placement of the founded scene, exactly as `createKingdomScene` installs it. */
export function foundedKingdomContent(scene: RealmFoundedScene, meta: FoundedKingdomMeta): GrandKingdomContent {
  const installed = foundedContent(scene);
  const slots = new Map(installed.houses.map(house => [(house as { placementId?: string }).placementId, house.slot]));
  const castle = new Set(scene.plan.castle.modules.map(module => `castle:${module.id}`));
  const pieces = installed.content.map((placed): GrandPiece => {
    const slot = slots.get(placed.placementId);
    const base = { id: placed.placementId, blueprint: placed.blueprint, position: placed.position, yaw: placed.yaw,
      assetHash: placed.assetHash, placementId: placed.placementId };
    if (slot !== undefined) return { ...base, role: 'home', slot };
    return { ...base, role: foundedRole(placed.placementId, placed.blueprint, castle) };
  });
  const royal = royalWindow(installed.forgeHosts);
  const life = foundedLifeSites(scene), forge = foundedForgeSites(scene);
  return {
    kingdomId: scene.kingdomId, name: meta.name, login: meta.login, plan: scene.plan, style: meta.style ?? 'tide',
    // A SIMULATED founding is never presented as adopted land.
    evidence: scene.origin === 'live' ? 'adopted' : 'simulated',
    recipe: null, landscape: null, pieces,
    houses: royal ? [...installed.houses.map(windowHouse), royal] : installed.houses.map(windowHouse),
    forgeHosts: installed.forgeHosts.map(windowHouse), braziers: life.braziers, forgeFires: forge.fires,
    beaconPosition: createCastleContent(scene.plan.castle).beaconPosition, founded: scene,
  };
}

function foundedRole(id: string, blueprint: VoxelBlueprint, castle: ReadonlySet<string>): GrandPieceRole {
  if (castle.has(id)) return 'castle';
  if (blueprint.kind === 'flora') return 'tree';
  if (blueprint.kind === 'civic' || /^(market|forge:(hearth|workshop|brazier)|arrival:(gate|standard)):/.test(id)) return 'civic';
  return 'prop';
}

const loads = new Map<string, Promise<GrandKingdomContent>>();

/**
 * The grand view's content for one of the kingdoms it can show: `tobi4s_` (the realm's founding of Willowmere,
 * SIMULATED), or a Genesis channel by login or broadcaster ID (`the_aggman`, `pinkkittyrose`, `mashad4`).
 * Compositions are heavy, so each kingdom is composed once per page.
 */
export function loadGrandKingdomContent(login: 'tobi4s_' | 'the_aggman' | 'pinkkittyrose' | 'mashad4' | (string & {})): Promise<GrandKingdomContent> {
  const key = login.trim().toLowerCase();
  let load = loads.get(key);
  if (!load) {
    load = key === WILLOWMERE.login || key === WILLOWMERE.kingdomId
      ? Promise.resolve().then(() => simulatedFoundedContent(WILLOWMERE.kingdomId, willowmerePlan(), { name: WILLOWMERE.name, login: WILLOWMERE.login }))
      : potentialKingdom(key);
    loads.set(key, load);
    load.catch(() => loads.delete(key));
  }
  return load;
}

/**
 * Willowmere's plan. The realm keeps tobi4s_'s adopted plan; with none read here, the founding config is generated
 * again. Today's generator lays out at most five quarters, so it refuses the 2019 founding (eight quarters); the
 * plan then falls back to the same seed at the kingdom view's own town default (`/?seed=tobi4s_`), first year 2022.
 * Either way it is SIMULATED, and `plan.config` says which one was drawn.
 */
export function willowmerePlan(): SettlementPlan {
  try { return generateSettlementPlan(WILLOWMERE.config); }
  catch { return generateSettlementPlan({ ...WILLOWMERE.config, firstYear: 2022 }); }
}

/**
 * The realm provider's founding of `plan` with no citizens yet: native town, reviewed market, seat and Forge
 * furnishings, picture groves and arrival fixtures, assembled and validated as a SIMULATED founded scene. Main can
 * pass the adopted plan here when it has one (as the live bench copies it) to show the real streets.
 */
export async function simulatedFoundedContent(kingdomId: string, plan: SettlementPlan, meta: FoundedKingdomMeta): Promise<GrandKingdomContent> {
  const id = KingdomIdSchema.parse(kingdomId);
  const native = createNativeTown(plan);
  const furnished = enrichNativeForgeWorkshop(plan, enrichNativeForgeHearth(plan, enrichNativeMarketSeats(plan, enrichNativeMarket(plan, native))));
  const build = await assembleFoundedScene({ kingdomId: id, plan, state: createRealmState(id, 'simulated'),
    native: enrichNativePictureGroves(plan, furnished), collisionRevision: 0 });
  return foundedKingdomContent(build.scene, meta);
}

/** The same composition `genesis/index.tsx` opens for a potential holding, without the adopted-land read. */
async function potentialKingdom(key: string): Promise<GrandKingdomContent> {
  const channel = GENESIS_CHANNELS.find(item => item.login === key || item.id === key);
  if (!channel) throw new Error(`No grand kingdom is available for ${key}.`);
  const id = channel.id;
  const observed = OBSERVED_GENESIS_FIXTURES.find(item => item.broadcasterId === id);
  const choice = OBSERVED_GENESIS_SHOWCASE_CHOICES.find(item => item.broadcasterId === id);
  if (!observed || !choice) throw new Error(`${channel.name}’s land has no observed fixture.`);
  const facts = { ...observed, profileColours: [...channel.palette], evidence: {
    kind: 'observed' as const, sourceId: 'atlas-20261030-helix-20261031', asOf: Date.parse(PROFILE_CAPTURED_AT),
  } };
  const own = await (await GENESIS_KINGDOMS[id]?.())?.composeGenesisKingdom({ facts, character: choice.character });
  const recipe = own?.recipe ?? compileChannelGenesis(facts);
  const selected = own?.landscape ?? recipe.landscapes.find(item => item.character === choice.character)!;
  const mountain = id === MASHA_ID ? composeMashaKingdom(recipe, selected) : undefined;
  const landscape = mountain?.landscape ?? selected;
  const proposed = own?.plan ?? mountain?.plan ?? compileGenesisSettlement(recipe, landscape.id);
  const composed = own ?? mountain ?? genesisKingdomComposer(id)?.compose({ recipe, landscape, plan: proposed });
  const plan = composed?.plan ?? proposed;
  const seat = composed?.seat ?? (choice.character === 'coastal-harbour' ? createGenesisSeatContent(recipe, landscape, plan) : undefined);
  const style = mountain?.style ?? recipe.identity.styleFamily;
  return { kingdomId: id, name: channel.name, login: channel.login, evidence: 'potential', recipe, landscape,
    ...potentialContent(plan, style, seat) };
}

/** `createKingdomScene`'s placement of a potential plan, piece for piece. */
function potentialContent(plan: SettlementPlan, style: GrandStyle, seat: GenesisSeatContent | undefined) {
  const pieces: GrandPiece[] = [];
  const add = (role: GrandPieceRole, id: string, item: Dressing) => pieces.push({ id, role, blueprint: item.blueprint, position: item.position, yaw: item.yaw });
  const { houses, props } = placeHomes(plan.homes, (x, z) => terrainHeight(plan, x, z));
  if (houses.length !== plan.homes.length) throw new Error('Every plot needs its one native home.');
  const homes = houses.map(windowHouse);
  homes.forEach((house, i) => pieces.push({ id: `home:${plan.homes[i]!.id}`, role: 'home', slot: house.slot, blueprint: house.blueprint, position: house.position, yaw: house.yaw }));
  props.forEach((prop, i) => add('prop', `garden:${i}`, prop));
  // Potential land draws its market around the meeting node itself, ten metres back toward the castle.
  const centre = plan.nodes.find(node => node.id === plan.market.nodeId)!.position;
  placeMarketContent(plan.market).forEach((prop, i) => add('civic', `market:${i}`, { ...prop, position: [prop.position[0] + centre[0], prop.position[1], prop.position[2] + centre[2] - 10] }));
  createGenesisWaterContent(plan, { crossing: seat?.crossing ?? false }).forEach((piece, i) => add('civic', `water:${i}`, piece));
  const castle = seat ?? createCastleContent(plan.castle, style);
  for (const building of castle.buildings) add('castle', `castle:${building.id}`, building);
  const court = seat ?? createCastleCourtContent(plan.castle, style);
  court.props.forEach((prop, i) => add(seat ? 'seat' : 'civic', `${seat ? 'seat' : 'court'}:${i}`, prop));
  for (const batch of groveBatches(plantGrove(potentialTreeSites(plan, style))))
    for (const tree of batch.placements) pieces.push({ id: tree.id, role: 'tree', blueprint: batch.blueprint, position: tree.position, yaw: tree.yaw });
  return { plan, style, pieces, houses: homes, forgeHosts: homes, braziers: court.braziers, forgeFires: [],
    beaconPosition: castle.beaconPosition, founded: null };
}

/**
 * The planting sites `createKingdomScene` grows for a potential plan: eight around every inhabited court, then the
 * seeded woods around the town, kept off lots, public ground, the castle, the water and each other. Roots are
 * sampled on the same horizon surface the scene draws, so trees stand where they stand today.
 */
function potentialTreeSites(plan: SettlementPlan, style: GrandStyle): TreeSite[] {
  const seed = plan.config.seed, treeCount = plan.config.tier === 'hamlet' ? 115 : 260;
  const horizon = createHorizonSurface(plan, { farStep: 20, distantRelief: false, sampleTerrain: (x, z) => terrainHeight(plan, x, z) });
  horizon.geometry.dispose();
  const landHeight = horizon.sampleHeight;
  const sites: TreeSite[] = [], planted: [number, number][] = [];
  const rootHeight = (x: number, z: number) => {
    let height = Infinity;
    for (const dx of [-1.25, 0, 1.25]) for (const dz of [-1.25, 0, 1.25]) height = Math.min(height, landHeight(x + dx, z + dz));
    return height;
  };
  const cells = new Map<string, SettlementPlan['reservations'][number][]>(), indexStep = 16, crown = 4.25;
  for (const reservation of plan.reservations) {
    const lot = reservation.lot;
    for (let z = Math.floor((lot.minZ - crown) / indexStep); z <= Math.floor((lot.maxZ + crown) / indexStep); z++)
      for (let x = Math.floor((lot.minX - crown) / indexStep); x <= Math.floor((lot.maxX + crown) / indexStep); x++) {
        const key = `${x},${z}`, entries = cells.get(key) ?? []; entries.push(reservation); cells.set(key, entries);
      }
  }
  const castle = plan.castle.bounds, lake = plan.lake;
  const plant = (id: string, kind: 'court' | 'grove', x: number, z: number) => {
    if (plan.genesisSurface) {
      const shore = sampleGenesisSurface(plan.genesisSurface, x, z);
      if (shore.waterLevel !== null || shore.shoreDistance < crown) return;
    }
    const nearby = cells.get(`${Math.floor(x / indexStep)},${Math.floor(z / indexStep)}`) ?? [];
    if (nearby.some(({ lot }) => x > lot.minX - crown && x < lot.maxX + crown && z > lot.minZ - crown && z < lot.maxZ + crown)) return;
    if ((samplePublicGround(plan, x, z)?.reservedDistance ?? Infinity) < crown) return;
    if (x > castle.minX - crown && x < castle.maxX + crown && z > castle.minZ - crown && z < castle.maxZ + crown) return;
    if (Math.hypot((x - lake.x) / lake.radiusX, (z - lake.z) / lake.radiusZ) < 1.19) return;
    if (planted.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 8)) return;
    planted.push([x, z]);
    const water = Math.hypot((x - lake.x) / lake.radiusX, (z - lake.z) / lake.radiusZ);
    const lot = Math.min(Infinity, ...plan.reservations.map(({ lot: l }) => Math.hypot(Math.max(l.minX - x, 0, x - l.maxX), Math.max(l.minZ - z, 0, z - l.maxZ))));
    const keep = Math.hypot(Math.max(castle.minX - x, 0, x - castle.maxX), Math.max(castle.minZ - z, 0, z - castle.maxZ));
    sites.push({ id, zone: water < 1.55 ? 'water' : kind, position: [x, rootHeight(x, z), z],
      yaw: randomUnit(seedHash(`${seed}:tree-yaw:${id}`)) * Math.PI * 2, style, seed,
      room: Math.min(lot, samplePublicGround(plan, x, z)?.reservedDistance ?? Infinity, keep) + 1 });
  };
  const inhabited = new Set(plan.homes.map(home => home.courtId));
  for (const court of plan.courts) {
    if (!inhabited.has(court.id)) continue;
    const anchor = plan.nodes.find(node => node.id === court.nodeId)!;
    const radius = Math.max(...court.boundary.map(([x, z]) => Math.hypot(x - anchor.position[0], z - anchor.position[2]))) + 7;
    for (let side = 0; side < 8; side++) {
      const angle = side * Math.PI / 4;
      plant(`court:${court.id}:${side}`, 'court', anchor.position[0] + Math.cos(angle) * radius, anchor.position[2] + Math.sin(angle) * radius);
    }
  }
  for (let i = 0; i < treeCount * 12 && planted.length < treeCount; i++) {
    const group = Math.floor(i / 7), rand = (part: string) => randomUnit(seedHash(`${seed}:grove:${part}`));
    const cx = plan.bounds.minX - 35 + rand(`${group}:x`) * (plan.bounds.maxX - plan.bounds.minX + 70);
    const cz = plan.bounds.minZ - 65 + rand(`${group}:z`) * (plan.bounds.maxZ - plan.bounds.minZ + 45);
    const angle = rand(`${i}:angle`) * Math.PI * 2, radius = Math.sqrt(rand(`${i}:radius`)) * 10;
    plant(`grove:${i}`, 'grove', cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius);
  }
  return sites;
}

/**
 * `placeSettlementContent` with each home family and garden form built once. A native home's bytes depend only on
 * its style, tier and variant (the realm's native town shares them the same way), and the slowest families take tens
 * of milliseconds each, which a 512-home city would otherwise pay per plot. Same order, placements and bytes; the
 * test holds the two equal.
 */
export function placeHomes(plots: readonly SettlementHome[], ground: (x: number, z: number) => number): { houses: WindowHouse[]; props: Dressing[] } {
  const houses: WindowHouse[] = [], props: Dressing[] = [], memo = new Map<string, VoxelBlueprint>();
  const once = (key: string, make: () => VoxelBlueprint) => { let b = memo.get(key); if (!b) memo.set(key, b = make()); return b; };
  for (const plot of plots) {
    const blueprint = once(`home:${plot.style}:${plot.tier}:${plot.variant}`, () => createNativeForgeHost(plot).blueprint);
    const depth = blueprint.size[2] * VOXEL_METRES.build, position = homeOrigin(plot, depth), yaw = plot.rotation * Math.PI / 2;
    houses.push({ slot: plot.slot, blueprint, position, yaw });
    if (plot.style === 'grove') continue;
    const add = (form: StreetPropForm, x: number, z: number) => {
      const b = once(`street:${form}:${plot.style}`, () => createStreetProp(form, plot.style as 'hearth' | 'tide'));
      const origin = transformCardinalPoint(position, plot.rotation, [x, 0, depth + z]);
      const centre = transformCardinalPoint(origin, plot.rotation, [b.size[0] / 16, 0, b.size[2] / 16]);
      props.push({ blueprint: b, position: [origin[0], ground(centre[0], centre[2]), origin[2]], yaw });
    };
    add('flower-pot', 0, .125);
    add(plot.ordinal % 5 === 0 ? 'leafy-shrub' : plot.ordinal % 3 ? 'flower-trough' : 'rock-cluster', 6, .125);
    if (plot.ordinal % 4 === 0) {
      const kind = plot.ordinal % 8 === 0 ? 'wall' : 'fence';
      add(`${kind}-straight`, 5.625, 1.75);
      add(`${kind}-end`, 7.5, 1.75);
    }
  }
  return { houses, props };
}

/** Only the fields window lights read; builders attach extra fields (family, IDs) that do not belong in a house. */
function windowHouse(house: WindowHouse): WindowHouse {
  return { slot: house.slot, blueprint: house.blueprint, position: house.position, yaw: house.yaw };
}
