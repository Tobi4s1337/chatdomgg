/**
 * Minimal typed client for the Helix endpoints that authenticate with an EBS-signed JWT.
 * (Endpoints that need an APP access token instead — Get Extension Live Channels, Get Extension
 * Transactions, Get/Update Extension Bits Products, Get Released Extensions — are not here; see the
 * twitch-api skill for app-token handling.)
 *
 * Every call: `Authorization: Bearer <EBS JWT>` + `Client-Id: <extension client id>`.
 * Sign a FRESH short-lived JWT per call — the claims (channel_id, pubsub_perms) differ per call.
 */
import { signEbsJwt } from './jwt.ts';

export interface ExtApiConfig {
  /** Extension client ID (= extension ID). */
  clientId: string;
  /** Twitch user ID of the extension owner. */
  ownerId: string;
  /** Decoded signing secret (first entry of loadExtensionSecrets()). */
  secret: Uint8Array;
  /** Override for tests/mocks. Default https://api.twitch.tv/helix */
  apiBase?: string;
}

export type ConfigSegmentType = 'broadcaster' | 'developer' | 'global';

export interface ConfigSegment {
  segment: ConfigSegmentType;
  broadcaster_id?: string;
  content: string;
  version: string;
}

export class TwitchExtApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, what: string) {
    super(`${what} failed: HTTP ${status} ${body}`);
    this.name = 'TwitchExtApiError';
    this.status = status;
    this.body = body;
  }
}

async function call(
  cfg: ExtApiConfig,
  jwt: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  query: Record<string, string | string[] | undefined>,
  body: unknown,
  what: string,
): Promise<Response> {
  const url = new URL((cfg.apiBase ?? 'https://api.twitch.tv/helix') + path);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Client-Id': cfg.clientId,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new TwitchExtApiError(res.status, await res.text(), what);
  return res;
}

// ───────────────────────── Extension PubSub ─────────────────────────
// Limits: message <= 5 KB; 100 req/min per (client id, broadcaster id) per the API reference —
// the Building guide says "1 message per second per channel". Design for ~1/s/channel (coalesce!).

/** POST /extensions/pubsub to one channel. targets: ["broadcast"] or ["whisper-<opaqueOrUserId>", ...]. */
export async function sendPubSubToChannel(
  cfg: ExtApiConfig,
  broadcasterId: string,
  message: string | object,
  targets: string[] = ['broadcast'],
): Promise<void> {
  const jwt = await signEbsJwt(cfg.secret, {
    ownerId: cfg.ownerId,
    channelId: broadcasterId,
    pubsubSend: targets,
  });
  await call(cfg, jwt, 'POST', '/extensions/pubsub', {}, {
    target: targets,
    broadcaster_id: broadcasterId,
    message: typeof message === 'string' ? message : JSON.stringify(message),
  }, 'Send Extension PubSub Message');
}

/** POST /extensions/pubsub to every channel where the extension is active (listen("global") in frontend). */
export async function sendPubSubGlobal(cfg: ExtApiConfig, message: string | object): Promise<void> {
  const jwt = await signEbsJwt(cfg.secret, { ownerId: cfg.ownerId, channelId: 'all', pubsubSend: ['global'] });
  await call(cfg, jwt, 'POST', '/extensions/pubsub', {}, {
    target: ['global'],
    is_global_broadcast: true,
    message: typeof message === 'string' ? message : JSON.stringify(message),
  }, 'Send Extension PubSub Message (global)');
}

// ───────────────────────── Configuration service ─────────────────────────
// Rate limits: 20 GETs per segment per minute; 20 PUTs per minute. Segment max 5 KB.

export async function getConfigurationSegments(
  cfg: ExtApiConfig,
  segments: ConfigSegmentType[],
  broadcasterId?: string,
): Promise<ConfigSegment[]> {
  const jwt = await signEbsJwt(cfg.secret, { ownerId: cfg.ownerId });
  const res = await call(cfg, jwt, 'GET', '/extensions/configurations', {
    extension_id: cfg.clientId,
    segment: segments,
    // must be omitted for global-only requests, required for broadcaster/developer
    broadcaster_id: segments.some((s) => s !== 'global') ? broadcasterId : undefined,
  }, undefined, 'Get Extension Configuration Segment');
  const json = (await res.json()) as { data: ConfigSegment[] };
  return json.data;
}

