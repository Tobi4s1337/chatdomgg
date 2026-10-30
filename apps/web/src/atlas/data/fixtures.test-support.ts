/**
 * Test support only (not a test file, not shipped): a small synthetic survey preview with the same shape as the
 * files the Atlas service publishes, and a fake fetch that serves it.
 */
import { createHash } from 'node:crypto';
import { PREVIEW_LABEL, type PreviewChunk, type PreviewPointer, type PreviewSource, type PreviewWorld, type ServedNames, type SettlerColumns } from './preview';

export const BASE = 'https://atlas.test/map-data';
export const ID_A = 'pv-20261030T015627Z-97344f8ef397';
export const ID_B = 'pv-20261030T055627Z-0123456789ab';
export const REV_A = 'obs-20261030T015627Z-3e11b42580e4';
export const REV_B = 'obs-20261030T055627Z-ba9876543210';

export const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const clone = <T>(value: T): T => structuredClone(value);
export const decorCode = (kind: number, bands: number, variant: number): number => (kind << 12) | (bands << 7) | variant;

export interface Row { id: string; login: string; name: string; tier: number; x: number; y: number; average: number; game: number; region: number }

/** Geometry columns of the rows; their logins and names travel separately, in the names projection. */
export function columns(rows: Row[]): SettlerColumns {
  return {
    ids: rows.map((r) => r.id),
    tier: rows.map((r) => r.tier),
    x: rows.map((r) => r.x),
    y: rows.map((r) => r.y),
    average: rows.map((r) => r.average),
    game: rows.map((r) => r.game),
    region: rows.map((r) => r.region),
  };
}

/** A two-region world at coordScale 20: world units span x −100…120, y −60…50. */
export function makeWorld(id = ID_A, revision = REV_A, asOf = 1_793_325_387_307): PreviewWorld {
  const placeholder = { sha256: '0'.repeat(64), bytes: 0, records: 0 };
  return {
    version: 1,
    kind: 'chatdom-atlas-survey-preview',
    id,
    algorithm: 'survey-preview-1',
    label: PREVIEW_LABEL,
    status: 'preview',
    revision,
    asOf,
    window: { firstObservationAt: asOf - 36_687_817, lastObservationAt: asOf, hours: 10.19, sweeps: 205, gapCount: 0 },
    coverage: { sweepFloorViewers: 5, candidateMinAverage: 25, contentLabels: 'not-collected', missing: ['Content classification labels are not collected by the source; every channel is unknown.'] },
    founding: { status: 'not-founded', edition0EligibleAt: asOf + 136_112_183, editionIEligibleAt: asOf + 568_112_183 },
    counts: { channelsObserved: 176_266, mapped: 7, languages: 2, capital: 1, city: 2, town: 2, village: 2 },
    coordScale: 20,
    bounds: { minX: -2000, minY: -1200, maxX: 2400, maxY: 1000 },
    tiers: { minAverage: { capital: 5000, city: 500, town: 50, village: 25 }, holdingRadius: { capital: 6, city: 3.4, town: 1.8, village: 1.25 } },
    regions: [
      { index: 0, language: 'en', name: 'English', englishName: 'English', kind: 'continent', x: 0, y: 0, r: 800, members: 5, chunk: { path: 'region-0.json', ...placeholder } },
      { index: 1, language: 'de', name: 'Deutsch', englishName: 'German', kind: 'isle', x: 1600, y: 400, r: 300, members: 2, chunk: { path: 'region-1.json', ...placeholder } },
    ],
    isles: { name: 'The Isles of Many Tongues', x: 1600, y: 400, r: 500 },
    games: [{ gameId: '509658', name: 'Just Chatting' }, { gameId: '21779', name: 'League of Legends' }, { gameId: '33214', name: null }],
    clusters: [
      { region: 0, game: 0, x: 0, y: 0, r: 400, members: 3 },
      { region: 0, game: -1, x: -600, y: 200, r: 200, members: 2 },
      { region: 1, game: 2, x: 1600, y: 400, r: 120, members: 2 },
    ],
    coasts: [
      // A square from (−50,−30) to (50,30) in world units, delta-encoded.
      { region: 0, points: [-1000, -600, 2000, 0, 0, 1200, -2000, 0] },
      // A triangle around the isle.
      { region: 1, points: [1400, 200, 400, 0, -200, 400] },
    ],
    decor: [decorCode(0, 2, 5), 100, -200, decorCode(5, 0, 127), -1900, 900, decorCode(2, 31, 0), 1650, 410],
    policy: { gambling: 'gambling-categories-1', excludedGambling: 2 },
    head: columns(HEAD_ROWS),
  };
}

export const HEAD_ROWS: Row[] = [
  { id: '552120296', login: 'zackrawrr', name: 'zackrawrr', tier: 0, x: 120, y: -120, average: 33_015, game: 0, region: 0 },
  { id: '207813352', login: 'hasanabi', name: 'HasanAbi', tier: 1, x: -12, y: 294, average: 2_697, game: 0, region: 0 },
  { id: '36926489', login: 'gronkh', name: 'GRONKH', tier: 1, x: 1610, y: 420, average: 900, game: -1, region: 1 },
];

