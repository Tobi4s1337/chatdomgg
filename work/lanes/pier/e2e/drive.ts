// The PI10 end-to-end walkers: real HTTP sign-in against the API's simulated provider, real tickets, the browser's
// own realm client, fishing controller and room links, steered over the exact collision world the room steps.
// Loaded by pi10-e2e.mjs through vite's module runner; never imported by the app.
import { createHash } from 'node:crypto';
import { connectRealm, type RealmClient, type RealmCollision } from '../../../../apps/web/src/realm/client.ts';
import { createFishingController, type FishingController, type FishingEvent } from '../../../../apps/web/src/fishing/controller.ts';
import { fishingLink, itemLink, requestId, type FishingLink, type ItemLink } from '../../../../apps/web/src/fishing/link.ts';
import { onFishingLip } from '../../../../apps/realm/src/fishing/cast-site.ts';
import { pierLocalToWorld, pierWaterAt } from '../../../../apps/realm/src/fishing/site.ts';
import { AllocationService, TenureEvidenceVerifier } from '../../../../apps/realm/src/allocation/index.ts';
import { createRealmPool } from '../../../../apps/realm/src/persistence/database.ts';
import { assertRealmSchema } from '../../../../apps/realm/src/persistence/schema.ts';
import { canonicalJson } from '../../../../apps/realm/src/persistence/codec.ts';
import { compileFoundedScene, foundedGroundAt } from '../../../../packages/world/src/founded-world/collision.ts';
import { FISH_ITEM_DEFINITIONS } from '../../../../packages/content/src/fish/index.ts';
import { WILLOW_ROD_DEFINITION } from '../../../../packages/content/src/pier/rod.ts';
import { REALM_AUTH_ROUTES, REALM_FOUNDED_ROUTES, RealmFoundedManifestSchema, RealmSessionReplySchema, RealmTicketReplySchema,
  type CollisionWorld, type RealmJoin } from '../../../../packages/shared/src/realm/index.ts';
import type { FishingChannelReply, FishingPierSite, ItemEvent, ItemRecord, ItemReply, Vec3 } from '../../../../packages/shared/src/index.ts';
import type { RealmFoundedScene, SettlementPlan } from '../../../../packages/world/src/index.ts';
import { createSteering, lastSearch, planRoute, simulateRoute } from './route.ts';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
/** Walker ids are room-visible entry ids; the evidence keeps a short tag only. */
export const tag = (id: string) => id.slice(0, 8);
let log: (line: string) => void = line => console.log(line);
export function useLog(next: (line: string) => void) { log = next; }

// Seeding --------------------------------------------------------------------------------------------------------

/**
 * Adopts the copied scene's exact SettlementPlan for the kingdom through the realm's own AllocationService, as a
 * simulated-origin layout in this schema. Idempotent: the same plan answers `unchanged`. Nothing else is written.
 */
export async function seedKingdom(options: { databaseUrl: string; schema: string; kingdomId: string; plan: SettlementPlan }) {
  if (options.schema !== 'pier') throw new Error('The PI10 run only ever writes the pier schema.');
  const pool = createRealmPool({ connectionString: options.databaseUrl, schema: options.schema });
  try {
    await assertRealmSchema(pool);
    const allocation = new AllocationService(pool, { origin: 'simulated', verifier: new TenureEvidenceVerifier('simulated', new Uint8Array(32).fill(7)),
      furnish: async () => { throw new Error('The PI10 run allocates no homes.'); } });
    const adopted = await allocation.adoptLayout(options.kingdomId as never, options.plan);
    if (adopted.status === 'rejected') throw new Error(`The copied plan was not adopted: ${adopted.reason} (${adopted.detail})`);
    return { status: adopted.status, revision: adopted.revision, planDigest: sha256(canonicalJson(options.plan)) };
  } finally { await pool.end(); }
}

// Browser --------------------------------------------------------------------------------------------------------

