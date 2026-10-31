import { EpochMsSchema, KingdomIdSchema, TokenSchema, type KingdomId } from '../../../../packages/shared/src';
import {
  ActionResultSchema, CapabilitySchema, KingdomMomentIntentSchema, type ActionResult, type Capability,
} from '../../../web/src/twitch-moments/contracts';
import { z } from '../../../web/src/twitch-moments/zod';
import type { KingdomMomentKind, Principal, PrincipalPort, RealmGameplayPort } from './ports';

/** One person's strikes reach the realm at most this often; the realm keeps its own, authoritative cadence. */
export const STRIKE_CADENCE_MS = 800;
/** People whose cadence the pre-check remembers. Forgetting one only defers the decision to the realm. */
export const CADENCE_LIMIT = 4096;
/** Distinct intents dispatched at once across this process; beyond it a submit is refused, never queued. */
export const IN_FLIGHT_LIMIT = 1024;
/** A free contribution is a few short IDs; anything larger is not one. */
export const KINGDOM_MOMENT_BODY_LIMIT = 4096;

export const KINGDOM_MOMENT_KINDS: readonly KingdomMomentKind[] = ['strike', 'haul', 'fireworks-chant'];
const UNAVAILABLE: Capability = { available: false, reason: 'unavailable', retryAt: null };
const PERMISSION: Capability = { available: false, reason: 'permission', retryAt: null };

const RealmReplySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('accepted'), receiptKey: TokenSchema, acceptedAt: EpochMsSchema }),
  z.strictObject({ status: z.literal('refused'), reason: z.enum(['permission', 'ineligible', 'rate-limit', 'conflict', 'invalid']),
    retryAt: EpochMsSchema.nullable() }),
  z.strictObject({ status: z.literal('unavailable') }),
  z.strictObject({ status: z.literal('unknown') }),
]);

/** The kingdom a request addresses and the principal main's root auth resolved for it. */
export interface KingdomMomentContext { readonly principal: Principal; readonly kingdomId: KingdomId }
/** `malformed`: not an addressable intent at all (no valid intent ID), so no result can name it. */
export type KingdomMomentOutcome = ActionResult | { readonly status: 'malformed' };

export interface KingdomMomentApplicationOptions {
  readonly gameplay: RealmGameplayPort | null;
  readonly clock: { now(): number };
}

/**
 * The free strike, haul and fireworks-chant executor. It takes an already authenticated principal, checks the
 * addressed kingdom, applies a small cadence pre-check, collapses in-flight duplicates of one intent ID and
 * delegates to the realm, preserving its verdict exactly. It never counts anything locally and never invents
 * acceptance: without a realm every capability is unavailable, and a throw or unreadable reply after dispatch is
 * unknown, reconciled by the realm and never resent.
 */
