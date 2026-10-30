/**
 * Twitch Extension JWT helpers for an Extension Backend Service (EBS).
 *
 *  - verifyExtensionJwt(): verify the token the frontend got from Twitch.ext.onAuthorized (auth.token)
 *  - verifyBitsReceipt():  verify the `transactionReceipt` JWT from Twitch.ext.bits.onTransactionComplete
 *  - signEbsJwt():         sign the role:"external" JWT your EBS needs for Helix /extensions/* endpoints
 *
 * All Extension JWTs are HS256-signed with the extension's shared secret. The console shows that
 * secret BASE64-ENCODED — you must base64-decode it to raw bytes before signing/verifying
 * (the #1 cause of "invalid signature").
 *
 * Dependency: `npm i jose` (v5/v6). Twurple alternative: `@twurple/ebs-helper` (createExternalJwt,
 * sendExtensionPubSubBroadcastMessage, …) — but it does not verify incoming tokens for you.
 */
import { jwtVerify, SignJWT, errors as joseErrors, type JWTPayload } from 'jose';

// ─────────────────────────────── Types ───────────────────────────────

export type ExtensionRole = 'broadcaster' | 'moderator' | 'viewer' | 'external';

export interface PubSubPerms {
  listen?: string[];
  send?: string[];
}

/** Payload of a Twitch-issued Extension JWT (https://dev.twitch.tv/docs/extensions/reference/#jwt-schema). */
export interface ExtensionJwtPayload extends JWTPayload {
  exp: number;
  /** "U…" = logged-in (stable), "A…" = anonymous (transient, never persist). Broadcaster: "U" + user id. */
  opaque_user_id: string;
  /** Real Twitch user ID — only present when the viewer shared identity (or for broadcasters). */
  user_id?: string;
  /** Channel the extension is rendered on. */
  channel_id: string;
  role: ExtensionRole;
  /** Docs say boolean; the docs' own example shows the string "false". Normalised by verifyExtensionJwt. */
  is_unlinked?: boolean | string;
  pubsub_perms?: PubSubPerms;
}

/** Normalised result of verifyExtensionJwt. */
export interface ExtensionAuth {
  payload: ExtensionJwtPayload;
  channelId: string;
  opaqueUserId: string;
  /** Real Twitch user ID or null (not linked). */
  userId: string | null;
  role: ExtensionRole;
  /** true for opaque IDs starting with "U" (logged-in Twitch account). */
  isLoggedIn: boolean;
  isUnlinked: boolean;
}

/**
 * Bits transaction receipt payload. Shape per the Extensions reference (topic/exp/data/…); the reference
 * table is garbled, so treat optional fields defensively and log the payload once in Hosted Test.
 */
export interface BitsReceiptPayload extends JWTPayload {
  topic: 'bits_transaction_receipt';
  exp: number;
  data: {
    transactionId: string;
    /** UTC timestamp of the transaction. */
    time: string;
    /** Twitch user ID of the user who used Bits. */
    userId: string;
    product: {
      domainId?: string;
      sku: string;
      displayName?: string;
      cost?: { amount: number | string; type: 'bits' };
      inDevelopment?: boolean;
      broadcast?: boolean;
    };
  };
}

export class ExtensionAuthError extends Error {
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403 = 401) {
    super(message);
    this.name = 'ExtensionAuthError';
    this.status = status;
  }
}

// ─────────────────────────────── Secrets ───────────────────────────────

/** Decode the console/API secret (base64) into the raw HMAC key bytes. */
export function decodeExtensionSecret(base64Secret: string): Uint8Array {
  const trimmed = base64Secret.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    throw new Error('Extension secret must be the base64 string shown in the Extensions console');
  }
  return new Uint8Array(Buffer.from(trimmed, 'base64'));
}

/**
 * Parse one or more secrets (comma-separated) — supports rotation: during the overlap window after
 * Create Extension Secret, tokens may be signed by the old OR the new secret. First = used for signing.
 */
export function loadExtensionSecrets(envValue: string | undefined): Uint8Array[] {
  if (!envValue) throw new Error('TWITCH_EXTENSION_SECRET is not set');
  const secrets = envValue.split(',').map((s) => s.trim()).filter(Boolean).map(decodeExtensionSecret);
  if (secrets.length === 0) throw new Error('TWITCH_EXTENSION_SECRET is empty');
  return secrets;
}

// ─────────────────────────────── Verify ───────────────────────────────

const ROLES: ReadonlySet<string> = new Set(['broadcaster', 'moderator', 'viewer', 'external']);

/** Extract the token from "Bearer <jwt>" (also accepts a bare token). */
export function extractBearer(header: string | undefined | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return (m?.[1] ?? header).trim() || null;
}

