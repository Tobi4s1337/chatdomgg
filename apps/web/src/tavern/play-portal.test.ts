import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, TavernPortalSchema, type TavernPortal } from '@chatdom/shared';
import { TAVERN_INTERIOR_ENTRY, TAVERN_INTERIOR_EXIT } from '../../../../packages/content/src/tavern/portal';
import type { RealmEntry } from '../realm/client';
import type { TavernClient } from './client';
import { TAVERN_TITLE, tavernPortalDescriptor, tavernVisit, watchTavernDoor, type TavernPortalDestination, type TavernPortalVisit } from './portal';

/**
 * The tavern door through play's own transfer (`play/portal.ts`, SEAMS.md §1). Play's state machine is loaded where
 * it is present, so this check runs on the branch where both sides meet and stays silent on a branch with only one.
 * The destination is the tavern's real visit lifecycle; only the drawing and the socket are stood in for.
 */
type Anchor = { readonly feet: readonly [number, number, number]; readonly yaw: number };
interface Curtain {
  close(words: { label: string; title: string }): Promise<void>;
  open(note?: string): Promise<void>;
  stranded(retry: () => void): void;
  readonly stage: HTMLElement;
  dispose(): void;
}
interface Transfer {
  readonly phase: string;
  enter(portal: ReturnType<typeof tavernPortalDescriptor>): Promise<string>;
  leave(): Promise<string>;
  onPhase(listener: (phase: string) => void): () => void;
  available(portal: ReturnType<typeof tavernPortalDescriptor>): boolean;
  bindSource(source: {
    kingdomId: string; entry: RealmEntry; endpoint: string; self: null; title: string;
    leave(): Promise<void>; rejoin(arrival: { portal: string; anchor: Anchor }): Promise<void>;
  }): () => void;
  registerDestination(destination: TavernPortalDestination): () => void;
  dispose(): void;
}
type PlayPortal = { createPortalTransfer(options: { curtain: () => Curtain; readyMs?: number; stepMs?: number }): Transfer };

const play = import.meta.glob<PlayPortal>('../play/portal.ts')['../play/portal.ts'];

const kingdomId = KingdomIdSchema.parse('900000004');
const portal: TavernPortal = TavernPortalSchema.parse({ version: 1, id: `tavern:${kingdomId}:door`, kingdomId, sourceRoom: 'kingdom', destinationRoom: 'tavern',
  source: { placement: 'civic:growth:v1:tavern', collisionRevision: 3 },
  door: { min: [-4.5, .875, -3.05], max: [-3.5, 2.375, -2.25], through: [0, 1] },
  returnAnchor: { feet: [-4, 1.375, -3.625], yaw: 128 }, entry: TAVERN_INTERIOR_ENTRY, exit: TAVERN_INTERIOR_EXIT });
const entry = { kingdomId, resumeScope: 'tavern-door-check-0123456789', ticket: async () => { throw new Error('No realm in this check.'); } } as unknown as RealmEntry;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** One page: a kingdom room, the tavern room behind the door, and a log of who holds the walker when. */
function page(script: { connect?: 'ok' | 'refuse'; tavernLeaves?: ('ok' | 'reject')[] } = {}) {
  const log: string[] = [];
  let rooms = 1, strandedRetry: (() => void) | undefined, opened = 0;
  const hold = (what: string) => { rooms++; log.push(what); if (rooms > 1) throw new Error(`Two rooms hold the walker at ${what}`); };
  const curtain = (): Curtain => ({ stage: {} as HTMLElement, async close() {}, async open() {}, dispose() {},
    stranded(retry) { log.push('curtain:stranded'); strandedRetry = retry; } });
  const leaves = [...(script.tavernLeaves ?? ['ok'])];
  let exit: (() => void) | undefined, lose: ((reason: string) => void) | undefined;
  const destination: TavernPortalDestination = { room: 'tavern', title: TAVERN_TITLE,
    mount(_host, visit: TavernPortalVisit) {
      // What `TavernRoomSurface` does with the hooks: open the room, report placement, report a terminal end.
      return tavernVisit(visit, async () => {
        if (script.connect === 'refuse') throw new Error('The tavern refused the ticket.');
        hold('tavern:join'); opened++;
        const client = { dispose() {}, async leave() {
          if (leaves.shift() === 'reject') { log.push('tavern:leave-refused'); throw new Error('still held'); }
          if (opened) { opened--; rooms--; log.push('tavern:left'); }
        } };
        return client as unknown as TavernClient;
      }, hooks => {
        exit = hooks.leave; lose = hooks.onTerminal;
        hooks.open().then(() => hooks.onReady(), (error: Error) => hooks.onTerminal(error.message));
        return () => { log.push('tavern:undrawn'); };
      });
    } };
  return { log, destination, curtain, exit: () => exit?.(), lose: (reason: string) => lose?.(reason), retry: () => strandedRetry?.(),
    source: (anchors: Anchor[]) => ({ kingdomId, entry, endpoint: 'ws://127.0.0.10:0', self: null, title: 'Tobi4s_',
      async leave() { rooms--; log.push('kingdom:left'); },
      async rejoin(arrival: { portal: string; anchor: Anchor }) { hold('kingdom:join'); anchors.push(arrival.anchor); } }) };
}

