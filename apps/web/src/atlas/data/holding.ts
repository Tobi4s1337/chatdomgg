import { languageName } from '../../../../surveyor/src/cartography/language-labels';
import { landLabel } from '../../../../surveyor/src/cartography/realm-labels';
import { fetchCard, type CardReply } from './directory';
import { loadPreview, type StorageLike } from './load';
import { realmWord, SettlerStore, type Settler } from './model';
import { fetchChunk, fetchNames, type PreviewSource, type PreviewWorld, type RealmKind } from './preview';

/**
 * One holding as the door into its land reads it: everything the survey says about the channel, and the survey it
 * comes from. It is the Atlas's own public projection, so it carries no profile text, image or emote.
 */
export interface DoorHolding {
  readonly version: 1;
  readonly id: string;
  readonly login: string;
  readonly name: string;
  /** Expiry of this served name projection. On expiry the door reloads the current projection. */
  readonly freshUntil: number;
  readonly tier: Settler['tier'] | null;
  /** Average viewers over the survey's observed window, never the live count. */
  readonly average: number;
  /** The game the channel streamed most in the window, with its Twitch category ID when the survey names one. */
  readonly game: { readonly id: string | null; readonly name: string } | null;
  readonly realm: { readonly kind: RealmKind; readonly family: string | null; readonly name: string };
  readonly region: { readonly language: string | null; readonly name: string };
  readonly x: number | null;
  readonly y: number | null;
  readonly survey: { readonly preview: string; readonly revision: string; readonly asOf: number; readonly windowHours: number };
}

export class HoldingError extends Error {
  constructor(readonly reason: 'unavailable' | 'missing' | 'withheld', message: string) {
    super(message);
    this.name = 'HoldingError';
  }
}

/** The holding from a settler the Atlas already holds, with the world it was drawn from. */
export function doorHolding(settler: Settler, world: PreviewWorld): DoorHolding | null {
  if (settler.withheld || !settler.name || !settler.login) return null;
  const realm = world.realms[settler.realm];
  const region = world.regions[settler.region];
  const game = settler.game === null ? null : world.games.find(item => item.name === settler.game) ?? null;
  return {
    version: 1, id: settler.id, login: settler.login, name: settler.name, freshUntil: settler.freshUntil, tier: settler.tier, average: settler.average,
    game: settler.game === null ? null : { id: game?.gameId ?? null, name: settler.game },
    realm: { kind: realm?.kind ?? 'crossroads', family: realm && realm.family >= 0 ? world.families[realm.family]?.id ?? null : null, name: settler.realmName },
    region: { language: region?.language ?? null, name: region?.language ? languageName(region.language).label : region ? landLabel('outer') : '' },
    x: settler.x, y: settler.y,
    survey: { preview: world.id, revision: world.revision, asOf: world.asOf, windowHours: world.window.hours },
  };
}

/** A waiting channel is observed but has no holding or coordinates in this preview. The card supplies no
 * dominant game, so its last live category is deliberately not used as survey evidence. */
export function waitingDoorHolding(card: CardReply, world: PreviewWorld): DoorHolding | null {
  const face = card.channel;
  if (card.average === null || card.preview !== world.id || card.revision !== world.revision || face.place !== 'waiting'
    || !face.name || !face.login || face.freshUntil === null || face.freshUntil <= Date.now()
    || face.region === null || face.realm === null) return null;
  const realm = world.realms[face.realm];
  const region = world.regions[face.region];
  if (!realm || !region) return null;
  return {
    version: 1, id: face.id, login: face.login, name: face.name, freshUntil: face.freshUntil,
    tier: null, average: card.average, game: null,
    realm: { kind: realm.kind, family: realm.family >= 0 ? world.families[realm.family]?.id ?? null : null, name: realmWord(world, face.realm) },
    region: { language: region.language, name: region.language ? languageName(region.language).label : landLabel('outer') }, x: null, y: null,
    survey: { preview: world.id, revision: world.revision, asOf: world.asOf, windowHours: world.window.hours },
  };
}

