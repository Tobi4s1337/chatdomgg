import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import type { GateSnapshot, RaidGateController } from './controller';
import { ANSWER_KEY_ID, keyLabel, MARCH_PIECE_ID, registerGateSlots, type GateSlotContext, type GateSlots } from './play-slot';
import type { mountWalkGate } from './walk-gate';

const HOME = { kingdomId: '129634568' as KingdomId, name: 'Willowmere', login: '' };

type Piece = Parameters<GateSlots['registerHudPiece']>[0];
type Binding = Parameters<NonNullable<GateSlots['registerActionBinding']>>[0];

function slots() {
  const pieces: Piece[] = [], bindings: Binding[] = [];
  const registry: GateSlots = {
    registerHudPiece: piece => { pieces.push(piece); return () => { pieces.splice(pieces.indexOf(piece), 1); }; },
    registerActionBinding: binding => { bindings.push(binding); return () => { bindings.splice(bindings.indexOf(binding), 1); }; },
  };
  return { registry, pieces, bindings };
}

const ctx = (extra: Partial<GateSlotContext> = {}): GateSlotContext => ({ kingdomId: HOME.kingdomId, self: { personId: 'p-1' }, mode: 'walking', ...extra });

function controller(snapshot: Partial<GateSnapshot>): RaidGateController {
  const full = {
    phase: 'gathering', origin: 'live', mapOrigin: null, viewer: 'walker', authority: null, source: HOME, requestId: 'r-1', optedIn: 2, joined: false,
    expiresAt: 0, state: 'prepared', countdownEndsAt: null, raid: null, checking: null, canStart: false, busy: null, farewell: null, asking: null, notice: null,
    canReconnect: false, journey: null, canTravel: false, welcome: null,
    destination: { target: { kingdomId: '41000002' as KingdomId, founded: true, live: true, classification: 'general' }, channel: null, land: 'founded' },
    ...snapshot,
  } as GateSnapshot;
  return { snapshot: () => full, join: vi.fn(async () => undefined), travel: vi.fn(async () => undefined), returnHome: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined) } as unknown as RaidGateController;
}

describe('the gate in play’s HUD', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('registers one HUD piece and one walking key, and takes both away again', () => {
    const { registry, pieces, bindings } = slots();
    const remove = registerGateSlots(registry, vi.fn());
    expect(pieces.map(piece => [piece.id, piece.region])).toEqual([[MARCH_PIECE_ID, 'top-centre']]);
    expect(bindings.map(binding => [binding.id, binding.defaultCode])).toEqual([[ANSWER_KEY_ID, 'KeyG']]);
    remove();
    expect(pieces).toEqual([]);
    expect(bindings).toEqual([]);
  });

  it('is there only for a signed-in walker of a real kingdom, never a watcher or the stream', () => {
    const { registry, pieces } = slots();
    registerGateSlots(registry, vi.fn());
    const piece = pieces[0]!;
    expect(piece.available(ctx())).toBe(true);
    expect(piece.available(ctx({ self: null }))).toBe(false);
    expect(piece.available(ctx({ mode: 'watching' }))).toBe(false);
    expect(piece.available(ctx({ mode: 'stream' }))).toBe(false);
    expect(piece.available(ctx({ kingdomId: 'willowmere' }))).toBe(false);
  });

  it('mounts the walk’s gate with the person’s own key on its button', () => {
    const { registry, pieces } = slots();
    const mount = vi.fn<typeof mountWalkGate>(() => () => undefined);
    registerGateSlots(registry, mount);
    const host = {} as HTMLElement;
    pieces[0]!.mount(host, ctx({ settings: { get: () => ({ [ANSWER_KEY_ID]: 'KeyJ' }) } }));
    const options = mount.mock.calls[0]![0];
    expect(options).toMatchObject({ kingdomId: HOME.kingdomId, host });
    expect(options.keyHint?.()).toBe('J');
  });

  it('answers the gate with the key: join while it gathers, ride out once Twitch confirmed, nothing when quiet', () => {
    vi.stubGlobal('location', { pathname: '/' });
    const { registry, pieces, bindings } = slots();
    let hear: ((controller: RaidGateController | null) => void) | undefined;
    registerGateSlots(registry, vi.fn<typeof mountWalkGate>(options => { hear = options.onController; return () => undefined; }));
    pieces[0]!.mount({} as HTMLElement, ctx());
    const key = bindings[0]!;

    const gathering = controller({});
    hear!(gathering);
    key.onPress(ctx());
    expect(gathering.join).toHaveBeenCalledOnce();

    const joined = controller({ joined: true });
    hear!(joined);
    key.onPress(ctx());
    expect(joined.leave).not.toHaveBeenCalled();

    const departed = controller({ phase: 'departed', state: 'landed', joined: true, canTravel: true });
    hear!(departed);
    key.onPress(ctx());
    expect(departed.travel).toHaveBeenCalledOnce();

    const quiet = controller({ phase: 'quiet', destination: null, requestId: null });
    hear!(quiet);
    key.onPress(ctx());
    expect(quiet.join).not.toHaveBeenCalled();

    hear!(null);
    expect(() => key.onPress(ctx())).not.toThrow();
  });

  it('labels keys as people read them', () => {
    expect(keyLabel('KeyG')).toBe('G');
    expect(keyLabel('Digit4')).toBe('4');
    expect(keyLabel('Space')).toBe('Space');
  });
});