describe.skipIf(!play)('the tavern door through play’s transfer', () => {
  async function transferFor(p: ReturnType<typeof page>, anchors: Anchor[]) {
    const { createPortalTransfer } = await play!();
    const transfer = createPortalTransfer({ curtain: p.curtain, readyMs: 2_000, stepMs: 2_000 });
    transfer.bindSource(p.source(anchors));
    transfer.registerDestination(p.destination);
    return transfer;
  }
  const descriptor = tavernPortalDescriptor(portal);

  it('crosses in through the door, walks out through the interior doorway and stands outside facing out', async () => {
    const p = page(), anchors: Anchor[] = [], transfer = await transferFor(p, anchors);
    expect(transfer.available(descriptor)).toBe(true);
    let entering: Promise<string> | undefined;
    const watch = watchTavernDoor(portal, () => { entering = transfer.enter(descriptor); });
    for (const z of [-3.625, -3.3, -2.9, -2.6]) watch([-4, 1.375, z]);
    expect(await entering).toBe('arrived');
    expect(transfer.phase).toBe('inside');
    p.exit();
    await settle(); await settle();
    await waitFor(() => transfer.phase === 'idle');
    expect(p.log).toEqual(['kingdom:left', 'tavern:join', 'tavern:undrawn', 'tavern:left', 'kingdom:join']);
    expect(anchors).toEqual([descriptor.returnAnchor]);
    // Outside the exterior door, facing out: against the door's inward crossing.
    const [ax, az] = [Math.sin(anchors[0]!.yaw), Math.cos(anchors[0]!.yaw)];
    expect(ax * portal.door.through[0] + az * portal.door.through[1]).toBeCloseTo(-1);
    transfer.dispose();
  });

  it('puts you back outside when the tavern never opens, holding no tavern connection', async () => {
    const p = page({ connect: 'refuse' }), anchors: Anchor[] = [], transfer = await transferFor(p, anchors);
    expect(await transfer.enter(descriptor)).toBe('back-outside');
    expect(p.log).toEqual(['kingdom:left', 'tavern:undrawn', 'kingdom:join']);
    expect(anchors).toEqual([descriptor.returnAnchor]);
    transfer.dispose();
  });

  it('takes you back outside when the room ends for good after you arrived', async () => {
    const p = page(), anchors: Anchor[] = [], transfer = await transferFor(p, anchors);
    expect(await transfer.enter(descriptor)).toBe('arrived');
    p.lose('Your connection ended. Your chair could not be restored.');
    await waitFor(() => transfer.phase === 'idle');
    expect(p.log).toEqual(['kingdom:left', 'tavern:join', 'tavern:undrawn', 'tavern:left', 'kingdom:join']);
    expect(anchors).toEqual([descriptor.returnAnchor]);
    transfer.dispose();
  });

  it('never rejoins the kingdom while the tavern may still hold you, and goes on after the retry', async () => {
    const p = page({ tavernLeaves: ['reject', 'ok'] }), anchors: Anchor[] = [], transfer = await transferFor(p, anchors);
    expect(await transfer.enter(descriptor)).toBe('arrived');
    const out = transfer.leave();
    await waitFor(() => transfer.phase === 'stranded');
    expect(p.log.at(-1)).toBe('curtain:stranded');
    expect(anchors).toEqual([]);
    p.retry();
    expect(await out).toBe('back-outside');
    expect(p.log).toEqual(['kingdom:left', 'tavern:join', 'tavern:undrawn', 'tavern:leave-refused', 'curtain:stranded', 'tavern:left', 'kingdom:join']);
    transfer.dispose();
  });

  it('ignores the interior doorway once the visit has ended', async () => {
    const p = page(), anchors: Anchor[] = [], transfer = await transferFor(p, anchors);
    expect(await transfer.enter(descriptor)).toBe('arrived');
    p.exit();
    await waitFor(() => transfer.phase === 'idle');
    p.exit(); p.lose('late');
    await settle();
    expect(transfer.phase).toBe('idle');
    expect(anchors).toHaveLength(1);
    transfer.dispose();
  });
});

async function waitFor(predicate: () => boolean, timeout = 3_000) {
  const until = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > until) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
}