/** One browser profile: a cookie jar and same-origin fetch that never follows redirects by itself. */
export class Browser {
  private readonly cookies = new Map<string, string>();
  constructor(readonly origin: string) {}
  async request(path: string, init: { method?: string; body?: unknown; csrf?: string; form?: URLSearchParams } = {}) {
    const headers: Record<string, string> = {};
    const jar = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    if (jar) headers.cookie = jar;
    if (init.csrf) headers['x-csrf-token'] = init.csrf;
    if ((init.method ?? 'GET') !== 'GET') headers.origin = this.origin;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.form) headers['content-type'] = 'application/x-www-form-urlencoded';
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) throw new Error('The run only talks to its own API origin.');
    const response = await fetch(url, { method: init.method ?? 'GET', headers, redirect: 'manual',
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : init.form ? { body: init.form.toString() } : {}) });
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';'), at = pair.indexOf('=');
      const name = pair.slice(0, at).trim(), value = pair.slice(at + 1).trim();
      if (/Max-Age=0/i.test(line)) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    return response;
  }
  /** The Walk action: start, the simulated provider's chooser and approval, then the callback, all over HTTP. */
  async signIn(personId: string, returnTo: string) {
    const start = await this.request(`${REALM_AUTH_ROUTES.start}?returnTo=${encodeURIComponent(returnTo)}`);
    if (start.status !== 302) throw new Error(`Sign-in start answered ${start.status}.`);
    const authorize = new URL(start.headers.get('location')!);
    const chooser = await this.request(authorize.pathname + authorize.search);
    if (chooser.status !== 200 || !(await chooser.text()).includes('SIMULATED')) throw new Error('The simulated chooser did not open.');
    const form = new URLSearchParams(authorize.searchParams);
    form.set('person', personId); form.set('decision', 'allow');
    const approved = await this.request(authorize.pathname.replace(/authorize$/, 'approve'), { method: 'POST', form });
    const callback = new URL(approved.headers.get('location') ?? 'about:blank');
    if (callback.pathname !== REALM_AUTH_ROUTES.callback) throw new Error(`The provider answered ${approved.status} without a callback.`);
    const back = await this.request(callback.pathname + callback.search);
    if (back.status !== 303) throw new Error(`The callback answered ${back.status}.`);
    const landed = back.headers.get('location') ?? '';
    if (/[?&]signin=/.test(landed)) throw new Error(`Sign-in ended with ${landed.replace(/^.*signin=/, '')}.`);
    const session = await this.session();
    if (session.status !== 'authenticated') throw new Error('The session is still anonymous after the callback.');
    return { landed, resumeScope: session.resumeScope };
  }
  async session() { return RealmSessionReplySchema.parse(await (await this.request(REALM_AUTH_ROUTES.session)).json()); }
  async ticket(kingdomId: string): Promise<RealmJoin> {
    const session = await this.session();
    if (session.status !== 'authenticated') throw new Error('Not signed in.');
    const response = await this.request(REALM_AUTH_ROUTES.ticket, { method: 'POST', csrf: session.csrfToken, body: { version: 1, kingdomId, protocol: 1 } });
    if (response.status !== 200) throw new Error(`The ticket route answered ${response.status}.`);
    return RealmTicketReplySchema.parse(await response.json()).join;
  }
}

// The founded scene ------------------------------------------------------------------------------------------------

export interface FetchedScene {
  readonly manifest: ReturnType<typeof RealmFoundedManifestSchema.parse>; readonly scene: RealmFoundedScene; readonly bytes: number;
}
/** Exactly what the browser does: the no-store receipt, then the hash-addressed bytes, verified. */
export async function fetchScene(realm: string, kingdomId: string): Promise<FetchedScene> {
  const receipt = await fetch(`${realm}${REALM_FOUNDED_ROUTES.manifest.replace(':kingdomId', kingdomId)}`, { cache: 'no-store' });
  if (!receipt.ok) throw new Error(`The founded receipt answered ${receipt.status}.`);
  const manifest = RealmFoundedManifestSchema.parse(await receipt.json());
  const response = await fetch(`${realm}${REALM_FOUNDED_ROUTES.scene.replace(':sceneHash', manifest.sceneHash)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`The founded scene answered ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== manifest.sceneHash) throw new Error('The founded scene bytes do not match their receipt.');
  const scene = JSON.parse(new TextDecoder().decode(bytes)) as RealmFoundedScene;
  if (scene.kingdomId !== manifest.kingdomId || scene.origin !== manifest.origin || scene.collisionRevision !== manifest.collisionRevision
    || scene.layoutRevision !== manifest.layoutRevision) throw new Error('The founded scene does not match its receipt.');
  return { manifest, scene, bytes: bytes.byteLength };
}
export function compileWorld(scene: RealmFoundedScene): CollisionWorld { return compileFoundedScene(scene); }

