/**
 * Dev journeys only: the real kingdom entry (`KingdomEntry` with the live entry source) opened on a founded kingdom
 * in the lane's own realm, so a browser walker can cross the tavern's street door through play's transfer and come
 * back out. `games/door-journey.mjs` builds this in place of main.tsx into a scratch folder and serves it beside the
 * session routes the entry asks for; it is never a route and never in the product build.
 *
 * `window.__gatherDoor` reports what the page saw: play's portal phases in order and the first error.
 */
import { render } from 'solid-js/web';
import { createComponent } from 'solid-js';
import '../../style.css';
import KingdomEntry from '../../kingdom-entry';
import { createLiveKingdomEntrySource } from '../../kingdom-entry/live';
import type { KingdomId } from '@chatdom/shared';

interface DoorInfo { readonly kingdomId: KingdomId; readonly kingdomName: string; readonly endpoint: string; readonly notice: string }
interface DoorReport { phases: string[]; error: string | null }
type PhaseSource = { onPortalPhase?(listener: (phase: string) => void): () => void; portalPhase?(): string };

const page = window as Window & { __gatherDoor?: DoorReport };
const report: DoorReport = page.__gatherDoor = { phases: [], error: null };
addEventListener('error', event => { report.error ??= String(event.message); });
addEventListener('unhandledrejection', event => { report.error ??= String(event.reason?.message ?? event.reason); });

// Play's door keeper, where it is part of the build; without it this page simply has no door.
const portals = import.meta.glob<PhaseSource>('../../play/portals.ts', { eager: true })['../../play/portals.ts'];
if (portals?.onPortalPhase && portals.portalPhase) {
  report.phases.push(portals.portalPhase());
  portals.onPortalPhase(phase => { report.phases.push(phase); });
}

const info = await fetch('/__door/info', { cache: 'no-store' }).then(response => response.json() as Promise<DoorInfo>);
const open = createLiveKingdomEntrySource({ kingdomId: info.kingdomId, kingdomName: info.kingdomName, origin: 'simulated',
  notice: info.notice, endpoint: info.endpoint, storage: sessionStorage });
render(() => createComponent(KingdomEntry, { open }), document.getElementById('root')!);