export function createKingdomMomentApplication(options: KingdomMomentApplicationOptions) {
  const { gameplay, clock } = options;
  /**
   * Fast pre-check only, per person and kind: the earliest time another submit may reach the realm. Strikes are
   * spaced by `STRIKE_CADENCE_MS`; haul and chant wait only for the realm's own `retryAt`. Bounded and process
   * local; the realm remains the authority.
   */
  const notBefore = new Map<string, number>();
  const inFlight = new Map<string, { readonly digest: string; readonly result: Promise<ActionResult> }>();

  const cadenceKey = (kingdomId: KingdomId, principal: Principal, kind: KingdomMomentKind) => `${kingdomId}:${principal.personId}:${kind}`;

  function hold(key: string, until: number, now: number): void {
    if ((notBefore.get(key) ?? 0) >= until) return;
    notBefore.delete(key);
    if (notBefore.size >= CADENCE_LIMIT) for (const [k, at] of notBefore) if (at <= now) notBefore.delete(k);
    while (notBefore.size >= CADENCE_LIMIT) notBefore.delete(notBefore.keys().next().value!);
    notBefore.set(key, until);
  }
  function waiting(key: string, now: number): number | null {
    const until = notBefore.get(key);
    if (until === undefined) return null;
    if (until <= now) { notBefore.delete(key); return null; }
    return until;
  }

  async function capabilities({ principal, kingdomId }: KingdomMomentContext): Promise<ReadonlyMap<KingdomMomentKind, Capability>> {
    if (principal.kingdomId !== kingdomId) return new Map(KINGDOM_MOMENT_KINDS.map(kind => [kind, PERMISSION]));
    const none = new Map(KINGDOM_MOMENT_KINDS.map(kind => [kind, UNAVAILABLE]));
    if (!gameplay) return none;
    let reported: ReadonlyMap<KingdomMomentKind, Capability>;
    try { reported = await gameplay.capabilities(kingdomId, principal.personId); } catch { return none; }
    const now = clock.now(), out = new Map<KingdomMomentKind, Capability>();
    for (const kind of KINGDOM_MOMENT_KINDS) {
      const parsed = CapabilitySchema.safeParse(typeof reported?.get === 'function' ? reported.get(kind) : undefined);
      const capability = parsed.success ? parsed.data : UNAVAILABLE;
      // The local pre-check may narrow what the realm reports, never widen it.
      const retryAt = capability.available ? waiting(cadenceKey(kingdomId, principal, kind), now) : null;
      out.set(kind, retryAt === null ? capability : { available: false, reason: 'rate-limit', retryAt });
    }
    return out;
  }

  async function dispatch(context: KingdomMomentContext, intent: z.infer<typeof KingdomMomentIntentSchema>, signal: AbortSignal): Promise<ActionResult> {
    const { principal, kingdomId } = context, intentId = intent.id, kind = intent.args.kind;
    if (!gameplay || signal.aborted) return { status: 'unavailable', intentId };
    const now = clock.now(), key = cadenceKey(kingdomId, principal, kind);
    const retryAt = waiting(key, now);
    if (retryAt !== null) return { status: 'rejected', intentId, reason: 'rate-limit', retryAt };
    if (kind === 'strike') hold(key, now + STRIKE_CADENCE_MS, now);
    let reply: unknown;
    try {
      reply = await gameplay.submit({ kingdomId, personId: principal.personId, intentId, args: intent.args }, signal);
    } catch {
      // It may have reached the realm: unknown, reconciled there by this intent ID, never resent from here.
      return { status: 'unknown', intentId, reconciliationKey: intentId };
    }
    const parsed = RealmReplySchema.safeParse(reply);
    if (!parsed.success) return { status: 'unknown', intentId, reconciliationKey: intentId };
    const verdict = parsed.data;
    switch (verdict.status) {
      case 'accepted':
        return { status: 'accepted', intentId, receiptKey: verdict.receiptKey, acceptedAt: verdict.acceptedAt, providerId: null };
      case 'refused':
        if (verdict.reason === 'rate-limit' && verdict.retryAt !== null) hold(key, verdict.retryAt, clock.now());
        return { status: 'rejected', intentId, reason: verdict.reason, retryAt: verdict.retryAt };
      case 'unavailable':
        return { status: 'unavailable', intentId };
      case 'unknown':
        return { status: 'unknown', intentId, reconciliationKey: intentId };
    }
  }

  /**
   * Submit one free contribution. A duplicate of an intent still in flight returns that same result; the same
   * ID with different arguments is a conflict. Only the authenticated principal speaks for a person.
   */
  function submit(context: KingdomMomentContext, input: unknown, signal: AbortSignal): Promise<KingdomMomentOutcome> {
    const parsed = KingdomMomentIntentSchema.safeParse(input);
    if (!parsed.success) {
      const id = TokenSchema.safeParse(typeof input === 'object' && input !== null ? (input as { id?: unknown }).id : undefined);
      return Promise.resolve(id.success ? { status: 'rejected', intentId: id.data, reason: 'invalid', retryAt: null } : { status: 'malformed' });
    }
    const intent = parsed.data, { principal, kingdomId } = context;
    if (!KingdomIdSchema.safeParse(kingdomId).success || principal.kingdomId !== kingdomId) {
      return Promise.resolve({ status: 'rejected', intentId: intent.id, reason: 'permission', retryAt: null });
    }
    const key = `${kingdomId}:${principal.personId}:${intent.id}`, digest = JSON.stringify(intent.args);
    const pending = inFlight.get(key);
    if (pending) {
      return pending.digest === digest ? pending.result : Promise.resolve({ status: 'rejected', intentId: intent.id, reason: 'conflict', retryAt: null });
    }
    if (inFlight.size >= IN_FLIGHT_LIMIT) return Promise.resolve({ status: 'rejected', intentId: intent.id, reason: 'rate-limit', retryAt: clock.now() + 1000 });
    const result = dispatch(context, intent, signal).then(r => ActionResultSchema.parse(r)).finally(() => inFlight.delete(key));
    inFlight.set(key, { digest, result });
    return result;
  }

  return { capabilities, submit };
}
export type KingdomMomentApplication = ReturnType<typeof createKingdomMomentApplication>;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } as const;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const refuse = (error: 'unauthenticated' | 'forbidden' | 'malformed' | 'oversize' | 'unsupported' | 'unavailable' | 'not-found', status: number) =>
  json({ error }, status);