// Walkers ----------------------------------------------------------------------------------------------------------

export interface Walker {
  readonly name: string; readonly personId: string; readonly client: RealmClient; readonly controller: FishingController;
  readonly fishing: FishingLink; readonly items: ItemLink;
  input: { moveX: number; moveZ: number; buttons: number; yaw: number };
  /** Every fishing request the controller sent, at performance.now() time. */
  readonly sent: { t: number; type: string; castId?: string; on?: boolean }[];
  pose(): { x: number; y: number; z: number; grounded: boolean; yaw: number; revision: number };
  dispose(): void;
}

/** Joins with the browser's own connectRealm and drives its frame tick at 60 Hz, as a page would. */
export async function joinWalker(options: { name: string; personId: string; realm: string; kingdomId: string; browser: Browser;
  resumeScope: string; collision: RealmCollision }): Promise<Walker> {
  const client = await connectRealm(options.realm, { kingdomId: options.kingdomId as never, resumeScope: options.resumeScope,
    ticket: () => options.browser.ticket(options.kingdomId) }, options.collision);
  const walker: Walker = {
    name: options.name, personId: options.personId, client,
    fishing: fishingLink(client.room), items: itemLink(client.room),
    controller: undefined as never,
    input: { moveX: 0, moveZ: 0, buttons: 0, yaw: 0 },
    sent: [],
    pose() { const p = client.predicted; return { x: p.x, y: p.y, z: p.z, grounded: p.grounded, yaw: p.yaw, revision: p.collisionRevision }; },
    dispose() { clearInterval(timer); walker.controller.dispose(); walker.fishing.dispose(); walker.items.dispose(); client.dispose(); },
  };
  // Record what the controller sends (type, cast and time), so a run can show exactly which presses reached the room.
  const send = walker.fishing.send.bind(walker.fishing);
  walker.fishing.send = request => {
    walker.sent.push({ t: performance.now(), type: request.type, ...('castId' in request ? { castId: request.castId } : {}),
      ...('on' in request ? { on: request.on } : {}) });
    send(request);
  };
  for (const type of ['private', 'world']) client.room.onMessage(type, () => {});
  Object.assign(walker, { controller: createFishingController({ link: walker.fishing, selfWalkerId: client.selfId }) });
  const timer = setInterval(() => {
    try { client.tick(performance.now(), { ...walker.input, collisionRevision: client.room.state.collisionRevision }); }
    catch (error) { log(`${options.name}: frame failed: ${(error as Error).message}`); }
  }, 1000 / 60);
  return walker;
}

async function until<T>(what: string, ms: number, probe: () => T | null | undefined | false): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await delay(20);
  }
}

export function routeOptions(plan: SettlementPlan) {
  return { water: (x: number, z: number) => pierWaterAt(plan, x, z), ground: (x: number, z: number) => foundedGroundAt(plan, x, z)[1] };
}