/** PUT /extensions/configurations. NOTE: extensions already open on a channel do NOT receive the update — push a PubSub message too. */
export async function setConfigurationSegment(
  cfg: ExtApiConfig,
  segment: ConfigSegmentType,
  content: string,
  opts: { broadcasterId?: string; version?: string } = {},
): Promise<void> {
  if (segment !== 'global' && !opts.broadcasterId) throw new Error(`${segment} segment needs broadcasterId`);
  if (Buffer.byteLength(content, 'utf8') > 5 * 1024) throw new Error('Configuration segment exceeds 5 KB');
  const jwt = await signEbsJwt(cfg.secret, { ownerId: cfg.ownerId });
  await call(cfg, jwt, 'PUT', '/extensions/configurations', {}, {
    extension_id: cfg.clientId,
    segment,
    broadcaster_id: segment === 'global' ? undefined : opts.broadcasterId,
    content,
    version: opts.version,
  }, 'Set Extension Configuration Segment');
}

/** PUT /extensions/required_configuration — unblocks activation when "Custom/My Own Service" + Required Configurations is used. */
export async function setRequiredConfiguration(
  cfg: ExtApiConfig,
  broadcasterId: string,
  extensionVersion: string,
  requiredConfiguration: string,
): Promise<void> {
  const jwt = await signEbsJwt(cfg.secret, { ownerId: cfg.ownerId });
  await call(cfg, jwt, 'PUT', '/extensions/required_configuration', { broadcaster_id: broadcasterId }, {
    extension_id: cfg.clientId,
    extension_version: extensionVersion,
    required_configuration: requiredConfiguration,
  }, 'Set Extension Required Configuration');
}

// ───────────────────────── Chat ─────────────────────────

/**
 * POST /extensions/chat — posts as the extension's NAME. Needs "Chat Capabilities" enabled, the JWT
 * `channel_id` must equal broadcaster_id, max 280 chars, 12 messages/min/channel.
 */
export async function sendExtensionChatMessage(
  cfg: ExtApiConfig,
  broadcasterId: string,
  extensionVersion: string,
  text: string,
): Promise<void> {
  if (text.length > 280) throw new Error('Extension chat message exceeds 280 characters');
  const jwt = await signEbsJwt(cfg.secret, { ownerId: cfg.ownerId, channelId: broadcasterId });
  await call(cfg, jwt, 'POST', '/extensions/chat', { broadcaster_id: broadcasterId }, {
    text,
    extension_id: cfg.clientId,
    extension_version: extensionVersion,
  }, 'Send Extension Chat Message');
}

// ───────────────────────── Secrets ─────────────────────────

export interface ExtensionSecretsResponse {
  data: Array<{ format_version: number; secrets: Array<{ content: string; active_at: string; expires_at: string }> }>;
}

export async function getExtensionSecrets(cfg: ExtApiConfig): Promise<ExtensionSecretsResponse> {
  const jwt = await signEbsJwt(cfg.secret, { ownerId: cfg.ownerId });
  const res = await call(cfg, jwt, 'GET', '/extensions/jwt/secrets', { extension_id: cfg.clientId }, undefined, 'Get Extension Secrets');
  return (await res.json()) as ExtensionSecretsResponse;
}

/**
 * POST /extensions/jwt/secrets — creates a new secret; current secrets expire (old one ~1 h later per
 * the Building guide). delaySec >= 300 before the new one becomes active. Store BOTH until the old expires.
 */
export async function createExtensionSecret(cfg: ExtApiConfig, delaySec = 300): Promise<ExtensionSecretsResponse> {
  const jwt = await signEbsJwt(cfg.secret, { ownerId: cfg.ownerId });
  const res = await call(cfg, jwt, 'POST', '/extensions/jwt/secrets', {
    extension_id: cfg.clientId,
    delay: String(Math.max(300, delaySec)),
  }, undefined, 'Create Extension Secret');
  return (await res.json()) as ExtensionSecretsResponse;
}

// ───────────────────────── Get Extensions ─────────────────────────

/** GET /extensions — metadata of a version (must pass version if nothing is released yet). */
export async function getExtension(cfg: ExtApiConfig, extensionVersion?: string): Promise<unknown> {
  const jwt = await signEbsJwt(cfg.secret, { ownerId: cfg.ownerId });
  const res = await call(cfg, jwt, 'GET', '/extensions', {
    extension_id: cfg.clientId,
    extension_version: extensionVersion,
  }, undefined, 'Get Extensions');
  return ((await res.json()) as { data: unknown[] }).data[0] ?? null;
}
