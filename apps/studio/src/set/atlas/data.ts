// The survey behind the Atlas plates: one exported survey preview, copied into the teaser's media folder and read
// with our own fetch (every file checked against the hash it was pinned with, then validated by the product's own
// readers). Names are served for the four channels that agreed to be shown and for nobody else, so no other
// streamer's name can reach the paper.
import { decodeRings, geographyOf, SettlerStore, type Geography } from '../../../../web/src/atlas/data/model';
import { sha256Hex, validateChunk, validateWorld, type PreviewChunk, type PreviewWorld, type ServedNames } from '../../../../web/src/atlas/data/preview';
import { LandIndex, nearestFreeSlot, Occupancy } from '../../../../web/src/atlas/live/pencil';

/** The preview the plates are drawn from (survey-preview-4, the algorithm this repo's surveyor writes). */
export const PREVIEW_ID = 'pv-20261101T185031Z-7265e33c55d1';
const BASE = `/media/teaser/atlas-data/${PREVIEW_ID}`;

/** The channels that agreed to appear by name. Nothing else is ever named. */
export const CONSENTING = {
  tobi4s_: { id: '129634568', login: 'tobi4s_', name: 'tobi4s_' },
  The_AGGman: { id: '63920635', login: 'the_aggman', name: 'The_AGGman' },
  PinkKittyRose: { id: '4363967', login: 'pinkkittyrose', name: 'PinkKittyRose' },
  MashaD4: { id: '154972160', login: 'mashad4', name: 'MashaD4' },
} as const;
export type Consenting = keyof typeof CONSENTING;

/**
 * Founded kingdoms the survey has no holding for (both are under 25 viewers, so the survey never mapped them).
 * Atlas.md §8.2.3: a founded kingdom settles at once, whatever its size; one under 25 viewers takes the free hamlet
 * slot nearest the weighted centre of its raid ties in its realm, or nearest the realm's heart. Neither has raid ties
 * on this survey, so each takes the slot nearest its realm's heart, found with the product's own lattice search.
 * The product draws no hamlet stamp yet, so each is drawn as the smallest tier it has (a village).
 *
 * tobi4s_ has no observed category (Genesis keeps it unknown); it settles in Just Chatting & IRL, the realm of the
 * kingdom it raids in the teaser. The_AGGman's main category on the survey is Counter-Strike, so Shooters.
 */
const SETTLE: Record<'tobi4s_' | 'The_AGGman', { realm: string; game: string; average: number }> = {
  tobi4s_: { realm: 'Just Chatting & IRL', game: 'Just Chatting', average: 0 },
  The_AGGman: { realm: 'Shooters', game: 'Counter-Strike', average: 16 },
};

export interface Holding { id: string; name: string; x: number; y: number; tier: number; settled: boolean }

export interface AtlasData {
  world: PreviewWorld;
  geo: Geography;
  store: SettlerStore;
  holdings: Record<Consenting, Holding>;
  /** Area names (regions, realms, communities) hidden because they spell a channel's name exactly. */
  hiddenLabels: string[];
}

interface Manifest { id: string; world: { path: string; sha256: string; bytes: number }; names: { path: string; sha256: string; bytes: number } }
interface RawNames { preview: string; ids: string[]; logins: string[]; names: string[] }