/** Plans on the room's world, proves the route offline with the movement law, then walks it live. */
export async function walkTo(walker: Walker, world: CollisionWorld, plan: SettlementPlan, goal: Vec3, accept: (p: Vec3) => boolean,
  options: { sprint?: boolean; label: string; corridor?: number; finish?: Vec3 }) {
  const started = Date.now(), from = walker.pose();
  let path: Vec3[] | null = null;
  const blocked = new Set<string>();
  path = await planRoute(world, [from.x, from.y, from.z], goal, { ...routeOptions(plan), corridor: options.corridor ?? 60, maxExpansions: 600_000 }, accept, blocked);
  if (!path) throw new Error(`${walker.name}: no walkable route for ${options.label} (searched ${lastSearch.expansions} cells, closest ${lastSearch.closest.toFixed(1)} m at ${lastSearch.closestAt.map(n => n.toFixed(2)).join(', ')}).`);
  const planned = Date.now() - started;
  const proof = simulateRoute(world, { x: from.x, y: from.y, z: from.z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: from.yaw, distance: 0, collisionRevision: world.revision },
    path, { sprint: !!options.sprint });
  if (!proof.ok) throw new Error(`${walker.name}: the planned ${options.label} route stalls offline at point ${proof.at}/${path.length}.`);
  log(`${walker.name}: route ${options.label}: ${path.length} cells, ${(path.length * .5).toFixed(0)} m, planned in ${planned} ms, proven offline in ${proof.ticks} ticks`);
  const steer = createSteering(path, { sprint: !!options.sprint });
  const walkStarted = Date.now();
  let best = Infinity, bestAt = Date.now();
  for (;;) {
    const p = walker.pose();
    if (steer.done(p) && p.grounded) {
      const server = walker.client.room.state.walkers.get(walker.client.selfId);
      if (server && Math.hypot(server.x - p.x, server.z - p.z) < .05) break;
    }
    walker.input = steer.input(p);
    const end = path[path.length - 1]!, left = Math.hypot(end[0] - p.x, end[2] - p.z);
    if (left < best - .05) { best = left; bestAt = Date.now(); }
    if (Date.now() - bestAt > 8000) throw new Error(`${walker.name}: stalled ${left.toFixed(2)} m short on the ${options.label} route at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}.`);
    await delay(16);
  }
  if (options.finish) {
    // The last few centimetres straight onto the exact spot, slowly, on the deck the route already proved clear.
    const target = options.finish, ends = Date.now() + 6000;
    for (;;) {
      const p = walker.pose(), dx = target[0] - p.x, dz = target[2] - p.z, d = Math.hypot(dx, dz);
      if (d <= .08) break;
      if (Date.now() > ends) throw new Error(`${walker.name}: could not settle on the ${options.label} spot (${d.toFixed(2)} m off).`);
      const scale = Math.max(.25, Math.min(1, d * 1.5));
      walker.input = { moveX: Math.round(dx / d * 127 * scale), moveZ: Math.round(dz / d * 127 * scale), buttons: 0, yaw: steer.yawByte(dx, dz) };
      await delay(16);
    }
  }
  walker.input = { moveX: 0, moveZ: 0, buttons: 0, yaw: walker.input.yaw };
  await delay(250);
  const p = walker.pose();
  return { label: options.label, cells: path.length, plannedMs: planned, offlineTicks: proof.ticks, walkedMs: Date.now() - walkStarted,
    end: [p.x, p.y, p.z].map(n => Math.round(n * 1000) / 1000) };
}

/** Turn in place to a byte yaw; the movement law takes the input's yaw every tick. */
export async function face(walker: Walker, yaw: number) {
  walker.input = { moveX: 0, moveZ: 0, buttons: 0, yaw };
  await until('the turn to reach the room', 4000, () => {
    const server = walker.client.room.state.walkers.get(walker.client.selfId);
    return server?.yaw === yaw && server.grounded;
  });
}

// Fishing ----------------------------------------------------------------------------------------------------------

export function outByte(site: FishingPierSite) {
  const out: Vec3 = site.turn === 0 ? [0, 0, 1] : site.turn === 1 ? [1, 0, 0] : site.turn === 2 ? [0, 0, -1] : [-1, 0, 0];
  return ((Math.round(Math.atan2(out[0], out[2]) / (Math.PI * 2) * 256) % 256) + 256) % 256;
}
export function lipPoint(site: FishingPierSite, across = 0): Vec3 {
  const p = pierLocalToWorld(site, [10 + across / .125, 0, (site.walk + 3.35) / .125]);
  return [p[0], site.deckY, p[2]];
}
export function onLip(site: FishingPierSite, p: { x: number; y: number; z: number }, revision: number, yaw = outByte(site)) {
  return onFishingLip(site, { position: [p.x, p.y, p.z], yaw, grounded: true, collisionRevision: revision }, revision);
}

