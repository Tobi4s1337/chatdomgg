// The durable SIMULATED realm behind the walk proof, composed in this process as apps/realm/src/main.ts composes it:
// the durable boot with the evening bridge AND the evening interactions attached (the anvil opens only with both),
// founded/entry/watch routes, authenticated Herald ingress, and the Forge chat service on its production routes.
// Nothing here listens on TCP: the realm binds an owned Unix socket in the private run directory.
// Twitch is simulated: the Forge chat service gets `simulatedTwitch` as its fetch. A sent chat message is played back
// as the Herald would: a chat witness to INGRESS_ROUTE, then the Herald-shaped wish to REALM_HERALD_ROUTE.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 'realm_forge_wish';
// The SIMULATED provider's test range above its six named people (apps/api/src/realm-auth/simulated-provider.ts).
const PEOPLE_RANGE = [990_100_007, 990_199_999];
const PROOF_LEASE_MS = 60_000;
const TERMINAL = new Set(['delivered', 'held', 'refused', 'cold', 'canceled']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const identity = () => (BigInt('0x' + randomBytes(12).toString('hex')) + 1n).toString();
function check(condition, message) { if (!condition) throw new Error(`Walk proof: ${message}`); }

export async function startWalkRealm({ loader, repo, directory, mode, wishes, log, queue = false }) {
  const load = path => loader.ssrLoadModule(path);
  const shared = await load('/packages/shared/src/index.ts');
  const { REALM_HERALD_ROUTE } = await load('/packages/shared/src/realm/index.ts');
  const { createDurableRealmBoot, mountEntryRoutes, mountRealmWatchRoutes } = await load('/apps/realm/src/bootstrap/index.ts');
  const { TenureEvidenceVerifier } = await load('/apps/realm/src/allocation/index.ts');
  const { createRealmPool, migrateRealmSchema, describeStorageFailure } = await load('/apps/realm/src/persistence/index.ts');
  const { createRealmCitizens } = await load('/apps/realm/src/evening/citizens.ts');
  const { RealmEveningBridge, mountEveningRoutes } = await load('/apps/realm/src/evening/index.ts');
  const { attachEveningInteractions } = await load('/apps/realm/src/evening/interactions.ts');
  const { INGRESS_ROUTE } = await load('/apps/realm/src/ingress/index.ts');
  const { FileForgeApprovals, ForgeWriteGate, forgeMessageKey } = await load('/apps/realm/src/wiring/index.ts');
  const { forgeChatAuthority } = await load('/apps/realm/src/wiring/forge-chat-authority.ts');
  const forgeChat = await load('/apps/realm/src/forge-chat/index.ts');
  const { ownRealmShutdown } = await load('/apps/realm/src/lifecycle.ts');
  const { createForgeProviders } = await load('/apps/codex/src/providers/index.ts');
  const { runCodexDraft } = await load('/apps/codex/src/providers/codex-cli.ts');
  const { forgeJudgeQuestions } = await load('/apps/codex/src/providers/policy.ts');
  const { createFoundedInteractionRegistry, interactionTargetId } = await load('/packages/world/src/interactions/index.ts');
  const { adoptProofLayout, settleProofPeople, qualifyProofPeople } = await load('/work/lanes/forge-wish/runtime/seed.ts');
  const { probeCliLaunch } = await load('/work/lanes/forge-wish/runtime/cli-probe.ts');
  const authService = await load('/apps/api/src/realm-auth/service.ts');
  const authHttp = await load('/apps/api/src/realm-auth/http.ts');
  const simulatedOidc = await load('/apps/api/src/realm-auth/simulated-provider.ts');
  const apiRequire = createRequire(join(repo, 'apps/api/package.json'));
  const { createRemoteJWKSet } = await import(pathToFileURL(apiRequire.resolve('jose')).href);

  const socketPath = join(directory, 'realm.sock'), foundedDirectory = join(directory, 'founded');
  const evidenceKey = randomBytes(32), heraldSecret = randomBytes(32).toString('hex');
  const kingdomId = shared.KingdomIdSchema.parse(identity()), kingdomName = 'Birchlight';
  const names = new Map([[kingdomId, kingdomName]]);
  const words = wishes.map(wish => wish.words);
  const redact = text => words.reduce((value, phrase) => value.split(phrase).join('[wish]'), String(text));
  // Operational facts only: statuses, times and counts. Never words or chat text.
  const facts = { observations: [], heralds: [], realmLog: [], twitch: { validate: 0, sent: 0, refused: 0 }, modelCalls: [], usageLimit: false,
    publicLeak: false, publicCommits: 0, heartbeatFailures: 0 };

  const pool = createRealmPool({ connectionString: process.env.DATABASE_URL, schema: SCHEMA });
  const authPool = createRealmPool({ connectionString: process.env.DATABASE_URL, schema: SCHEMA }, { poolSize: 4 });
  let boot, evening, runtime, hold, chat, heartbeat, beat, listening = false, stopping, off;
  const rooms = new Map(), late = new Map(), activeCalls = new Set();
  const realmCleanup = () => stopping ??= (async () => {
    if (heartbeat) clearInterval(heartbeat); off?.();
    const stopEvening = evening?.stop(); void stopEvening?.catch(() => {});
    try { await Promise.allSettled([...activeCalls]); await chat?.service.stop().catch(() => {}); await stopEvening; }
    finally {
      try { await beat?.catch(() => {}); await hold?.release(); }
      finally { try { await boot?.stop(); } finally { await Promise.allSettled([pool.end(), authPool.end()]); } }
    }
  })();

  try {
    for (const db of [pool, authPool]) {
      const path = await db.query("select current_setting('search_path')=$1 as isolated", [SCHEMA]);
      check(path.rows[0]?.isolated, 'connection search path is not the lane schema.');
    }
    await migrateRealmSchema(pool, SCHEMA);
    check((await pool.query('select current_schema()=$1 as isolated', [SCHEMA])).rows[0]?.isolated, 'current schema is not the lane schema.');
    await forgeChat.installForgeChatSchema(pool);

    // Fresh SIMULATED people in the provider's test range that this schema has never seen.
    const ids = new Set();
    while (ids.size < wishes.length) {
      const id = String(randomInt(PEOPLE_RANGE[0], PEOPLE_RANGE[1] + 1));
      if (ids.has(id)) continue;
      if (!(await pool.query('select 1 from realm_persons where person_id=$1', [id])).rowCount) ids.add(id);
    }
    const personIds = [...ids].map(id => shared.PersonIdSchema.parse(id));

    // --queue: drafting waits while the proof holds the smith, so a line can form behind the wish at the anvil.
    let held = null, letGo = () => {};
    const controlled = createForgeProviders({ runCodex: async ({ model, image }) => {
      facts.modelCalls.push({ kind: !model ? 'draft' : image ? 'result' : 'words', outcome: 'controlled' });
      if (!model && held) await held;
      await pause(1000 + randomInt(0, 1500));
      if (!model) return JSON.stringify({ draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' },
        title: 'Sleeping keeper', plaque: 'Warm dreams above the hearth.' }, interpretation: 'as-wished', shared: 'subject' });
      return JSON.stringify({ answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })),
        subject: { motif: 'sleeping-dragon', slot: 'chimney' } });
    } });
    const real = () => createForgeProviders({ runCodex: async input => {
      check(!facts.usageLimit, 'a usage limit stopped further model calls.');
      const call = runCodexDraft({ ...input, onComplete: metric => {
        facts.modelCalls.push({ kind: input.model ? (input.image ? 'result' : 'words') : 'draft', outcome: metric.outcome, elapsedMs: metric.elapsedMs });
        if (metric.outcome === 'usage-limit') facts.usageLimit = true;
      } });
      activeCalls.add(call); void call.finally(() => activeCalls.delete(call)).catch(() => {});
      return call;
    } });
    if (mode === 'real') {
      const launch = await probeCliLaunch(directory);
      check(launch.started, 'this process cannot launch the Codex CLI; no wish was typed.');
    }
    const providers = mode === 'real' ? real() : controlled;

    const gate = new ForgeWriteGate(), approvals = new FileForgeApprovals(join(foundedDirectory, 'forge-approvals'));
    const citizens = createRealmCitizens({ db: pool, origin: 'simulated', kingdomNames: names, evidenceKey });
    boot = createDurableRealmBoot({ pool, origin: 'simulated', foundedDirectory,
      verifier: new TenureEvidenceVerifier('simulated', evidenceKey), ingressCredentials: { herald: heraldSecret },
      foundedAccess: target => target.origin === 'simulated', furnish: citizens.furnish,
      // The shared development host runs at load 25 to 35, and this one process also serves the build and drives
      // Chrome; a 15 s writer lease lapsed there with no fault in the realm. The private proof holds its kingdom on a
      // 60 s lease instead. Production keeps REALM_LEASE_MS; losing a lease is covered by the realm's own tests.
      repositoryOptions: { ...gate.install({ origin: 'simulated' }), leaseMs: PROOF_LEASE_MS },
      // Operational lines (Forge steps, statuses, reasons), kept privately in summary.json with wish words redacted.
      log: line => { if (facts.realmLog.length < 400) facts.realmLog.push(redact(typeof line === 'string' ? line : JSON.stringify(line)).slice(0, 400)); },
      attach: kingdom => {
        // Test-only observation of the room effects the kingdom hands its interaction authority, so the proof can
        // stand the walker at the anvil through the kingdom's own placement (as its recovery does) instead of a
        // long walk under SwiftShader. Nothing else about the authority changes.
        const bindAuthority = kingdom.bindInteractionAuthority.bind(kingdom);
        kingdom.bindInteractionAuthority = authority => {
          const bindRoom = authority.bindRoom;
          authority.bindRoom = effects => {
            rooms.set(kingdom.kingdomId, { kingdom, effects });
            const detach = bindRoom(effects);
            return () => { if (rooms.get(kingdom.kingdomId)?.effects === effects) rooms.delete(kingdom.kingdomId); detach(); };
          };
          return bindAuthority(authority);
        };
        const detachEvening = evening.attach(kingdom);
        const detachInteractions = attachEveningInteractions(kingdom, { auth: boot.services.auth,
          scene: () => boot.loader.current(kingdom.kingdomId)?.scene });
        return () => { detachInteractions(); detachEvening(); };
      },
    });
    citizens.use(boot.allocation, boot.services);
    evening = new RealmEveningBridge({ origin: 'simulated', ingress: boot.ingress, gate, approvals, providers,
      // --queue: the durable wish line, as apps/realm/src/main.ts composes it.
      ...(queue ? { forgeQueue: { directory: join(foundedDirectory, 'forge-queue') } } : {}),
      beforeObservation: input => citizens.observe(input),
      forgeLog: event => { if (facts.realmLog.length < 400) facts.realmLog.push(redact(JSON.stringify(event)).slice(0, 400)); },
      forgeChatObserver: async observation => {
        facts.observations.push({ personId: observation.personId, messageId: observation.messageId, status: observation.status, at: Date.now(),
          ...(observation.message ? { message: redact(observation.message).slice(0, 300) } : {}) });
        await chat?.service.observe(observation);
      } });
    evening.use(boot.services);

    log('adopt the founded layout');
    await adoptProofLayout(boot, kingdomId);
    await boot.readiness.start();
    if (queue) await evening.start();
    log('settle citizens with homes and rights');
    const settled = await settleProofPeople(boot, citizens, kingdomId, personIds, true);
    hold = await boot.services.retain(kingdomId);
    const kingdom = hold.kingdom;
    off = kingdom.subscribe(delivery => {
      const text = JSON.stringify(delivery);
      if (words.some(phrase => text.includes(phrase))) facts.publicLeak = true;
      if (delivery.message.type === 'forge' && delivery.message.event.type === 'committed') facts.publicCommits++;
    });

    // Colyseus registers its own SIGINT/SIGTERM/SIGUSR2 and uncaughtException exits on construction. The proof's
    // driver owns the process: it closes Chrome, the served build and the lock before this realm, then exits.
    const watched = ['SIGINT', 'SIGTERM', 'SIGUSR2', 'uncaughtException'];
    const before = new Map(watched.map(name => [name, new Set(process.listeners(name))]));
    runtime = boot.createServer({ mountIngress: app => mountEveningRoutes(app, evening) });
    for (const name of watched) for (const listener of process.listeners(name)) if (!before.get(name).has(listener)) process.removeListener(name, listener);
    const app = runtime.transport.app;
    mountEntryRoutes(app, boot.founded, 'simulated', names);
    mountRealmWatchRoutes(app, boot);
    if (queue) {
      const { mountForgeQueueRoutes } = await load('/apps/realm/src/forge-queue/http.ts');
      mountForgeQueueRoutes(app, evening.line, { pool: authPool, origin: 'simulated', secureCookies: false });
    }
    // The production Forge chat routes need the browser's exact origin, known only once the first lock cycle picks
    // the web port. Reserve the routes now; `open()` mounts mountForgeChatRoutes' own handlers behind them.
    for (const route of Object.values(shared.FORGE_CHAT_ROUTES)) {
      const method = route === shared.FORGE_CHAT_ROUTES.status || route === shared.FORGE_CHAT_ROUTES.callback ? 'get' : 'post';
      app[method](route, (response, request) => {
        const handler = late.get(`${method} ${route}`);
        if (handler) { handler(response, request); return; }
        response.cork(() => response.writeStatus('503 Service Unavailable').writeHeader('Content-Type', 'application/json')
          .writeHeader('Cache-Control', 'no-store').end(JSON.stringify({ version: 1, status: 'error', code: 'unavailable', message: 'The forge cannot reach chat just now.' })));
      });
    }
    const nativeUnix = app.listen_unix.bind(app);
    let bound = false;
    app.listen_unix = (callback, path) => nativeUnix(socket => { bound = Boolean(socket); callback(socket); }, path);
    // A closed listener or a stalled shutdown marks the run failed; the driver still closes everything it owns.
    ownRealmShutdown(runtime.server, runtime.transport, realmCleanup, code => { facts.realmExit = code; process.exitCode = code; });
    await runtime.server.listen(socketPath); listening = true;
    check(bound && (await stat(socketPath)).isSocket(), 'the realm did not bind its owned Unix socket.');

    const post = (route, body, authorized = true) => new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const request = httpRequest({ socketPath, path: route, method: 'POST', timeout: 15_000, headers: { 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data), ...(authorized ? { Authorization: `Bearer ${heraldSecret}` } : {}) } }, response => {
        response.resume(); response.once('end', () => resolve(response.statusCode));
      });
      request.once('timeout', () => request.destroy(new Error('Walk proof: realm request timed out.')));
      request.once('error', reject); request.end(data);
    });
    const now = () => Math.floor(kingdom.databaseNow());
    const sessionId = `walk-proof-night-${randomUUID()}`;
    let observation = 0;
    const stream = at => ({ version: 1, observation: { version: 1, id: `walk-proof-stream-${observation++}`, kingdomId,
      origin: 'simulated', observedAt: at, kind: 'stream', live: true, sessionId } });
    check(await post(INGRESS_ROUTE, stream(now() - 660_000), false) === 401, 'unauthenticated ingress was accepted.');
    check(await post(INGRESS_ROUTE, stream(now() - 660_000)) === 202, 'the stream start was not accepted.');
    const sendHeartbeat = async () => { check(await post(INGRESS_ROUTE, stream(now() - 25)) === 202, 'a stream heartbeat was not accepted.'); };
    await sendHeartbeat();
    for (const end = Date.now() + 20_000; !(kingdom.privateState.stream.sessionId === sessionId && kingdom.privateState.stream.liveUntil > kingdom.databaseNow());) {
      check(Date.now() < end, 'the stream evidence did not commit.'); await pause(100);
    }
    heartbeat = setInterval(() => {
      if (beat) return;
      beat = sendHeartbeat().catch(() => { facts.heartbeatFailures++; }).finally(() => { beat = undefined; });
    }, 20_000); heartbeat.unref?.();
    log('earn one coal per citizen');
    const qualification = await qualifyProofPeople(boot, kingdomId, settled, sessionId);
    check(qualification.minimumCoal >= 1, 'a citizen has no coal.');

    // Anvil and doors from the actual adopted scene's interaction registry (the same one the room serves).
    const registry = () => {
      const scene = boot.loader.current(kingdomId)?.scene;
      check(scene, 'the adopted founded scene is not loaded.');
      return createFoundedInteractionRegistry(scene, kingdom.world);
    };
    const anvil = registry().get(interactionTargetId.anvil('market'))?.target;
    check(anvil?.kind === 'anvil', 'the founded scene has no market anvil.');

    const people = settled.map(person => ({ personId: person.personId, slot: person.slot, homeId: person.homeId, token: `walk-proof-${randomBytes(18).toString('hex')}` }));
    await writeFile(join(directory, 'realm.json'), JSON.stringify({ kingdomId, people: people.map(({ token, ...person }) => person) }), { mode: 0o600 });

    const herald = async (person, messageId, text) => {
      const row = { messageId, personId: person.personId, startedAt: Date.now() };
      facts.heralds.push(row);
      const at = now() - 25;
      const witness = { version: 1, observation: { version: 1, id: `walk-proof-chat-${randomUUID()}`, kingdomId, origin: 'simulated',
        observedAt: at, kind: 'observe', source: 'chat', coverage: 'activity', people: [{ personId: person.personId, disclosure: 'anonymous' }] } };
      row.witness = await post(INGRESS_ROUTE, witness);
      const command = { kingdomId, personId: person.personId, messageId, slot: person.slot, words: text, observedAt: at };
      row.wish = await post(REALM_HERALD_ROUTE, { version: 1, forge: { type: 'wish', origin: 'simulated', command } });
      row.acceptedAt = Date.now();
    };
    // Simulated Twitch for the Forge chat service only. It answers token validation and Send Chat Message for this
    // run's own simulated grants; anything else is refused. No request leaves this process.
    const simulatedTwitch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      const headers = new Headers(init.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      const bearer = (headers.get('authorization') ?? '').replace(/^(?:OAuth|Bearer) /, '');
      const person = people.find(candidate => candidate.token === bearer);
      if (url.origin === 'https://id.twitch.tv' && url.pathname === '/oauth2/validate') {
        facts.twitch.validate++;
        if (!person) return json(401, { status: 401, message: 'invalid access token' });
        return json(200, { client_id: chat.config.clientId, login: `walkproof${person.personId}`, user_id: person.personId,
          scopes: [shared.FORGE_CHAT_SCOPE], expires_in: 3600 });
      }
      if (url.origin === 'https://api.twitch.tv' && url.pathname === '/helix/chat/messages' && (init.method ?? 'GET').toUpperCase() === 'POST') {
        let body = null;
        try { body = JSON.parse(String(init.body)); } catch { /* refused below */ }
        if (!person || headers.get('client-id') !== chat.config.clientId || body?.sender_id !== person.personId
          || body?.broadcaster_id !== kingdomId || typeof body?.message !== 'string' || !body.message.startsWith('!forge ')) {
          facts.twitch.refused++; return json(403, { status: 403, message: 'SIMULATED Twitch refused this request' });
        }
        facts.twitch.sent++;
        const messageId = `walk-proof-${randomUUID()}`, text = body.message.slice('!forge '.length);
        // Twitch confirms first; the Herald sees the chat message a moment later.
        setTimeout(() => { void herald(person, messageId, text).catch(error => {
          const row = facts.heralds.find(item => item.messageId === messageId); if (row) row.error = redact(error?.message ?? error);
        }); }, 400);
        return json(200, { data: [{ message_id: messageId, is_sent: true, drop_reason: null }] });
      }
      facts.twitch.refused++;
      return json(403, { status: 403, message: 'SIMULATED Twitch refused this request' });
    };

    let opened;
    return {
      kingdomId, kingdomName, people, anvil, socketPath, facts, redact,
      notice: 'SIMULATED rehearsal · private forge-wish walk proof: simulated sign-in, simulated Twitch chat, isolated realm.',
      /** Once, inside the first lock cycle: the browser origin is now fixed for this run. */
      async open(publicOrigin) {
        if (opened) { check(opened.publicOrigin === publicOrigin, 'the browser origin changed between cycles.'); return opened.auth; }
        const config = { clientId: `SIMULATED-walk-proof-${randomUUID()}`, clientSecret: randomBytes(24).toString('hex'),
          redirectUri: publicOrigin + shared.FORGE_CHAT_ROUTES.callback, tokenKey: randomBytes(32) };
        const store = new forgeChat.PostgresForgeChatStore(pool, 'simulated', new forgeChat.ForgeChatCipher(config.tokenKey, config.clientId));
        const service = forgeChat.createForgeChatService({ origin: 'simulated', store, config, fetch: simulatedTwitch,
          ...forgeChatAuthority({ origin: 'simulated', services: boot.services, founded: id => !!boot.loader.current(id)?.scene }) });
        chat = { config, store, service };
        // service.start() is deliberately not called: its sweep validates and may forget every simulated grant in the
        // shared lane schema. This run touches only its own people.
        for (const person of people) {
          await store.withGrantLock(person.personId, async (_grant, save) => save({ accessToken: person.token,
            refreshToken: `walk-proof-${randomBytes(18).toString('hex')}`, expiresAt: Date.now() + 6 * 3_600_000, validatedAt: Date.now() }));
        }
        forgeChat.mountForgeChatRoutes({ get: (route, handler) => late.set(`get ${route}`, handler), post: (route, handler) => late.set(`post ${route}`, handler) },
          service, { pool: authPool, origin: 'simulated', publicOrigin, secureCookies: false });
        const redirectUri = `${publicOrigin}/api/realm/auth/callback`;
        const simulated = await simulatedOidc.createSimulatedOidcProvider({ publicOrigin, internalOrigin: publicOrigin, redirectUri });
        const auth = authService.createRealmAuthService({ pool: authPool, provider: simulated.provider, redirectUri,
          keys: createRemoteJWKSet(new URL(simulated.provider.jwksUri), { timeoutDuration: 5000 }) });
        await auth.ready();
        opened = { publicOrigin, auth: authHttp.createRealmAuthHttp({ service: auth, publicOrigin, secureCookies: false, extra: simulated.handle }) };
        return opened.auth;
      },
      /** The kingdom's own placement of a connected walker (the seam its recovery uses). */
      place(walkerId, position) {
        const room = rooms.get(kingdomId);
        return !!room && room.kingdom.current && room.effects.placeWalker(walkerId, position, room.kingdom.world.revision);
      },
      /** The playback a sent chat message gets (chat witness, then the Herald-shaped wish), without a browser:
       * for the offline backend check (`check.mjs`), never used by the walk proof itself. */
      async replayChatWish(personId, words) {
        const person = people.find(item => item.personId === personId);
        check(person, 'unknown citizen.');
        return herald(person, `walk-proof-${randomUUID()}`, words);
      },
      /** --queue: hold drafting (true) so wishes wait in line, or let the smith work again (false). */
      holdForge(on) {
        if (on && !held) held = new Promise(resolve => { letGo = resolve; });
        if (!on && held) { held = null; letGo(); }
      },
      /** --queue: the kingdom's wish line, head first (person ids only). */
      line: () => queue ? evening.line.line(kingdomId).map(entry => entry.personId) : [],
      door(personId) {
        const home = Object.values(kingdom.privateState.homes).find(item => item.ownerId === personId);
        return home ? registry().get(interactionTargetId.homeDoor(home.id))?.target ?? null : null;
      },
      outcome(personId) {
        const last = facts.observations.filter(item => item.personId === personId).at(-1);
        return last && TERMINAL.has(last.status) ? last : null;
      },
      async landed(personId) {
        const sent = facts.heralds.filter(item => item.personId === personId).at(-1);
        if (!sent) return { attachments: 0, spent: 0, coal: kingdom.privateState.coals[personId] ?? 0 };
        const key = forgeMessageKey(kingdomId, sent.messageId);
        const made = Object.values(kingdom.privateState.attachments).filter(item => item.forgeKey === key && item.ownerId === personId);
        const ledger = await pool.query('select delta from realm_coal_ledger where kingdom_id=$1 and person_id=$2 and delta=-1', [kingdomId, personId]);
        return { attachments: made.length, spent: ledger.rowCount, coal: kingdom.privateState.coals[personId] ?? 0,
          kind: made[0]?.attachment.draft.plan.kind ?? null };
      },
      async stop() {
        if (runtime && listening) await runtime.server.gracefullyShutdown(false).catch(() => {});
        await realmCleanup();
      },
    };
  } catch (error) {
    try { if (runtime && listening) await runtime.server.gracefullyShutdown(false); } catch { /* cleanup below */ }
    await realmCleanup().catch(() => {});
    const message = error instanceof Error && error.message.startsWith('Walk proof:') ? error.message : describeStorageFailure(error);
    throw new Error(redact(message));
  }
}