async function pinned(path: string, sha256: string, bytes: number): Promise<unknown> {
  const response = await fetch(`${BASE}/${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  const body = await response.arrayBuffer();
  if (body.byteLength !== bytes || (await sha256Hex(body)) !== sha256) throw new Error(`${path} does not match its pinned hash`);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
}

export async function loadAtlas(): Promise<AtlasData> {
  const manifest = await (await fetch(`${BASE}/manifest.json`, { cache: 'no-store' })).json() as Manifest;
  if (manifest.id !== PREVIEW_ID) throw new Error('the manifest belongs to another preview');
  const world = validateWorld(await pinned(manifest.world.path, manifest.world.sha256, manifest.world.bytes));
  const chunks: PreviewChunk[] = [];
  for (const region of world.regions) chunks.push(validateChunk(await pinned(region.chunk.path, region.chunk.sha256, region.chunk.bytes), world, region.index));
  const raw = await pinned(manifest.names.path, manifest.names.sha256, manifest.names.bytes) as RawNames;
  if (raw.preview !== world.id) throw new Error('the names belong to another preview');

  const s = world.coordScale;
  const geo = geographyOf(world);

  // Every holding on the survey, for the hamlet slot search's gap test.
  const radius = world.tiers.holdingRadius;
  const radii = [radius.capital, radius.city, radius.town, radius.village];
  const occupancy = new Occupancy();
  for (const columns of [world.head, ...chunks.map(c => c.settlers)]) {
    for (let i = 0; i < columns.ids.length; i++) occupancy.add(columns.x[i]! / s, columns.y[i]! / s, radii[columns.tier[i]!]!);
  }
  const land = new LandIndex(decodeRings(world), geo.realms);
  const taken = new Set<string>();
  const settled = new Set<Consenting>();
  const english = chunks[0]!;
  for (const key of ['tobi4s_', 'The_AGGman'] as const) {
    const id = CONSENTING[key].id;
    if ([world.head, ...chunks.map(c => c.settlers)].some(c => c.ids.includes(id))) continue;
    const plan = SETTLE[key];
    const realm = geo.realms.find(r => r.region === 0 && r.name === plan.realm);
    const game = world.games.findIndex(g => g.name === plan.game);
    if (!realm || game < 0) throw new Error(`no realm for ${key}`);
    const slot = nearestFreeSlot(land, occupancy, taken, realm, { x: realm.x, y: realm.y });
    if (!slot) throw new Error(`no free slot for ${key}`);
    taken.add(`${slot.i}:${slot.j}`);
    occupancy.add(slot.x, slot.y, radius.village);
    const c = english.settlers;
    c.ids.push(id); c.tier.push(3); c.x.push(Math.round(slot.x * s)); c.y.push(Math.round(slot.y * s));
    c.average.push(plan.average); c.game.push(game); c.region.push(0); c.realm.push(realm.index);
    settled.add(key);
  }

  // Names served for the consenting four only. A holding with no entry keeps its shield and no name; nobody is
  // marked withheld, so every other holding stays on the paper exactly as the survey drew it.
  const served: ServedNames = {
    version: 1, kind: 'chatdom-atlas-survey-preview-served-names', preview: world.id, servedAt: world.asOf, withheld: [],
    ids: [], logins: [], names: [], freshUntil: [],
  };
  for (const channel of Object.values(CONSENTING)) {
    const i = raw.ids.indexOf(channel.id);
    served.ids.push(channel.id);
    served.logins.push(i >= 0 ? raw.logins[i]! : channel.login);
    served.names.push(i >= 0 ? raw.names[i]! : channel.name);
    served.freshUntil.push(world.asOf + 365 * 86_400_000);
  }
  // The store's clock is pinned to the survey's moment, so a name never goes stale during a take.
  const store = new SettlerStore(world, () => world.asOf);
  for (const chunk of chunks) store.addChunk(chunk);
  store.applyNames(served);

  // Area names are drawn from the world file. One that spells any channel's login or display name exactly (a game
  // that shares its name with its publisher's channel, say) is left off this paper.
  const channelNames = new Set<string>();
  for (let i = 0; i < raw.ids.length; i++) {
    if (Object.values(CONSENTING).some(c => c.id === raw.ids[i])) continue;
    channelNames.add(raw.logins[i]!.toLowerCase());
    channelNames.add(raw.names[i]!.toLowerCase());
  }
  const hiddenLabels: string[] = [];
  const spells = (name: string | null) => !!name && channelNames.has(name.toLowerCase());
  for (const cluster of geo.clusters) if (spells(cluster.name)) { hiddenLabels.push(cluster.name!); cluster.name = null; }
  for (const realm of geo.realms) if (spells(realm.name)) { hiddenLabels.push(realm.name); realm.name = ''; }
  for (const region of geo.regions) {
    if (spells(region.name)) { hiddenLabels.push(region.name); region.name = ''; }
    if (spells(region.englishName)) { hiddenLabels.push(region.englishName); region.englishName = region.name; }
  }
  if (geo.isles && spells(geo.isles.name)) { hiddenLabels.push(geo.isles.name); geo.isles.name = ''; }
  if (spells(geo.outer.name)) { hiddenLabels.push(geo.outer.name); geo.outer.name = ''; }

  const holdings = {} as Record<Consenting, Holding>;
  for (const [key, channel] of Object.entries(CONSENTING) as [Consenting, typeof CONSENTING[Consenting]][]) {
    const settler = store.byId.get(channel.id);
    if (!settler || settler.name === null) throw new Error(`${key} is not on the paper`);
    holdings[key] = { id: settler.id, name: settler.name, x: settler.x, y: settler.y, tier: settler.tierRank, settled: settled.has(key) };
  }
  return { world, geo, store, holdings, hiddenLabels: [...new Set(hiddenLabels)] };
}
