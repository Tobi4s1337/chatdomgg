import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { extensionKey } from '../public/panel/token';

const MESSAGE = JSON.stringify({ version: 1, type: 'panel.refresh' });
const ID = /^[1-9][0-9]{0,31}$/;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Compare only committed public panel evidence. Neither arbitrary realm state nor private words are retained. */
function fingerprint(value: unknown): string | null {
  const state = record(value);
  if (state.version !== 1 || !['kingdom', 'unfounded'].includes(String(state.status))) return null;
  const event = record(state.publicEvent), gift = record(state.giftMoment), moment = record(state.moment);
  return createHash('sha256').update(JSON.stringify({
    status: state.status, stream: state.stream, lights: state.lights, pledges: state.pledges,
    publicEvent: ['home', 'forge', 'moment'].includes(String(event.type)) ? [event.type, event.cursor, event.at] : null,
    gift: gift.type === 'panel.gift' ? [gift.id, gift.sequence, gift.committedAt] : null,
    moment: [moment.id, moment.occurredAt, record(moment.body).kind],
    settingsRevision: state.settingsRevision,
    picture: record(state.picture).revision,
  })).digest('hex');
}

export interface PanelBroadcastOptions {
  readonly extensionId?: string;
  readonly extensionSecret?: string;
  /** Numeric Twitch identity owning the Extension; independent of the broadcast target channel. */
  readonly ownerId?: string;
  readonly read: (channelId: string) => Promise<unknown>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly pollMs?: number;
  readonly ttlMs?: number;
  readonly maxChannels?: number;
}
interface Channel {
  touchedAt: number; fingerprint: string | null; dirty: boolean; reading: boolean; sending: boolean;
  nextSend: number; failures: number; controller?: AbortController;
}

/** A process-owned invalidation worker. No credentials means no reads, timers, registry or Twitch calls. */
export function createPanelBroadcaster(options: PanelBroadcastOptions) {
  let key: Uint8Array | null = null;
  if (options.extensionId && options.extensionSecret && options.ownerId && ID.test(options.ownerId)) {
    try { key = extensionKey(options.extensionSecret); } catch { /* Incomplete configuration stays closed. */ }
  }
  const channels = new Map<string, Channel>(), now = options.now ?? Date.now, send = options.fetch ?? fetch;
  const ttl = Math.max(1_000, options.ttlMs ?? 90_000), max = Math.max(1, Math.min(1_024, options.maxChannels ?? 256));
  const pollMs = Math.max(50, Math.min(500, options.pollMs ?? 500));
  let disposed = false, started = false, timer: ReturnType<typeof setTimeout> | undefined;
  const current = (channelId: string, channel: Channel) => !disposed && channels.get(channelId) === channel;
  const remove = (channelId: string) => { channels.get(channelId)?.controller?.abort(); channels.delete(channelId); };
  const expire = () => { for (const [id, channel] of channels) if (now() - channel.touchedAt >= ttl) remove(id); };
  const publish = async (channelId: string, channel: Channel) => {
    if (!key || !current(channelId, channel) || !channel.dirty || channel.sending || now() < channel.nextSend || channel.failures >= 3) return;
    channel.sending = true; channel.dirty = false;
    const controller = new AbortController(); channel.controller = controller;
    try {
      // https://dev.twitch.tv/docs/extensions/building/#signing-the-jwt requires the Extension owner as user_id.
      const token = await new SignJWT({ role: 'external', user_id: options.ownerId!, channel_id: channelId, pubsub_perms: { send: ['broadcast'] } })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setExpirationTime(Math.floor(now() / 1_000) + 60).sign(key);
      if (!current(channelId, channel) || controller.signal.aborted) return;
      channel.nextSend = now() + 1_000;
      const response = await send('https://api.twitch.tv/helix/extensions/pubsub', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'client-id': options.extensionId!, 'content-type': 'application/json' },
        body: JSON.stringify({ broadcaster_id: channelId, target: ['broadcast'], message: MESSAGE }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
      });
      if (!response.ok) throw new Error('broadcast unavailable');
      channel.failures = 0;
    } catch {
      if (current(channelId, channel)) { channel.dirty = true; channel.failures++; channel.nextSend = now() + Math.min(4_000, 1_000 * 2 ** (channel.failures - 1)); }
    } finally { channel.sending = false; delete channel.controller; }
  };
  const compare = (channel: Channel, value: unknown) => {
    const next = fingerprint(value);
    if (next === null || next === channel.fingerprint) return;
    if (channel.fingerprint !== null) { channel.dirty = true; channel.failures = 0; }
    channel.fingerprint = next;
  };
  const touch = (channelId: string, state?: unknown) => {
    if (!key || disposed || !ID.test(channelId)) return;
    expire();
    let channel = channels.get(channelId);
    if (!channel) {
      // Keep active channel cooldowns intact under registry pressure. The client poll is the fallback.
      if (channels.size >= max) return;
      channel = { touchedAt: now(), fingerprint: null, dirty: false, reading: false, sending: false, nextSend: -Infinity, failures: 0 };
      channels.set(channelId, channel);
    }
    channel.touchedAt = now();
    if (state !== undefined) { compare(channel, state); void publish(channelId, channel); }
  };
  const tick = async () => {
    if (!key || disposed) return;
    expire();
    await Promise.all([...channels].map(async ([id, channel]) => {
      if (!channel.reading) {
        channel.reading = true;
        const before = channel.fingerprint;
        try { const state = await options.read(id); if (current(id, channel) && before === channel.fingerprint) compare(channel, state); }
        catch { /* The five-second client fallback survives a failed source read. */ }
        finally { channel.reading = false; }
      }
      await publish(id, channel);
    }));
  };
  const dispose = () => { disposed = true; started = false; clearTimeout(timer); for (const id of channels.keys()) remove(id); };
  const start = () => {
    if (!key || disposed || started) return dispose;
    started = true;
    const loop = () => { if (!started || disposed) return; timer = setTimeout(loop, pollMs); timer.unref?.(); void tick(); };
    timer = setTimeout(loop, pollMs); timer.unref?.();
    return dispose;
  };
  return { touch, observe: touch, tick, start, dispose, size: () => channels.size };
}