export interface Beat { readonly t: number; readonly kind: string; readonly castId?: string; readonly outcome?: string; readonly detail?: unknown }

/**
 * The bench's fair automatic player (apps/web/src/fishing/play-bench.ts `player`), on the real clock: draw after a
 * pause, release after ~900 ms, strike 260 ms after the dip, and in the fight hold to reel except while the fish
 * runs or the tension is above 6500. Casts ending snapped, escaped or missed are cast again, up to a cap.
 */
export async function fishUntilKept(walker: Walker, options: { maxCasts: number; maxMs: number }) {
  const controller = walker.controller, started = performance.now(), beats: Beat[] = [], casts: { castId: string; outcome: string; ms: number }[] = [];
  const t = () => Math.round(performance.now() - started);
  let kept: Extract<FishingEvent, { kind: 'kept' }> | null = null, caught: Extract<FishingEvent, { kind: 'caught' }> | null = null;
  const castStarts = new Map<string, number>();
  const off = controller.subscribe(event => {
    if (event.kind === 'state') return;
    if (event.kind === 'note') { beats.push({ t: t(), kind: 'note', detail: event.message }); return; }
    if (event.kind === 'kept') { kept = event; beats.push({ t: t(), kind: 'kept', castId: event.castId }); return; }
    if (event.kind === 'caught') { if (event.self) caught = event; beats.push({ t: t(), kind: 'caught', castId: event.castId, detail: { self: event.self } }); return; }
    if (event.kind === 'rod' || event.kind === 'taken') return;
    if (!event.self) return;
    if (event.kind === 'draw' && !castStarts.has(event.castId)) castStarts.set(event.castId, t());
    beats.push({ t: t(), kind: event.kind, castId: event.castId, ...(event.outcome ? { outcome: event.outcome } : {}) });
    if (event.kind === 'ended') casts.push({ castId: event.castId, outcome: event.outcome ?? 'ended', ms: t() - (castStarts.get(event.castId) ?? t()) });
  });
  const since = { at: performance.now(), phase: '' };
  let lastFight = '';
  try {
    while (!kept) {
      if (performance.now() - started > options.maxMs) throw new Error(`No catch was kept within ${options.maxMs} ms (${casts.length} casts ended).`);
      if (casts.length >= options.maxCasts) throw new Error(`No catch was kept in ${casts.length} casts.`);
      const state = controller.state(), cast = state.cast, clock = performance.now();
      const phase = cast?.phase ?? (state.input === 'drawing' ? 'drawing-local' : 'idle');
      if (phase !== since.phase) { since.phase = phase; since.at = clock; }
      const age = clock - since.at;
      if (cast?.fight) {
        const f = `${cast.fight.phase}:${cast.fight.tired}`;
        if (f !== lastFight) { lastFight = f; beats.push({ t: t(), kind: 'fight', castId: cast.id, detail: { phase: cast.fight.phase, tired: cast.fight.tired, tension: cast.fight.tension, progress: cast.fight.progress } }); }
      }
      if (state.rod && !state.pendingCastId) {
        if (phase === 'idle' && age > 2200) controller.press();
        else if ((phase === 'drawing' || phase === 'drawing-local') && age > 900) controller.release();
        else if (phase === 'bite' && age > 260) controller.press();
        else if (phase === 'fighting') { const fight = cast?.fight; if (fight && (fight.phase === 'run' || fight.tension > 6500)) controller.release(); else controller.press(); }
      }
      await delay(20);
    }
  } finally { off(); }
  const done = kept as Extract<FishingEvent, { kind: 'kept' }>;
  const castMs = castStarts.get(done.castId);
  return { kept: done, caught: caught as Extract<FishingEvent, { kind: 'caught' }> | null, beats, endedCasts: casts,
    keptCastBeats: beats.filter(beat => beat.castId === done.castId).map(beat => ({ ...beat, t: beat.t - (castMs ?? 0) })), totalMs: t(), startedAt: started };
}

