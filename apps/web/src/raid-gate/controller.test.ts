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
    open = { requestId: 'request-2', revision: 1, to: OAKEN, target: { kingdomId: OAKEN, founded: false, live: true, classification: 'general' }, state: 'prepared', optedIn: 0, expiresAt: 121_000, joined: false };
    pending[1]!.resolve(reply(1, OAKEN));
    await settled();
    pending[0]!.resolve(reply(0, FERN));
    await settled();
    expect(controller.snapshot()).toMatchObject({ phase: 'preview', requestId: 'request-2', destination: { target: { kingdomId: OAKEN } } });
  });
});