/** Reads at most `limit` bytes of the body, or undefined when it is longer. */
async function readBody(request: Request, limit: number): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return undefined;
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return undefined; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** HTTP status for a result: the result body is always the exact `ActionResult`. */
function statusOf(result: ActionResult): number {
  if (result.status === 'unavailable') return 503;
  if (result.status === 'rejected' && result.reason === 'invalid') return 400;
  if (result.status === 'rejected' && result.reason === 'permission') return 403;
  return 200;
}

/**
 * Fetch-compatible handler; main mounts it at a configured route. `POST …/submit?kingdom=<id>` carries one
 * `kingdom.moment` intent as JSON (at most 4 KiB); `GET …/capabilities?kingdom=<id>` reads this person's free
 * capabilities. The principal comes from `principalFor(request)` only; the body never carries authority, and the
 * `kingdom` parameter only names the target, checked against the principal.
 */
export function createKingdomMomentHandler(application: KingdomMomentApplication, principals: PrincipalPort): (request: Request) => Promise<Response> {
  return async request => {
    const url = new URL(request.url), route = url.pathname.split('/').at(-1);
    if (route !== 'submit' && route !== 'capabilities') return refuse('not-found', 404);
    const method = route === 'submit' ? 'POST' : 'GET';
    if (request.method !== method) return new Response(null, { status: 405, headers: { allow: method } });
    let resolved;
    try { resolved = await principals.principalFor(request); } catch { return refuse('unauthenticated', 401); }
    if (!resolved.ok) return resolved.reason === 'csrf' ? refuse('forbidden', 403) : refuse('unauthenticated', 401);
    const kingdom = KingdomIdSchema.safeParse(url.searchParams.get('kingdom'));
    if (!kingdom.success || [...url.searchParams.keys()].some(k => k !== 'kingdom')) return refuse('malformed', 400);
    const context: KingdomMomentContext = { principal: resolved.principal, kingdomId: kingdom.data };
    if (route === 'capabilities') {
      if (context.principal.kingdomId !== context.kingdomId) return refuse('forbidden', 403);
      try {
        return json({ capabilities: Object.fromEntries(await application.capabilities(context)) });
      } catch { return refuse('unavailable', 503); }
    }
    if (!/^application\/json\b/iu.test(request.headers.get('content-type') ?? '')) return refuse('unsupported', 415);
    let text: string | undefined;
    try { text = await readBody(request, KINGDOM_MOMENT_BODY_LIMIT); } catch { return refuse('malformed', 400); }
    if (text === undefined) return refuse('oversize', 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return refuse('malformed', 400); }
    let outcome: KingdomMomentOutcome;
    try { outcome = await application.submit(context, body, request.signal); } catch { return refuse('unavailable', 503); }
    return outcome.status === 'malformed' ? refuse('malformed', 400) : json(outcome, statusOf(outcome));
  };
}
