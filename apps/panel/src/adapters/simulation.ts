// The simulated night's own wire between views of one origin. The streamer's live
// dashboard can Hide the panel moments of a SIMULATED night, and every SIMULATED panel
// open beside it (another tab, the dashboard's own preview) hears it. Only the fixture
// listens: the real panel never opens this channel, so no simulated Hide reaches it.

export const SIMULATION_CHANNEL = 'chatdom-panel-simulation';

export type SimulationMessage =
  /** The streamer hid (or showed again) every panel-driven moment of the simulated night. */
  | { readonly kind: 'hide'; readonly hidden: boolean }
  /** A simulated panel just opened and asks whether the moments are hidden. */
  | { readonly kind: 'ask' };

export interface SimulationWire {
  post(message: SimulationMessage): void;
  close(): void;
}

function isMessage(value: unknown): value is SimulationMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as { kind?: unknown; hidden?: unknown };
  return message.kind === 'ask' || (message.kind === 'hide' && typeof message.hidden === 'boolean');
}

/** Null where the browser has no BroadcastChannel: the simulation then stays within one view. */
export function openSimulationWire(onMessage: (message: SimulationMessage) => void): SimulationWire | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(SIMULATION_CHANNEL);
  channel.onmessage = event => { if (isMessage(event.data)) onMessage(event.data); };
  // Node's channel would otherwise hold a test process open; browsers have no unref.
  (channel as BroadcastChannel & { unref?: () => void }).unref?.();
  return { post: message => channel.postMessage(message), close: () => channel.close() };
}