// The bag ----------------------------------------------------------------------------------------------------------

function request<T extends ItemReply>(link: ItemLink, build: (id: string) => Parameters<ItemLink['send']>[0], type: T['type']): Promise<T> {
  return new Promise((resolve, reject) => {
    const sent = build(requestId('e2e'));
    const timer = setTimeout(() => { off(); reject(new Error(`No ${type} answer.`)); }, 10_000);
    const off = link.subscribe(reply => {
      if (!('id' in reply) || reply.id !== sent.id) return;
      clearTimeout(timer); off();
      if (reply.type === 'items.refused') reject(new Error(`The bag refused: ${reply.message}`)); else if (reply.type === type) resolve(reply as T);
      else reject(new Error(`Unexpected ${reply.type} answer.`));
    });
    link.send(sent);
  });
}
/** The bag as the bag page reads it: bounded pages over the items channel until the cursor ends. */
export async function listBag(walker: Walker): Promise<ItemRecord[]> {
  const items: ItemRecord[] = [];
  let after: string | undefined;
  for (let page = 0; page < 50; page++) {
    const reply = await request<Extract<ItemReply, { type: 'items.list' }>>(walker.items, id => ({ type: 'items.list', id, ...(after ? { after } : {}) }), 'items.list');
    items.push(...reply.items);
    if (!reply.next) return items;
    after = reply.next;
  }
  throw new Error('The bag did not end within 50 pages.');
}
export async function itemHistory(walker: Walker, itemId: string): Promise<ItemEvent[]> {
  const reply = await request<Extract<ItemReply, { type: 'items.history' }>>(walker.items, id => ({ type: 'items.history', id, itemId }), 'items.history');
  return [...reply.events];
}

const titles = new Map([...FISH_ITEM_DEFINITIONS, WILLOW_ROD_DEFINITION].map(def => [def.id, def]));
/** The card's words: the definition's title and lore, and the record's story. */
export function card(item: ItemRecord) {
  const def = titles.get(item.defId);
  return { id: item.id, defId: item.defId, title: def?.title ?? null, lore: def?.lore ?? null, branch: item.branch, place: item.place, slot: item.slot,
    count: item.count, storied: item.storied, story: item.story, source: item.source, detail: item.detail, createdAt: item.createdAt, revision: item.revision };
}

/** The observer's record of another walker's public fishing, from its own room links. */
export function observe(observer: Walker, subjectWalkerId: () => string | null) {
  const started = performance.now(), seen: Beat[] = [];
  const t = () => Math.round(performance.now() - started);
  const off = observer.fishing.subscribe((reply: FishingChannelReply) => {
    const subject = subjectWalkerId();
    if (!subject) return;
    if (reply.type === 'pier.rod' && reply.walkerId === subject) seen.push({ t: t(), kind: 'rod', detail: { equipped: reply.equipped } });
    if (reply.type === 'pier.beats') for (const beat of reply.beats) if (beat.walkerId === subject) seen.push({ t: t(), kind: beat.kind, castId: beat.castId, ...(beat.outcome ? { outcome: beat.outcome } : {}) });
    if (reply.type === 'pier.casts') {
      const line = reply.casts.find(cast => cast.walkerId === subject);
      const last = [...seen].reverse().find(beat => beat.kind === 'line');
      const phase = line?.phase ?? null;
      if (line && (!last || (last.detail as { phase: string | null }).phase !== phase)) {
        seen.push({ t: t(), kind: 'line', castId: line.id, detail: { phase, anchor: line.anchor.map(n => Math.round(n * 100) / 100),
          float: line.float?.map(n => Math.round(n * 100) / 100) ?? null, ...(line.fight ? { fight: { phase: line.fight.phase, tension: line.fight.tension, progress: line.fight.progress } } : {}) } });
      }
    }
    if (reply.type === 'pier.caught' && reply.walkerId === subject) seen.push({ t: t(), kind: 'caught', castId: reply.castId, detail: { fish: reply.fish, kingdomFirst: reply.kingdomFirst } });
  });
  return { seen, dispose: off };
}

export { until, delay, sha256 };
