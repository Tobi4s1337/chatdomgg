// The real panel. Today no kingdom service answers the panel: there is no verified
// viewer session, no picture feed and no presence endpoint. So this adapter shows
// exactly that, and never borrows the fixture. It never marks a window lit, never
// sends a world command and never treats a Twitch ID as a Chatdom person.
import type { HelperBridge, HelperStatus } from '../helper';
import type { Connection, Light, PanelAdapter, PanelSnapshot } from '../model';

/** After this long without the Helper's answer, the panel says so instead of waiting silently. */
export const HELPER_PATIENCE_MS = 12_000;

export const UNLIT_FROM_PANEL = 'Your window cannot be lit from the panel yet. Chat still counts.';

function connectionFor(status: HelperStatus, patient: boolean): Connection {
  if (status.kind === 'absent') return { kind: 'outside-twitch' };
  if (status.kind === 'waiting') return patient ? { kind: 'knocking' } : { kind: 'no-answer' };
  return { kind: 'kingdom-unavailable' };
}

function lightFor(status: HelperStatus): Light {
  if (status.kind === 'absent') return { kind: 'outside-twitch' };
  if (status.kind === 'authorized' && !status.loggedIn) return { kind: 'logged-out' };
  // Logged in, shared or not: only the kingdom could confirm a light, and it cannot be reached.
  return { kind: 'unavailable', reason: UNLIT_FROM_PANEL };
}

function snapshotFor(status: HelperStatus, patient: boolean): PanelSnapshot {
  return {
    source: { kind: 'production', label: null },
    connection: connectionFor(status, patient),
    kingdom: null,
    stream: 'unknown',
    picture: { kind: 'unavailable', reason: 'The kingdom’s picture is not reaching the panel yet.' },
    light: lightFor(status),
    tonight: { kind: 'unavailable', reason: 'Tonight’s moments are not reaching the panel yet.' },
    home: { kind: 'unknown', reason: 'Your home card is not reaching the panel yet.' },
    tavern: { kind: 'unavailable', reason: 'The tavern is not reaching the panel yet.' },
  };
}

export function createProductionAdapter(helper: HelperBridge): PanelAdapter {
  const listeners = new Set<(snapshot: PanelSnapshot) => void>();
  let patient = true;
  let snapshot = snapshotFor(helper.status(), patient);
  const refresh = () => { snapshot = snapshotFor(helper.status(), patient); for (const listener of listeners) listener(snapshot); };
  const unsubscribe = helper.subscribe(refresh);
  const timer = helper.status().kind === 'waiting' ? setTimeout(() => { patient = false; refresh(); }, HELPER_PATIENCE_MS) : undefined;
  return {
    get: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // No kingdom service exists to receive this. Nothing is sent and nothing changes.
    requestLight() {},
    dispose() { clearTimeout(timer); unsubscribe(); listeners.clear(); },
  };
}