/** Read the holding for a channel: the cities in the world file, then each land's towns and villages, largest first. */
async function findSettler(store: SettlerStore, world: PreviewWorld, source: PreviewSource, id: string, signal?: AbortSignal): Promise<Settler | null> {
  const known = store.byId.get(id);
  if (known) return known;
  const order = [...world.regions].sort((a, b) => b.members - a.members || a.index - b.index);
  for (const region of order) {
    if (store.hasRegion(region.index)) continue;
    store.addChunk(await fetchChunk(source, world, region.index, signal));
    const found = store.byId.get(id);
    if (found) return found;
  }
  return null;
}

/**
 * Find a channel's holding on the survey this tab draws (the pinned preview), honouring the names projection: a
 * withheld or unnamed holding has no door.
 */
export async function readDoorHolding(source: PreviewSource, storage: StorageLike | null, id: string, signal?: AbortSignal): Promise<DoorHolding> {
  let world: PreviewWorld;
  let store: SettlerStore;
  try {
    ({ world } = await loadPreview(source, storage, signal));
    store = new SettlerStore(world);
    store.applyNames(await fetchNames(source, world, signal));
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new HoldingError('unavailable', 'The Atlas could not be read just now.');
  }
  const settler = await findSettler(store, world, source, id, signal).catch((error: unknown) => {
    if ((error as Error).name === 'AbortError') throw error;
    throw new HoldingError('unavailable', 'The Atlas could not be read just now.');
  });
  if (!settler) {
    try {
      const card = await fetchCard(source, world.id, { id }, signal);
      const waiting = waitingDoorHolding(card, world);
      if (waiting) return waiting;
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      throw new HoldingError('unavailable', 'The Atlas could not be read just now.');
    }
    throw new HoldingError('missing', world.status === 'edition' ? `This channel has no public entry in ${world.label} of the Atlas.` : 'This channel has no public entry on the current survey of the Atlas.');
  }
  const holding = doorHolding(settler, world);
  if (!holding) throw new HoldingError('withheld', 'This holding is not shown on the Atlas.');
  return holding;
}

/** The Atlas hands the holding it just opened to the kingdom page, so the door does not walk the survey again. */
export const DOOR_KEY = 'chatdom.door.v1';

/** Hands the holding to the kingdom page in this tab, so the door opens without walking the survey again. */
export function handOffHolding(storage: StorageLike | null, holding: DoorHolding): void {
  try { storage?.setItem(DOOR_KEY, JSON.stringify(holding)); } catch { /* private mode: the page reads the survey */ }
}

/** The holding handed over for this channel while its served projection is fresh; otherwise reread the Atlas. */
export function takeHandOff(storage: StorageLike | null, id: string, now = Date.now()): DoorHolding | null {
  try {
    const raw = storage?.getItem(DOOR_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<DoorHolding>;
    if (value.version !== 1 || value.id !== id || typeof value.name !== 'string' || typeof value.average !== 'number'
      || (value.tier !== null && typeof value.tier !== 'string') || !value.realm || !value.survey || typeof value.freshUntil !== 'number' || value.freshUntil <= now) return null;
    return value as DoorHolding;
  } catch {
    return null;
  }
}

const TIER_LABEL: Record<Settler['tier'], string> = { capital: 'A capital', city: 'A city', town: 'A town', village: 'A village', hamlet: 'A hamlet' };

/** Where the holding stands, in a line: "A town in the realm of Shooters", "A village on the isle of Polski". */
export function holdingPlace(holding: Pick<DoorHolding, 'tier' | 'realm' | 'region'>): string {
  const tier = holding.tier === null ? 'A channel' : TIER_LABEL[holding.tier] ?? 'A holding';
  if (holding.realm.kind === 'family') return `${tier} in the realm of ${holding.realm.name}`;
  if (holding.realm.kind === 'isle') return `${tier} on the isle of ${holding.region.name || holding.realm.name}`;
  if (holding.realm.kind === 'outer') return `${tier} in the Outer Isles`;
  return `${tier} in ${holding.realm.name}`;
}
