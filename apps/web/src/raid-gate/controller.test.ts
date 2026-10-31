import { describe, expect, it } from 'vitest';
import type { GateCommand, GateReply, KingdomId } from '../../../api/src/raid-gate/contracts';
import { createGateBench } from './bench';
import { createRaidGateController, type GateSnapshot, type RaidGateController } from './controller';
import type { RaidGateApi } from './ports';

const FERN = '41000002' as KingdomId, OAKEN = '41000003' as KingdomId;
const SOURCE = { kingdomId: '41000001' as KingdomId, name: 'Willowmere', login: 'willowmere' };

const settled = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(controller: RaidGateController, done: (snapshot: GateSnapshot) => boolean) {
  for (let i = 0; i < 50 && !done(controller.snapshot()); i++) await settled();
  return controller.snapshot();
}

describe('Raid Gate controller', () => {
  it('offers nothing it cannot do when no authority is bound', () => {
    const controller = createRaidGateController({ api: null, atlas: null, source: SOURCE, clock: () => 0 });
    controller.open();
    expect(controller.snapshot()).toMatchObject({ phase: 'unbound', origin: null, destination: null, optedIn: 0 });
  });

  it('walks the monarch from the map to a preview the authority issued, and follows walkers who choose to march', async () => {
    let now = 1_800_000_000_000;
    const clock = () => now;
    const bench = createGateBench({ viewer: 'monarch', authority: 'ready', clock });
    const controller = createRaidGateController({ api: bench.api, atlas: bench.atlas, source: bench.source, clock });
    expect(controller.snapshot().phase).toBe('loading');
    expect(await until(controller, s => s.phase === 'idle')).toMatchObject({ viewer: 'monarch', authority: 'ready', origin: 'simulated' });
    controller.open();
    expect(controller.snapshot().phase).toBe('choosing');
    expect(bench.finder.open()).toBe(true);
    bench.finder.pick(FERN);
    expect(controller.snapshot()).toMatchObject({ phase: 'previewing', asking: { displayName: 'Fernhollow' } });
    const preview = await until(controller, s => s.phase === 'preview');
    expect(preview).toMatchObject({ destination: { target: { kingdomId: FERN, founded: true }, land: 'founded', channel: { kingdomName: 'Fernhollow' } }, optedIn: 0 });
    await bench.walkersJoin(2, preview.requestId!);
    expect(await until(controller, s => s.optedIn === 2)).toMatchObject({ optedIn: 2, joined: false });
    await controller.join();
    expect(controller.snapshot()).toMatchObject({ optedIn: 3, joined: true });
    now += 120_000;
    expect(controller.snapshot()).toMatchObject({ phase: 'lapsed', optedIn: 0, joined: false });
    controller.dispose();
  });

  it('shows walkers the open gate and never the monarch grant', async () => {
    const clock = () => 1_800_000_000_000;
    const bench = createGateBench({ viewer: 'walker', authority: 'revoked', clock });
    const controller = createRaidGateController({ api: bench.api, atlas: bench.atlas, source: bench.source, clock });
    expect(await until(controller, s => s.phase !== 'loading')).toMatchObject({ phase: 'quiet', viewer: 'walker', authority: null });
  });

  it('explains a withdrawn grant and opens the gate once the monarch reconnects', async () => {
    const clock = () => 1_800_000_000_000;
    const bench = createGateBench({ viewer: 'monarch', authority: 'revoked', clock });
    const controller = createRaidGateController({ api: bench.api, atlas: bench.atlas, source: bench.source, clock, account: { reconnect: () => bench.reconnect() } });
    expect(await until(controller, s => s.phase !== 'loading')).toMatchObject({ phase: 'authority', authority: 'revoked', canReconnect: true });
    controller.open();
    expect(bench.finder.open()).toBe(false);
    controller.reconnect();
    expect(await until(controller, s => s.phase === 'idle')).toMatchObject({ authority: 'ready' });
  });

  it('lets the monarch close the gate, and tells a walker who chose to march that nobody left', async () => {
    let now = 1_800_000_000_000;
    const clock = () => now;
    const bench = createGateBench({ viewer: 'walker', authority: 'ready', clock });
    const walker = createRaidGateController({ api: bench.api, atlas: bench.atlas, source: bench.source, clock });
    await until(walker, s => s.phase === 'quiet');
    const first = await bench.monarchPreview(FERN);
    const requestId = first.kind === 'preview' ? first.value.requestId : '';
    await until(walker, s => s.phase === 'gathering');
    await walker.join();
    expect(walker.snapshot()).toMatchObject({ joined: true, optedIn: 1, farewell: null });
    expect(await bench.monarchClose(requestId)).toMatchObject({ kind: 'action', value: { state: 'cancelled' } });
    expect(await until(walker, s => s.phase === 'quiet')).toMatchObject({ joined: false, optedIn: 0, farewell: { reason: 'closed', joined: true, destination: { target: { kingdomId: FERN } } } });
    now += 6 * 60_000;
    expect(walker.snapshot().farewell).toBeNull();

    // A new destination ends an earlier choice; the walker hears why and chooses again.
    const second = await bench.monarchPreview(FERN);
    await until(walker, s => s.phase === 'gathering');
    await walker.join();
    await bench.monarchPreview(OAKEN);
    expect(await until(walker, s => s.destination?.target.kingdomId === OAKEN)).toMatchObject({ phase: 'gathering', joined: false, farewell: { reason: 'changed', joined: true } });
    await walker.join();
    expect(walker.snapshot()).toMatchObject({ joined: true, farewell: null });
    expect(second.kind).toBe('preview');
    now += 120_000;
    expect(walker.snapshot()).toMatchObject({ phase: 'quiet', farewell: { reason: 'lapsed', joined: true } });
    walker.dispose();
  });

  it("closes the monarch's own preview through the authority", async () => {
    const clock = () => 1_800_000_000_000;
    const bench = createGateBench({ viewer: 'monarch', authority: 'ready', clock });
    const controller = createRaidGateController({ api: bench.api, atlas: bench.atlas, source: bench.source, clock });
    await until(controller, s => s.phase === 'idle');
    void controller.preview(FERN);
    await until(controller, s => s.phase === 'preview');
    const closing = controller.cancel();
    expect(controller.snapshot().busy).toBe('close');
    await closing;
    expect(await until(controller, s => s.busy === null)).toMatchObject({ phase: 'idle', requestId: null, farewell: { reason: 'closed' } });
  });

  it('lets only the newest preview land when an older reply arrives late', async () => {
    const pending: { command: GateCommand; resolve: (reply: GateReply) => void }[] = [];
    // The server handled both requests in order, so its gate now points at the second.
    let open: Extract<GateReply, { kind: 'gate' }>['value']['open'] = null;
    const api: RaidGateApi = {
      origin: 'simulated',
      request: command => command.op === 'gate'
        ? Promise.resolve({ kind: 'gate', value: { kingdomId: SOURCE.kingdomId, viewer: 'monarch', authority: 'ready', open } })
        // This viewer has never travelled.
        : command.op === 'whereabouts' ? Promise.resolve({ kind: 'denied', code: 'stale' })
        : new Promise(resolve => pending.push({ command, resolve })),
      subscribe: () => undefined,
    };
    const controller = createRaidGateController({ api, atlas: null, source: SOURCE, clock: () => 1_000, ids: (() => { let n = 0; return () => `request-${++n}`; })() });
    await until(controller, s => s.phase === 'idle');
    void controller.preview(FERN);
    void controller.preview(OAKEN);
    const reply = (index: number, to: KingdomId): GateReply => ({ kind: 'preview', value: {
      token: `token-${index}`, requestId: `request-${index + 1}`, from: SOURCE.kingdomId, to, expiresAt: 121_000, optedIn: 0,
      target: { kingdomId: to, founded: to === FERN, live: true, classification: 'general' },
    } });
    open = { requestId: 'request-2', revision: 1, to: OAKEN, target: { kingdomId: OAKEN, founded: false, live: true, classification: 'general' }, state: 'prepared', optedIn: 0, expiresAt: 121_000, joined: false, countdownEndsAt: null, raid: null };
    pending[1]!.resolve(reply(1, OAKEN));
    await settled();
    pending[0]!.resolve(reply(0, FERN));
    await settled();
    expect(controller.snapshot()).toMatchObject({ phase: 'preview', requestId: 'request-2', destination: { target: { kingdomId: OAKEN } } });
  });

  it('opens the gate once, counts down with Twitch, and sets out only on the witnessed raid', async () => {
    let now = 1_800_000_000_000;
    const clock = () => now;
    const bench = createGateBench({ viewer: 'monarch', authority: 'ready', clock });
    const controller = createRaidGateController({ api: bench.api, atlas: bench.atlas, source: bench.source, clock });
    await until(controller, s => s.phase === 'idle');
    controller.open();
    bench.finder.pick(FERN);
    const preview = await until(controller, s => s.phase === 'preview' && s.canStart);
    await controller.join();
    const starting = controller.start();
    expect(controller.snapshot()).toMatchObject({ phase: 'starting', busy: 'start' });
    await starting;
    expect(await until(controller, s => s.phase === 'countdown' && s.busy === null)).toMatchObject({ state: 'pending', countdownEndsAt: now + 90_000, joined: true, canStart: false });
    await controller.start();
    expect(bench.log.writes).toEqual([`start ${preview.requestId}`]);
    now += 40_000;
    expect(await bench.witness(preview.requestId!)).toMatchObject({ kind: 'landed' });
    const departed = await until(controller, s => s.phase === 'departed');
    expect(departed).toMatchObject({ raid: { viewers: 23, evidence: { label: 'SIMULATED' } }, joined: true, optedIn: 1, destination: { target: { kingdomId: FERN } } });
    await controller.refresh();
    expect(bench.log.followed).toEqual([`simulated-raid-${preview.requestId}`]);
    expect(bench.log.roads).toHaveLength(1);
    // After the news, the monarch can call the realm again; the old preview does not come back as lapsed.
    now += 5 * 60_000;
    expect(await until(controller, s => s.phase === 'idle')).toMatchObject({ farewell: null });
    controller.dispose();
  });

  it('checks rather than pressing again when Twitch\'s reply is lost', async () => {
    const clock = () => 1_800_000_000_000;
    const bench = createGateBench({ viewer: 'monarch', authority: 'ready', clock, twitch: 'lose' });
    const controller = createRaidGateController({ api: bench.api, atlas: bench.atlas, source: bench.source, clock });
    await until(controller, s => s.phase === 'idle');
    controller.open();
    bench.finder.pick(FERN);
    await until(controller, s => s.canStart);
    await controller.start();
    expect(await until(controller, s => s.phase === 'checking' && s.busy === null)).toMatchObject({ state: 'unknown', countdownEndsAt: null });
    await controller.reconcile();
    expect(await until(controller, s => s.phase === 'countdown')).toMatchObject({ state: 'pending' });
    expect(bench.log.writes).toHaveLength(1);
    controller.dispose();
  });

  it('asks what became of a press whose request was lost, and says plainly when nothing was sent', async () => {
    const bench = createGateBench({ viewer: 'monarch', authority: 'ready', clock: () => 1_800_000_000_000 });
    let dropStart = true;
    const api: RaidGateApi = {
      ...bench.api,
      request: (command, signal) => command.op === 'start' && dropStart ? Promise.reject(new Error('offline')) : bench.api.request(command, signal),
    };
    const controller = createRaidGateController({ api, atlas: bench.atlas, source: bench.source, clock: () => 1_800_000_000_000 });
    await until(controller, s => s.phase === 'idle');
    controller.open();
    bench.finder.pick(FERN);
    await until(controller, s => s.canStart);
    await controller.start();
    expect(await until(controller, s => s.busy === null)).toMatchObject({ phase: 'preview', notice: { kind: 'not-sent' }, canStart: true });
    expect(bench.log.writes).toEqual([]);
    dropStart = false;
    await controller.start();
    expect(await until(controller, s => s.phase === 'countdown')).toMatchObject({ notice: null });
    expect(bench.log.writes).toHaveLength(1);
  });

  it('follows the witnessed raid through the gate one authority answer at a time, confirms a lost arrival, and comes home', async () => {
    let now = 1_800_000_000_000;
    const clock = () => now;
    const bench = createGateBench({ viewer: 'walker', authority: 'ready', clock, rooms: 'lose' });
    const stages: string[] = [];
    const atlas = { ...bench.atlas, travel: (stage: { kind: string; state: string }) => { stages.push(`${stage.kind} ${stage.state}`); } };
    const walker = createRaidGateController({ api: bench.api, atlas, source: bench.source, clock, wait: async () => { now += 1_000; } });
    await until(walker, s => s.phase === 'quiet');
    const preview = await bench.monarchPreview(FERN);
    if (preview.kind !== 'preview') throw new Error('expected a preview');
    await walker.refresh();
    expect(walker.snapshot().canTravel).toBe(false);
    await walker.join();
    await bench.monarchStart(preview.value.requestId);
    await bench.witness(preview.value.requestId);
    await walker.refresh();
    expect(walker.snapshot()).toMatchObject({ phase: 'departed', joined: true, canTravel: true, journey: null });

    // The arrival's answer is lost: the board confirms rather than stepping again, then shows the arrival.
    await walker.travel();
    const arrived = await until(walker, s => s.journey?.state === 'committed');
    expect(arrived.journey).toMatchObject({ kind: 'raid', state: 'committed', from: SOURCE.kingdomId, to: FERN, role: 'visitor', destination: { channel: { kingdomName: 'Fernhollow' } } });
    expect(arrived.canTravel).toBe(false);
    expect(bench.rooms.calls.filter(call => call.startsWith('commit'))).toHaveLength(1);
    // Each stage reaches the map once; confirming the step is still the drawing.
    expect(stages).toEqual(['rise reserved', 'road preparing', 'drawing ready', 'arrived committed']);
    // An arrival abroad stays on the board until the walker chooses to go home.
    walker.dismissJourney();
    expect(walker.snapshot().journey?.state).toBe('committed');

    // A reload finds the arrival again through the authority.
    const reloaded = createRaidGateController({ api: bench.api, atlas: bench.atlas, source: bench.source, clock, wait: async () => { now += 1_000; } });
    expect((await until(reloaded, s => s.journey !== null)).journey).toMatchObject({ state: 'committed', to: FERN, arrivalId: arrived.journey!.arrivalId });
    reloaded.dispose();

    await walker.returnHome();
    const home = await until(walker, s => s.journey?.kind === 'return' && s.journey.state === 'committed');
    expect(home.journey).toMatchObject({ from: FERN, to: SOURCE.kingdomId, destination: { channel: { kingdomName: 'Fernhollow' } } });
    expect(bench.rooms.membership('52000001' as Parameters<typeof bench.rooms.membership>[0])).toEqual({ kingdomId: SOURCE.kingdomId, generation: 2 });
    walker.dismissJourney();
    expect(walker.snapshot().journey).toBeNull();
    walker.dispose();
  });
});