export const CHUNK_ROWS: Row[][] = [
  [
    { id: '506611431', login: 'mira004', name: 'mira004', tier: 2, x: 304, y: 445, average: 497, game: 0, region: 0 },
    { id: '65365812', login: 'pumpkinpotion', name: 'pumpkinpotion', tier: 3, x: -702, y: -361, average: 31, game: 1, region: 0 },
  ],
  [
    { id: '108586685', login: 'tenzinniznet', name: 'TenzinNiznet', tier: 2, x: 1590, y: 380, average: 120, game: 2, region: 1 },
    { id: '558501883', login: 'koalapuffslive', name: 'koalapuffslive', tier: 3, x: 1700, y: 500, average: 26, game: -1, region: 1 },
  ],
];

export function makeChunk(world: PreviewWorld, region: number): PreviewChunk {
  return { version: 1, kind: 'chatdom-atlas-survey-preview-region', preview: world.id, region, settlers: columns(CHUNK_ROWS[region === 0 ? 0 : 1]!) };
}

/**
 * The names projection for every fixture holding, fresh for a day after the survey cut unless `freshUntil` says
 * otherwise; `withheld` holdings are listed without names, as the service lists them.
 */
export function makeNames(world: PreviewWorld, opts: { withheld?: string[]; freshUntil?: Record<string, number>; omit?: string[] } = {}): ServedNames {
  const rows = [...HEAD_ROWS, ...CHUNK_ROWS.flat()]
    .filter((row) => !opts.withheld?.includes(row.id) && !opts.omit?.includes(row.id));
  return {
    version: 1,
    kind: 'chatdom-atlas-survey-preview-served-names',
    preview: world.id,
    servedAt: world.asOf + 60_000,
    withheld: opts.withheld ?? [],
    ids: rows.map((r) => r.id),
    logins: rows.map((r) => r.login),
    names: rows.map((r) => r.name),
    freshUntil: rows.map((r) => opts.freshUntil?.[r.id] ?? world.asOf + 86_400_000),
  };
}

export interface Published {
  world: PreviewWorld;
  worldText: string;
  pointer: PreviewPointer;
  chunkTexts: string[];
}

/** Serialise a world and its chunks with every hash and length pinned the way the service pins them. */
export function publish(world: PreviewWorld = makeWorld()): Published {
  const chunkTexts = world.regions.map((region) => {
    const text = JSON.stringify(makeChunk(world, region.index));
    region.chunk.sha256 = sha(text);
    region.chunk.bytes = Buffer.byteLength(text);
    region.chunk.records = makeChunk(world, region.index).settlers.ids.length;
    return text;
  });
  const worldText = JSON.stringify(world);
  const pointer: PreviewPointer = {
    version: 1,
    id: world.id,
    revision: world.revision,
    asOf: world.asOf,
    world: { url: `/map-data/v1/preview/${world.id}/world.json`, sha256: sha(worldText), bytes: Buffer.byteLength(worldText) },
  };
  return { world, worldText, pointer, chunkTexts };
}

type Route = () => Response | Promise<Response>;

/** A fake Atlas service: routes by exact URL, records every request, answers 404 to anything unknown. */
export class FakeService {
  readonly routes = new Map<string, Route>();
  readonly calls: { url: string; init: RequestInit | undefined }[] = [];

  readonly source: PreviewSource = {
    base: BASE,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      this.calls.push({ url, init });
      const route = this.routes.get(url);
      return route ? route() : new Response('{"error":"not-found"}', { status: 404 });
    }) as typeof fetch,
  };

  serve(url: string, body: string | Uint8Array, status = 200): this {
    this.routes.set(url, () => new Response(typeof body === 'string' ? body : new Uint8Array(body), { status }));
    return this;
  }

  pointerUrl(): string {
    return `${BASE}/v1/preview`;
  }

  worldUrl(id: string): string {
    return `${BASE}/v1/preview/${id}/world.json`;
  }

  namesUrl(id: string): string {
    return `${BASE}/v1/preview/${id}/names`;
  }

  /** Serve a published preview: its pointer as current, its world and its chunks. */
  publish(published: Published, current = true): this {
    if (current) this.serve(this.pointerUrl(), JSON.stringify(published.pointer));
    this.serve(this.worldUrl(published.world.id), published.worldText);
    published.world.regions.forEach((region, i) => this.serve(`${BASE}/v1/preview/${published.world.id}/${region.chunk.path}`, published.chunkTexts[i]!));
    this.serve(this.namesUrl(published.world.id), JSON.stringify(makeNames(published.world)));
    return this;
  }

  urls(): string[] {
    return this.calls.map((call) => call.url);
  }
}

/** sessionStorage stand-in that records removals and can be made to refuse writes. */
export class MemoryStorage {
  readonly map = new Map<string, string>();
  readonly removed: string[] = [];
  refuseWrites = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.refuseWrites) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.removed.push(key);
    this.map.delete(key);
  }
}
