import { execFile } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, parseRaidChatFrame, parseRaidGuestVisualMark } from '@chatdom/shared';
import { REALM_FOUNDED_ROUTES, REALM_WATCH_ROUTE, RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { compileFoundedScene } from '@chatdom/world/founded-collision';
import { decodeFoundedScene } from '@chatdom/world/founded-scene';
import { parseRaidWelcomePath } from '../../../api/src/raid-gate/guest-contracts';
import { connectRealm, type RealmClient } from '../../../web/src/realm/client';
import { createRealmPool, migrateRealmSchema } from '../persistence';
import { closeServer, freePort, listen, openShowAuth, openShowHerald, openShowRealm, readBody, ShowBrowser, SHOW_DOOR_SECRET, waitFor } from './incoming-show-harness';
import { openPcPage, openSwiftShaderPage, type StagePage } from './incoming-show-pages';

/**
 * RS10 staged capture on the lane's own stack (RAID_SHOW_STAGE=1, own random schema, dropped afterwards).
 * The same SIMULATED realm, Herald door, crier and sign-in as the composed flow test, with the actual `/stream`
 * view of the web build pointed at this realm. One Twitch CLI raid arrives while the stream is showing the kingdom;
 * two raiders walk in by the crier's link and one of them chats. One still per capture-lock hold.
 *
 *   RAID_SHOW_STAGE=1 node --env-file=<db env> node_modules/vitest/vitest.mjs run --no-fsModuleCache \
 *     apps/realm/src/raid-gate/incoming-show.stage.test.ts
 * Env: RAID_SHOW_DIST (built web, default /tmp/rs-dist), RAID_SHOW_SIZE (1920x1080), RAID_SHOW_VIEWERS (140),
 * RAID_SHOW_SHOTS (`name@ms,...`: stills at ms after the raid; default `guests@12000`), RAID_SHOW_PREFIX (evidence file
 * prefix, default `stack-stream`, or `stack-walker` in the walker's view). RAID_SHOW_VIEW=walker shoots a raider's own
 * browser instead of the stream: a third raider, Ash, signed in on the SIMULATED provider, opens the crier's link through
 * the private `/-/raid-gate?guestWalk=` bench, which runs the production welcome entry admitting only this stack's
 * simulated origin (the live `/raid/...` route admits only a live kingdom).
 * RAID_SHOW_GPU=1 runs inside `chatdom-pc-lease`: the preview is served on 5192 and Tobias's real-GPU Chrome opens it
 * through his tunnel (no capture lock). Otherwise headless SwiftShader here, inside one shared capture-lock hold.
 */
const exec = promisify(execFile);
const kingdomId = KingdomIdSchema.parse('129634568');
const raiderId = KingdomIdSchema.parse('412000777');
const wrenId = PersonIdSchema.parse('990100001'), tamsinId = PersonIdSchema.parse('990100002'), ashId = PersonIdSchema.parse('990100003');
const lane = (name: string, fallback: string) => process.env[name] ?? fallback;

const unheld = (port: number) => new Promise<boolean>(resolve => {
  const probe = createProbe();
  probe.once('error', () => resolve(false));
  probe.listen({ port, host: '0.0.0.0', exclusive: true }, () => probe.close(() => resolve(true)));
});
const sign = (id: string, stamp: string, body: string) => `sha256=${createHmac('sha256', SHOW_DOOR_SECRET).update(id + stamp + body).digest('hex')}`;

describe.runIf(process.env.RAID_SHOW_STAGE === '1')('RS10 staged stream capture on the lane stack (SIMULATED)', () => {
  it('shows one CLI raid, its walked-in guests and a chat lantern in the actual stream view', async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('RAID_SHOW_STAGE=1 requires DATABASE_URL');
    const [width, height] = lane('RAID_SHOW_SIZE', '1920x1080').split('x').map(Number) as [number, number];
    const viewers = Number(lane('RAID_SHOW_VIEWERS', '140'));
    if (![3, 140, 10_000, 70_000].includes(viewers)) throw new Error('Choose a specified raid scale');
    const gpu = process.env.RAID_SHOW_GPU === '1';
    const walkerView = lane('RAID_SHOW_VIEW', 'stream') === 'walker';
    const prefix = lane('RAID_SHOW_PREFIX', walkerView ? 'stack-walker' : 'stack-stream');
    const shots = lane('RAID_SHOW_SHOTS', 'guests@12000').split(',').map(entry => {
      const [name, at] = entry.split('@');
      return { file: `${prefix}-${name}@${width}x${height}.png`, at: Number(at) };
    }).sort((a, b) => a.at - b.at);
    if (!shots.every(shot => /^[a-z0-9@.-]+\.png$/u.test(shot.file) && Number.isFinite(shot.at) && shot.at >= 0)) throw new Error('Shots are name@ms with plain names');
    // Its own prefix, so a stopped stage leaves a schema that is recognisably this lane's to drop.
    const schema = `raid_show_stage_${randomBytes(6).toString('hex')}`;
    const pool = createRealmPool({ connectionString, schema });
    const directory = await mkdtemp(join(tmpdir(), 'chatdom-raid-stage-'));
    const evidenceKey = randomBytes(32), raidReplies: unknown[] = [];
    let doorUrl = '';
    // The CLI writes the delivery; the stage gives the raid a legible channel and the chosen scale, then signs it
    // with the mock door's secret exactly as Twitch would (scripts/live/raid.mjs does the same for the live bench).
    const capture = createServer((request, response) => { void (async () => {
      const raw = JSON.parse(await readBody(request)) as { event: Record<string, unknown> };
      Object.assign(raw.event, { viewers, from_broadcaster_user_login: 'mossbrook', from_broadcaster_user_name: 'Mossbrook',
        to_broadcaster_user_login: 'tobi4s_', to_broadcaster_user_name: 'tobi4s_' });
      const body = JSON.stringify(raw), id = String(request.headers['twitch-eventsub-message-id']), stamp = String(request.headers['twitch-eventsub-message-timestamp']);
      const answer = await fetch(doorUrl, { method: 'POST', body, headers: { 'content-type': 'application/json', 'Twitch-Eventsub-Message-Id': id,
        'Twitch-Eventsub-Message-Timestamp': stamp, 'Twitch-Eventsub-Message-Type': String(request.headers['twitch-eventsub-message-type']),
        'Twitch-Eventsub-Message-Signature': sign(id, stamp, body) } });
      response.writeHead(answer.status); response.end(Buffer.from(await answer.arrayBuffer()));
    })().catch(() => { if (!response.headersSent) response.writeHead(502); response.end(); }); });
    let dispatch: (request: IncomingMessage, response: ServerResponse) => Promise<void> = async (_request, response) => { response.writeHead(503).end(); };
    const api = createServer((request, response) => { void dispatch(request, response).catch(() => { if (!response.headersSent) response.writeHead(500).end(); }); });
    const clients: RealmClient[] = [];
    let realm: Awaited<ReturnType<typeof openShowRealm>> | undefined, herald: Awaited<ReturnType<typeof openShowHerald>> | undefined;
    let server: { close(): Promise<void> } | undefined, page: StagePage | undefined, release: (() => Promise<void>) | undefined;
    let hold: ReturnType<typeof setTimeout> | undefined;
    try {
      await migrateRealmSchema(pool, schema);
      const apiOrigin = await listen(api);
      // The realm's address is fixed first so the web preview can proxy to it; the preview's origin is then the
      // public origin of sign-in and of the crier's link, exactly as one public host serves both in production.
      const realmPort = await freePort();
      process.env.CHATDOM_REALM_TARGET = `http://127.0.0.1:${realmPort}`; process.env.CHATDOM_API_TARGET = apiOrigin;
      const { preview } = await import('vite');
      let base = '';
      if (gpu) {
        // pc-lease freed 5192 for this lane; the PC's tunnel forwards its own localhost:5192 here.
        server = await preview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'warn',
          build: { outDir: lane('RAID_SHOW_DIST', '/tmp/rs-dist') }, preview: { host: '127.0.0.1', port: 5192, strictPort: true } }) as unknown as { close(): Promise<void> };
        base = 'http://localhost:5192';
      }
      for (const deadline = Date.now() + 600_000; !base && Date.now() < deadline;) {
        for (let port = 5186; port >= 5170 && !base; port--) {
          if (!await unheld(port)) continue;
          try {
            server = await preview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'warn',
              build: { outDir: lane('RAID_SHOW_DIST', '/tmp/rs-dist') }, preview: { host: '127.0.0.1', port, strictPort: true } }) as unknown as { close(): Promise<void> };
            base = `http://127.0.0.1:${port}`;
          } catch (error) { if (!/EADDRINUSE|in use/iu.test(String(error))) throw error; }
        }
        if (!base) await new Promise(resolve => setTimeout(resolve, 5_000));
      }
      if (!base) throw new Error('No free lane preview port in 5170–5186 for ten minutes');
      dispatch = await openShowAuth({ pool, connectionString, schema, apiOrigin, publicOrigin: base });
      realm = await openShowRealm({ pool, kingdomId, kingdomName: 'tobi4s_', directory, evidenceKey, publicOrigin: () => base, port: realmPort });
      const plan = generateSettlementPlan({ seed: 'SIMULATED-tobi4s-incoming-show', tier: 'hamlet', firstYear: 2026, year: 2026 });
      expect(await realm.boot.allocation.adoptLayout(kingdomId, plan)).toMatchObject({ status: 'founded' });
      herald = await openShowHerald({ kingdomId, realmUrl: realm.endpoint, outbox: join(directory, 'outbox'), raidReplies });
      doorUrl = `http://127.0.0.1:${herald.door.port}/eventsub`;
      const captureUrl = await listen(capture);
      const manifest = RealmFoundedManifestSchema.parse(await (await fetch(`${realm.endpoint}${REALM_FOUNDED_ROUTES.manifest.replace(':kingdomId', kingdomId)}`)).json());
      const scene = await decodeFoundedScene(new Uint8Array(await (await fetch(`${realm.endpoint}${REALM_FOUNDED_ROUTES.scene.replace(':sceneHash', manifest.sceneHash)}`)).arrayBuffer()), manifest);
      const collision = compileFoundedScene(scene);

      if (process.env.RAID_SHOW_PROBE) {
        // Wiring probe: the stack and preview stay up without a browser or the capture lock.
        console.log(`[stage] probe ${base} realm ${realm.endpoint} api ${apiOrigin}`);
        await new Promise(resolve => setTimeout(resolve, Number(process.env.RAID_SHOW_PROBE) * 1000));
        return;
      }
      // Raiders already signed in to Chatdom answer the crier quickly: they only accept the link's raid and walk in.
      // (The flow test signs in through the link itself; here it keeps the still near the caravan's passage.)
      const visitors = [{ person: wrenId, name: 'Wren' }, { person: tamsinId, name: 'Tamsin' }].map(entry => ({ ...entry, visitor: new ShowBrowser(base) }));
      for (const { visitor, person } of visitors) await visitor.signIn(person, '/-/realm');
      // The walker's own browser: signed in like the others, its session handed to the page before it follows the link.
      const ash = walkerView ? new ShowBrowser(base) : undefined;
      if (ash) await ash.signIn(ashId, '/-/realm');

      // SwiftShader: one shared capture-lock hold, released within five minutes. GPU: the caller holds pc-lease.
      if (!gpu) {
        const lockModule = '../../../../packages/testing/capture-lock.mjs';
        const { acquireCaptureLock } = await import(/* @vite-ignore */ lockModule) as { acquireCaptureLock(options: { signal: AbortSignal }): Promise<() => Promise<void>> };
        release = await acquireCaptureLock({ signal: AbortSignal.timeout(3_000_000) });
      }
      const holdStarted = Date.now(), hardStop = new AbortController();
      if (!gpu) hold = setTimeout(() => { hardStop.abort(); void page?.close().catch(() => {}); }, 290_000);
      const opened = gpu ? await openPcPage(width, height) : await openSwiftShaderPage(width, height);
      page = opened;
      console.log(`[stage] renderer ${opened.renderer}`);
      const progress = () => opened.evaluate(() => {
        const host = window as unknown as { __chatdomReady?: boolean; __chatdomStream?: { phase: string; loading: string; source: string } };
        return { ready: host.__chatdomReady ?? null, phase: host.__chatdomStream?.phase ?? null, loading: host.__chatdomStream?.loading ?? null,
          source: host.__chatdomStream?.source ?? null, text: document.body.innerText.slice(0, 400) };
      }).catch(error => ({ error: String(error) }));
      const ready = async (ms: number) => {
        const ticker = setInterval(() => { void progress().then(value => console.log(`[stage] ${Math.round((Date.now() - holdStarted) / 1000)} s`, JSON.stringify(value))); }, 30_000);
        try { await opened.waitReady(ms); }
        catch (error) {
          await opened.screenshot('/tmp/rs-stage-failed.png').catch(() => {});
          await writeFile('/tmp/rs-stage-failed.json', JSON.stringify({ progress: await progress(), console: opened.console.slice(-60), errors: opened.errors }, null, 2));
          throw error;
        } finally { clearInterval(ticker); }
      };
      let route = `/stream?source=realm&kingdom=${kingdomId}`;
      if (!walkerView) { await opened.goto(`${base}${route}`); await ready(225_000); }
      let loadedMs = Date.now() - holdStarted;
      // What the page itself shows of walkers, every quarter second, beside its longest frame in that quarter:
      // the realm's own trace (below) says what was sent, this says what a viewer saw.
      const pageTraceFrom = Date.now();
      await opened.evaluate(() => {
        const host = window as unknown as { __raidShowPeople?: { t: number; names: number; worstFrame: number }[] };
        const samples: { t: number; names: number; worstFrame: number }[] = host.__raidShowPeople = [];
        const start = performance.now();
        let last = start, worst = 0;
        const frame = (now: number) => { worst = Math.max(worst, now - last); last = now; requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
        setInterval(() => {
          if (samples.length >= 1_200) return;
          samples.push({ t: Math.round(performance.now() - start), names: document.querySelector('.stream-people-labels')?.children.length ?? 0, worstFrame: Math.round(worst) });
          worst = 0;
        }, 250);
      });

      // 1. The Twitch CLI raid, through Herald's door and outbox, into the realm and on to the open stream.
      await exec('/root/.local/bin/twitch', ['event', 'trigger', 'channel.raid', '-F', `${captureUrl}/eventsub`, '-s', SHOW_DOOR_SECRET,
        '-t', kingdomId, '-f', raiderId], { timeout: 20_000, env: { ...process.env, XDG_CONFIG_HOME: join(directory, 'cli'), TWITCH_DISABLE_UPDATE_CHECKS: 'true' } });
      await herald.realm.flush(); await realm.show.ledger.recover();
      const raidSent = Date.now(), steps: Record<string, number> = {};
      const mark = (step: string) => { steps[step] = Date.now() - raidSent; };
      await mkdir('work/evidence/raid-show', { recursive: true });
      const taken: { file: string; at: number; tookAfterMs: number; scene: unknown }[] = [];
      const state = () => opened.evaluate(() => {
        const host = window as unknown as { __chatdomKingdom?: { inspect(): { moments?: { view: Record<string, unknown>; controller: unknown } }; stats: unknown };
          __chatdomStream?: { director: unknown; phase: string } };
        const moments = host.__chatdomKingdom?.inspect().moments;
        return { preparation: (moments as { preparation?: unknown } | undefined)?.preparation ?? null, view: moments?.view ?? null, controller: moments?.controller ?? null, stats: host.__chatdomKingdom?.stats ?? null,
          director: host.__chatdomStream?.director ?? null, phase: host.__chatdomStream?.phase ?? null,
          notice: document.querySelector('.raid-entry-welcome')?.textContent?.trim() ?? null,
          labels: [...document.querySelectorAll('[class*="label"]')].map(node => node.textContent?.trim()).filter(Boolean).slice(0, 24) };
      });
      // The stills run on their own clock beside the raiders' walk-in, so the gate's first seconds are not missed.
      // On SwiftShader there is no in-page polling before a still (a frame takes seconds); its state is read after.
      const shoot = async (zero: number) => {
        for (const shot of shots) {
          const wait = zero + shot.at - Date.now();
          if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
          if (hardStop.signal.aborted) throw new Error('The capture hold reached its limit');
          const file = `work/evidence/raid-show/${shot.file}`, started = Date.now() - zero;
          await opened.screenshot(file);
          taken.push({ file, at: shot.at, tookAfterMs: started, scene: await state().catch(error => ({ error: String(error) })) });
        }
      };
      // What the realm itself tells every watcher about walkers, sampled once a second: the stream draws only these.
      const walkerTrace: { at: number; frames: number; walkers: number; events: string[] }[] = [];
      const tracing = new AbortController();
      void (async () => {
        const response = await fetch(`${realm!.endpoint}${REALM_WATCH_ROUTE.replace(':kingdomId', kingdomId)}`, { signal: tracing.signal });
        const reader = response.body!.getReader(), decoder = new TextDecoder();
        let text = '', second = { at: 0, frames: 0, walkers: -1, events: [] as string[] };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          for (let end = text.indexOf('\n\n'); end >= 0; end = text.indexOf('\n\n')) {
            const block = text.slice(0, end); text = text.slice(end + 2);
            const event = /^event: (.+)$/mu.exec(block)?.[1], data = /^data: (.+)$/mu.exec(block)?.[1];
            if (!event) continue;
            const at = Math.floor((Date.now() - raidSent) / 1000);
            if (at !== second.at) { if (second.frames || second.events.length) walkerTrace.push(second); second = { at, frames: 0, walkers: -1, events: [] }; }
            if (event === 'walkers' && data) { second.frames++; second.walkers = (JSON.parse(data) as { walkers: unknown[] }).walkers.length; }
            else if (event !== 'world' && event !== 'transient' && second.events.length < 4) second.events.push(event);
          }
        }
        walkerTrace.push(second);
      })().catch(() => {});
      let shooting: Promise<void> = walkerView ? Promise.resolve() : shoot(raidSent);
      shooting.catch(() => {});
      const row = (await pool.query('select observation, raid_id from realm_raid_observations')).rows[0] as { observation: string; raid_id: string };
      const observation = JSON.parse(row.observation) as { from: { kingdomId: string; login: string; name: string }; viewers: number };
      const raidId = row.raid_id;

      // 2. The crier's one line, then raiders who follow its link, sign in and walk in at the gate.
      await herald.mock.worker.poll(); mark('crier');
      const line = herald.mock.transport.records[0]?.text ?? '';
      const link = new URL(/https?:\/\/\S+/u.exec(line)![0]);
      expect(link.origin).toBe(base);
      const invitation = parseRaidWelcomePath(link.pathname)!;
      if (ash) {
        // Ash follows the crier's link in a browser: the page itself records the intent, takes its ticket and joins.
        await opened.setCookies([...ash.cookies].map(([name, value]) => ({ name, value })), base);
        route = `/-/raid-gate?guestWalk=${encodeURIComponent(link.pathname)}`;
        await opened.goto(`${base}${route}`); mark('walker-page');
        void ready(120_000).then(() => mark('walker-ready'), () => {});
        shooting = shoot(raidSent); shooting.catch(() => {});
      }
      loadedMs = walkerView ? Date.now() - holdStarted : loadedMs;
      const walkers: { name: string; client: RealmClient }[] = [];
      for (const { visitor, name } of visitors) {
        await visitor.begin(invitation.kingdomId, invitation.raidId);
        const session = await visitor.session(); if (session.status !== 'authenticated') throw new Error('Expected authenticated walker');
        const ticket = await visitor.ticket(kingdomId);
        const client = await connectRealm(realm.endpoint, { kingdomId, resumeScope: session.resumeScope, ticket: async () => ticket }, collision);
        client.room.onMessage('world', () => {});
        clients.push(client); walkers.push({ name, client });
      }
      await realm.runtime.flush();
      await waitFor(() => walkers.every(({ client }) => !!parseRaidGuestVisualMark(client.room.state.walkers.get(client.selfId)?.raidGuest, Date.now())), 'guest marks', 20_000);
      mark('guests');

      const speaker = { id: wrenId, name: 'Wren', login: 'wren' };

      // 3. A raider says hello in tobi4s_'s Twitch chat; the door ties it to the raid and the gate lights a lantern.
      const chatId = `SIMULATED-${speaker.login}-${randomBytes(4).toString('hex')}`, stamp = new Date().toISOString(), messageId = `chat-${chatId}`;
      const chatBody = JSON.stringify({ subscription: { type: 'channel.chat.message', version: '1' }, event: { broadcaster_user_id: kingdomId,
        chatter_user_id: speaker.id, chatter_user_name: speaker.name, chatter_user_login: speaker.login, message_id: chatId,
        message: { text: 'Good evening, tobi4s_!' }, source_broadcaster_user_id: null } });
      await fetch(doorUrl, { method: 'POST', body: chatBody, headers: { 'content-type': 'application/json', 'Twitch-Eventsub-Message-Id': messageId,
        'Twitch-Eventsub-Message-Timestamp': stamp, 'Twitch-Eventsub-Message-Type': 'notification', 'Twitch-Eventsub-Message-Signature': sign(messageId, stamp, chatBody) } });
      await waitFor(async () => { await herald!.realm.flush();
        return (parseRaidChatFrame(await (await fetch(`${realm!.endpoint}/realm/raid-chat/${kingdomId}`)).json(), Date.now())?.lights.length ?? 0) > 0; }, 'raid lantern', 20_000);
      mark('lantern');

      // 4. The stills, on the stream's clock from the raid.
      await shooting;
      tracing.abort();
      const pageTrace = (await opened.evaluate(() => (window as unknown as { __raidShowPeople?: { t: number; names: number; worstFrame: number }[] }).__raidShowPeople ?? [])
        .catch(() => [])).map(sample => ({ ...sample, t: sample.t + pageTraceFrom - raidSent }));
      const poses = walkers.map(({ name, client }) => { const pose = client.room.state.walkers.get(client.selfId)!;
        return { name, at: [pose.x, pose.y, pose.z], homeSlot: pose.homeSlot, raidGuest: parseRaidGuestVisualMark(pose.raidGuest, Date.now()) }; });
      const errors = opened.errors;
      for (const shot of taken) {
        await writeFile(shot.file.replace(/\.png$/u, '.json'), JSON.stringify({ renderer: opened.renderer, performanceEvidence: false, route, size: [width, height],
          stack: 'lane stack: own schema, SIMULATED OIDC, Herald mock door, recording crier', loadedMs, at: shot.at, shotAfterMs: shot.tookAfterMs,
          heldMs: Date.now() - holdStarted, steps, raid: { raidId, viewers: observation.viewers, from: observation.from }, raidReplies, crier: line,
          guests: poses, speaker: speaker.name, walkerTrace, pageTrace, errors, console: opened.console.slice(-60), scene: shot.scene }, null, 2));
        console.log(`Look at ${shot.file}`);
      }
      expect(errors).toEqual([]);
      expect(poses.every(pose => pose.raidGuest?.fromKingdomId === raiderId)).toBe(true);
      if (ash) console.log(`[stage] walker notice: ${JSON.stringify((taken.at(-1)?.scene as { notice?: unknown } | undefined)?.notice ?? null)}`);
    } finally {
      if (hold) clearTimeout(hold);
      await page?.close().catch(() => {});
      await release?.();
      await server?.close().catch(() => {});
      for (const client of clients) client.dispose();
      try { await herald?.close(); }
      finally {
        try { await realm?.close(); }
        finally {
          await closeServer(capture); await closeServer(api);
          await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
          await rm(directory, { recursive: true, force: true });
        }
      }
    }
  }, 3_600_000);
});
