import { LOOK_TOKEN, type KingdomId } from '@chatdom/shared';
import type { CitizenLook } from '../../../../packages/content/src/avatar-style';
import { sharedCitizenLooks, type CitizenLookLibrary } from '../citizens/look-library';
import {
  registerArrivalStep, registerLedgerPage, registerWalkFeature, registerWorldPrompt,
  type ArrivalStepProvider, type CursorLease, type InputLease, type LedgerPageProvider, type PlayContext, type WalkFeatureProvider,
} from '../play/slots';
import type { BuilderSounds } from './AvatarBuilder';
import { createLookClient, type LookClient } from './look-client';
import { deviceStore, mirrorPutOff, type DeviceStore } from './memory';
import type { LookUiDeps } from './play-ui';
import { createWardrobe } from './wardrobe';

/*
 * The wardrobe's places in play (work/lanes/play/SEAMS.md, sections B and C):
 * - the ledger page "Your look" (`look`), shown to a signed-in walker, with your portrait and what you wear, and the
 *   way into the full builder;
 * - the mirror (`mirror`), an arrival step on a first walk with no saved look, until it is put off on this device;
 * - `openLookBuilder`, the one way into the builder over the street, for the ledger, the mirror and a wardrobe at home.
 * The builder holds the cursor and the walk while it is open; Escape closes it before anything else.
 */

/** The ledger's own pages sit at 10 (Settings), 20 (Way home), 30 (Build) and 90 (Help): your look comes after the way home. */
export const LOOK_PAGE_ORDER = 25;

export interface LookSlotDeps {
  client(): LookClient;
  memory(): DeviceStore | null;
  library(): Pick<CitizenLookLibrary, 'remember'>;
  /** The drawing half, loaded when the wardrobe first opens. */
  ui(): Promise<typeof import('./play-ui')>;
}

export interface OpenLookBuilderOptions {
  readonly ctx: PlayContext;
  readonly from: 'ledger' | 'mirror' | 'wardrobe';
  readonly kingdomId: KingdomId;
  /** Runs once the builder has closed (or failed to open). */
  readonly onClosed?: () => void;
}

export interface LookSlots {
  readonly page: LedgerPageProvider;
  readonly mirror: ArrivalStepProvider;
  /** Lends the kingdom's sound to the wardrobe while a walk lives. */
  readonly sound: WalkFeatureProvider;
  /** The wardrobe at home: its walk feature and its world prompt. */
  readonly wardrobe: ReturnType<typeof createWardrobe>;
  openLookBuilder(options: OpenLookBuilderOptions): void;
}

const signedIn = (ctx: PlayContext) => ctx.mode === 'walking' && !!ctx.self;

export function createLookSlots(deps: LookSlotDeps): LookSlots {
  let audio: (() => { cue(kind: 'wood' | 'light', options?: { ui?: 'wood' | 'brass' | 'parchment' }): boolean } | null) | null = null;
  const sounds: BuilderSounds = { cue: (kind, options) => audio?.()?.cue(kind, options) ?? false };
  const listeners = new Set<(look: CitizenLook, token: string | undefined) => void>();
  let client: LookClient | null = null;
  const uiDeps = (): LookUiDeps => ({
    client: client ??= deps.client(),
    memory: deps.memory(),
    sounds,
    saved(token, look) {
      // Your own walker draws the new look at once; the realm tells everyone else through the room.
      if (token) deps.library().remember(token, look);
      for (const listener of [...listeners]) { try { listener(look, token); } catch (error) { console.error('A saved look could not be shown', error); } }
    },
    onSaved(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  });

  let opening = false;
  function openLookBuilder(options: OpenLookBuilderOptions): void {
    if (opening) return;
    const { ctx } = options;
    // Hand over first: the builder takes the cursor and holds the walk before the ledger lets go of them.
    const cursor: CursorLease = ctx.requestCursor('look');
    const input: InputLease = ctx.requestInput('look');
    let released = false;
    const release = () => {
      if (released) return;
      released = true; input.release(); cursor.release(); opening = false;
      try { options.onClosed?.(); } catch (error) { console.error('The wardrobe could not finish closing', error); }
    };
    if (options.from === 'ledger') ctx.closeLedger();
    opening = true;
    deps.ui().then(ui => {
      if (released) return;
      ui.openBuilderOverlay({ deps: uiDeps(), kingdomId: options.kingdomId, name: ctx.self?.publicName, onClosed: release,
        closeLabel: options.from === 'wardrobe' ? 'Back to your home' : 'Back to the street' });
    }, error => { console.error('The wardrobe could not be opened', error); release(); });
  }

  const page: LedgerPageProvider = {
    id: 'look', title: 'Your look', order: LOOK_PAGE_ORDER,
    available: signedIn,
    mount(host, ctx) {
      let dispose: (() => void) | null = null, gone = false;
      deps.ui().then(ui => {
        if (gone) return;
        dispose = ui.mountLedgerPage(host, {
          deps: uiDeps(), kingdomId: ctx.kingdomId, name: ctx.self?.publicName ?? '',
          open: () => openLookBuilder({ ctx, from: 'ledger', kingdomId: ctx.kingdomId }),
        });
      }, error => console.error('The look page could not be drawn', error));
      return () => { gone = true; dispose?.(); };
    },
  };

  const mirror: ArrivalStepProvider = {
    id: 'mirror', order: 10,
    wanted: ctx => signedIn(ctx) && !LOOK_TOKEN.test(ctx.self!.lookToken) && !mirrorPutOff(deps.memory()),
    async run(host, ctx) {
      const ui = uiDeps();
      let mine;
      // Nothing is asked of someone whose look the realm already holds, or when the realm cannot say.
      try { mine = await ui.client.mine(ctx.kingdomId); } catch { return; }
      if (mine.status === 'saved') { deps.library().remember(mine.token, mine.look); return; }
      if (mine.status !== 'none') return;
      const drawn = await deps.ui();
      await drawn.runMirror(host, { deps: ui, kingdomId: ctx.kingdomId, name: ctx.self?.publicName ?? '', look: mine.look });
    },
  };

  const sound: WalkFeatureProvider = {
    id: 'look-wardrobe-sound',
    mount(ctx) {
      const source = () => ctx.audio();
      audio = source;
      return () => { if (audio === source) audio = null; };
    },
  };

  // The wardrobe in your own home: the press against its wall, the prompt, and the mirror's turn of the camera.
  const wardrobe = createWardrobe({ open: (ctx, onClosed) => {
    if (opening) { onClosed(); return; }
    openLookBuilder({ ctx, from: 'wardrobe', kingdomId: ctx.kingdomId, onClosed });
  } });

  return { page, mirror, sound, wardrobe, openLookBuilder };
}

const slots = createLookSlots({
  client: () => createLookClient(),
  memory: deviceStore,
  library: sharedCitizenLooks,
  ui: () => import('./play-ui'),
});
registerLedgerPage(slots.page);
registerArrivalStep(slots.mirror);
registerWalkFeature(slots.sound);
registerWalkFeature(slots.wardrobe.feature);
registerWorldPrompt(slots.wardrobe.prompt);

/** Open the full builder over the street (the ledger's page, the mirror, a wardrobe at home). One at a time. */
export const openLookBuilder = (options: OpenLookBuilderOptions): void => slots.openLookBuilder(options);
