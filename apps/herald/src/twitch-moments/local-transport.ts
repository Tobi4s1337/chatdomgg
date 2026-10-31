import type { SubscriptionPlan } from './plan';
import type { AuthorizedSubscriptionTransport, TransportLoss } from './ports';

/**
 * A local provider transport for tests and the SIMULATED bench. It carries synthetic EventSub frames into the
 * exact same ingest path a real conduit binding uses; it has no network, grants or secrets. Its origin is fixed
 * to `simulated` by the ingest that binds it.
 */
export function createLocalProviderTransport() {
  let active: { plan: SubscriptionPlan; receive: (n: unknown) => void; unavailable: (loss: TransportLoss) => void; signal: AbortSignal } | null = null;
  let delivered = 0;
  const transport: AuthorizedSubscriptionTransport = {
    subscribe(plan, receive, unavailable, signal) {
      active = { plan, receive, unavailable, signal };
      signal.addEventListener('abort', () => { if (active?.signal === signal) active = null; }, { once: true });
    },
  };
  return {
    transport,
    get plan(): SubscriptionPlan { return active?.plan ?? []; },
    /**
     * Deliver one frame. Like Twitch, only planned type/versions are delivered; `misrouted` skips that check to
     * model a forged or misrouted delivery reaching the consumer anyway.
     */
    deliver(frame: string, options: { misrouted?: boolean } = {}): boolean {
      if (!active || active.signal.aborted) return false;
      const { type, version } = (JSON.parse(frame) as { payload: { subscription: { type: string; version: string } } }).payload.subscription;
      if (!options.misrouted && !active.plan.some(e => e.type === type && e.version === version)) return false;
      delivered++;
      active.receive(frame);
      return true;
    },
    lose(kind: TransportLoss['kind'], capability: string | null = null) { active?.unavailable({ kind, capability }); },
    get delivered() { return delivered; },
  };
}

export interface SyntheticFrame {
  readonly messageId: string;
  readonly at: number;
  readonly type: string;
  readonly version: string;
  readonly condition: Readonly<Record<string, string>>;
  readonly event: unknown;
}

/** An EventSub WebSocket notification frame in Twitch's documented wire shape. */
export function eventSubFrame({ messageId, at, type, version, condition, event }: SyntheticFrame): string {
  const timestamp = new Date(at).toISOString().replace('Z', '123456Z');
  return JSON.stringify({
    metadata: { message_id: messageId, message_type: 'notification', message_timestamp: timestamp, subscription_type: type, subscription_version: version },
    payload: { subscription: { id: `sub-${type}`, type, version, status: 'enabled', cost: 0, condition, transport: { method: 'websocket', session_id: 'local' },
      created_at: timestamp }, event },
  });
}