async function verifyWithAny(token: string, secrets: readonly Uint8Array[], clockToleranceSec: number) {
  let lastError: unknown;
  for (const key of secrets) {
    try {
      // Pin the algorithm: never let the token choose (prevents alg confusion / "none").
      return await jwtVerify(token, key, {
        algorithms: ['HS256'],
        requiredClaims: ['exp'],
        clockTolerance: clockToleranceSec,
      });
    } catch (err) {
      lastError = err;
      // Only a bad signature is worth retrying with the next (rotated) secret.
      if (!(err instanceof joseErrors.JWSSignatureVerificationFailed)) break;
    }
  }
  if (lastError instanceof joseErrors.JWTExpired) throw new ExtensionAuthError('JWT expired');
  throw new ExtensionAuthError('Invalid JWT');
}

/**
 * Verify a frontend token (from onAuthorized → `auth.token`).
 * @param expectedChannelId optional: reject tokens for another channel (e.g. route param).
 */
export async function verifyExtensionJwt(
  token: string,
  secrets: readonly Uint8Array[],
  opts: { expectedChannelId?: string; clockToleranceSec?: number } = {},
): Promise<ExtensionAuth> {
  const { payload } = await verifyWithAny(token, secrets, opts.clockToleranceSec ?? 5);
  const p = payload as Partial<ExtensionJwtPayload>;
  if (typeof p.role !== 'string' || !ROLES.has(p.role)) throw new ExtensionAuthError('JWT has no valid role');
  if (typeof p.channel_id !== 'string' || p.channel_id === '') throw new ExtensionAuthError('JWT has no channel_id');
  if (opts.expectedChannelId && p.channel_id !== opts.expectedChannelId) {
    throw new ExtensionAuthError('JWT is for another channel', 403);
  }
  const opaque = typeof p.opaque_user_id === 'string' ? p.opaque_user_id : '';
  const isUnlinked = p.is_unlinked === true || p.is_unlinked === 'true';
  return {
    payload: p as ExtensionJwtPayload,
    channelId: p.channel_id,
    opaqueUserId: opaque,
    userId: typeof p.user_id === 'string' && p.user_id !== '' ? p.user_id : null,
    role: p.role as ExtensionRole,
    isLoggedIn: opaque.startsWith('U'),
    isUnlinked,
  };
}

/** Throw 403 unless the caller has one of the allowed roles. */
export function requireRole(auth: ExtensionAuth, ...allowed: ExtensionRole[]): void {
  if (!allowed.includes(auth.role)) throw new ExtensionAuthError(`Requires role ${allowed.join('|')}`, 403);
}

/** Verify a Bits `transactionReceipt` (signed with the same extension secret). */
export async function verifyBitsReceipt(
  receipt: string,
  secrets: readonly Uint8Array[],
): Promise<BitsReceiptPayload> {
  const { payload } = await verifyWithAny(receipt, secrets, 5);
  const p = payload as Partial<BitsReceiptPayload>;
  if (p.topic !== 'bits_transaction_receipt') throw new ExtensionAuthError('Not a bits transaction receipt');
  if (!p.data || typeof p.data.transactionId !== 'string' || typeof p.data.product?.sku !== 'string') {
    throw new ExtensionAuthError('Malformed bits receipt');
  }
  return p as BitsReceiptPayload;
}

// ─────────────────────────────── Sign (EBS → Twitch) ───────────────────────────────

export interface EbsJwtOptions {
  /** Twitch user ID of the extension OWNER (not the broadcaster!). */
  ownerId: string;
  /** Channel the call is about. "all" for global PubSub. Required for PubSub + chat. */
  channelId?: string;
  /** PubSub targets you will send to, e.g. ["broadcast"], ["global"], ["whisper-U123"]. */
  pubsubSend?: string[];
  /** Lifetime in seconds. Keep short (sign per request). Default 60. */
  ttlSec?: number;
}

/** Build the claims of an EBS JWT (exported for tests / logging). */
export function buildEbsJwtPayload(o: EbsJwtOptions, nowSec = Math.floor(Date.now() / 1000)) {
  const payload: {
    exp: number;
    user_id: string;
    role: 'external';
    channel_id?: string;
    pubsub_perms?: { send: string[] };
  } = { exp: nowSec + (o.ttlSec ?? 60), user_id: o.ownerId, role: 'external' };
  if (o.channelId) payload.channel_id = o.channelId;
  if (o.pubsubSend?.length) payload.pubsub_perms = { send: o.pubsubSend };
  return payload;
}

/** Sign an EBS JWT (HS256). Use as `Authorization: Bearer <jwt>` together with `Client-Id: <extension client id>`. */
export async function signEbsJwt(secret: Uint8Array, o: EbsJwtOptions): Promise<string> {
  return new SignJWT(buildEbsJwtPayload(o)).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(secret);
}
