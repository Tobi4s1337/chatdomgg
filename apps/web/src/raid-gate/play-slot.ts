/**
 * The Raid Gate's pieces in play's HUD (work/lanes/play/SEAMS.md section B; raid-show SEAMS §4). play's
 * `providers.ts` imports this module once (`import '../raid-gate/play-slot';`) and it registers:
 * - the HUD piece `raid-gate.march`: the march call for a signed-in walker, with the journey layer over the world;
 * - the key `raid-gate.answer` (G by default): answers the gate while the mouse is captured: join, ride out, go home.
 *
 * play's slot registry is found through `import.meta.glob`, so this checkout builds whether or not play's slots are
 * in it; without them nothing registers and nothing is drawn.
 */
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import type { RaidGateController } from './controller';
import { marchCallShows, marchPrimary, pressMarch } from './march-call';
import { mountWalkGate } from './walk-gate';

/** The parts of play's slot context this piece reads. */
export type GateSlotContext = Readonly<{
  kingdomId: string;
  self: Readonly<{ personId: string }> | null;
  mode: 'walking' | 'watching' | 'stream';
  settings?: Readonly<{ get(key: 'actionKeys'): Readonly<Record<string, string>> }>;
}>;

/** The parts of play's slot registry this module uses. */
export type GateSlots = Readonly<{
  registerHudPiece(provider: Readonly<{
    id: string; region: 'top-centre'; order: number;
    available(ctx: GateSlotContext): boolean;
    mount(host: HTMLElement, ctx: GateSlotContext): () => void;
  }>): () => void;
  registerActionBinding?(binding: Readonly<{ id: string; label: string; defaultCode: string; onPress(ctx: GateSlotContext): void }>): () => void;
}>;

export const MARCH_PIECE_ID = 'raid-gate.march';
export const ANSWER_KEY_ID = 'raid-gate.answer';
export const ANSWER_KEY_DEFAULT = 'KeyG';

/** `KeyG` → `G`, `Digit4` → `4`; anything else as it is. */
export function keyLabel(code: string): string {
  return code.replace(/^Key(?=[A-Z]$)/u, '').replace(/^Digit(?=[0-9]$)/u, '');
}

/** Registers the march call and its key with play's slots. Returns the unregistration. */
export function registerGateSlots(slots: GateSlots, mount: typeof mountWalkGate = mountWalkGate): () => void {
  /** The walk's current gate controller, for the key; one walk at a time. */
  let current: RaidGateController | null = null;
  const removals: (() => void)[] = [];
  removals.push(slots.registerHudPiece({
    id: MARCH_PIECE_ID, region: 'top-centre', order: 30,
    // Only a signed-in walker is ever called; a watcher, a guest page or the stream view sees nothing.
    available: ctx => ctx.mode === 'walking' && ctx.self !== null && /^[1-9][0-9]{0,31}$/u.test(ctx.kingdomId),
    mount(host, ctx) {
      const keyHint = () => keyLabel(ctx.settings?.get('actionKeys')[ANSWER_KEY_ID] ?? ANSWER_KEY_DEFAULT);
      return mount({ kingdomId: ctx.kingdomId as KingdomId, host, keyHint, onController: controller => { current = controller; } });
    },
  }));
  if (slots.registerActionBinding) {
    removals.push(slots.registerActionBinding({
      id: ANSWER_KEY_ID, label: 'Answer the Raid Gate', defaultCode: ANSWER_KEY_DEFAULT,
      onPress() {
        if (!current) return;
        const snapshot = current.snapshot();
        // The key answers only what the piece is showing; a quiet gate ignores it.
        if (!marchCallShows(snapshot, globalThis.location?.pathname ?? '/')) return;
        const action = marchPrimary(snapshot);
        if (action) pressMarch(current, action);
      },
    }));
  }
  return () => { for (const remove of removals.splice(0)) remove(); current = null; };
}

const found = import.meta.glob<GateSlots>('../play/slots.ts', { eager: true });
const slots = found['../play/slots.ts'];
if (slots && typeof slots.registerHudPiece === 'function') registerGateSlots(slots);
