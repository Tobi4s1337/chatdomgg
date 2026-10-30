import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CitizenChatCueSchema, KingdomIdSchema, PresenceInputSchema, type CitizenChatCue, type KingdomId, type PresenceInput } from '@chatdom/shared';
import { digestOf } from '../persistence/codec';
import type { IngressService } from './transition';

/** A service credential must carry at least this much secret. Shorter configuration is refused at startup. */
export const INGRESS_SECRET_MIN = 32;

/**
 * What each authenticated service may report. Ingress only ever grants the `presence` capability: allocation,
 * publication, moderation and Forge commands never enter through this door, and no service may hand the realm a
 * domain command, a receipt or a credit. Qualified-night credit is derived inside the transaction from evidence.
 */
const GRANTS: Record<IngressService, (input: PresenceInput) => boolean> = {
  // Herald watches Twitch: the stream itself, the Chatters roster, chat activity and Chatdom's moderation holds.
  herald: input => input.kind !== 'observe' || input.source === 'chatters' || input.source === 'chat',
  // The panel only says that the person whose extension JWT it verified has the panel open.
  panel: input => input.kind === 'observe' && input.source === 'panel' && input.people.length === 1,
  // Walkers are observed by this process's own rooms from authenticated principals, never over HTTP.
  walker: input => input.kind === 'observe' && input.source === 'walker',
};

export interface IngressCredentials {
  readonly herald?: string;
  readonly panel?: string;
}

/** Reads `REALM_INGRESS_HERALD_SECRET` / `REALM_INGRESS_PANEL_SECRET` without echoing them. */
export function ingressCredentials(env: Readonly<Record<string, string | undefined>> = process.env): IngressCredentials {
  const read = (name: string) => {
    const value = env[name];
    if (value === undefined || value === '') return undefined;
    if (value.length < INGRESS_SECRET_MIN) throw new Error(`${name} must be at least ${INGRESS_SECRET_MIN} characters.`);
    return value;
  };
  const herald = read('REALM_INGRESS_HERALD_SECRET'), panel = read('REALM_INGRESS_PANEL_SECRET');
  if (herald && panel && herald === panel) throw new Error('Herald and panel ingress need different secrets.');
  return { ...(herald ? { herald } : {}), ...(panel ? { panel } : {}) };
}

/** One normalized, authenticated observation, ready for the durable inbox. */
export interface AdmittedObservation {
  readonly kind: 'observation';
  readonly service: IngressService;
  readonly kingdomId: KingdomId;
  readonly capability: 'presence';
  readonly digest: string;
  readonly observation: PresenceInput;
}
/** Witnessed speech for the room's transient channel. It is relayed, never stored. */
export interface AdmittedCue { readonly kind: 'cue'; readonly service: 'herald'; readonly kingdomId: KingdomId; readonly cue: CitizenChatCue }

export type Admission =
  | { readonly ok: true; readonly admitted: AdmittedObservation | AdmittedCue }
  | { readonly ok: false; readonly status: 'unauthenticated' | 'refused'; readonly message: string };

const EnvelopeSchema = z.union([
  z.strictObject({ version: z.literal(1), observation: z.unknown() }),
  z.strictObject({ version: z.literal(1), cue: z.unknown() }),
]);

/**
 * The service door. Authenticates the caller by its bearer secret (compared as SHA-256 digests in constant time),
 * validates the body with the shared strict schemas — so unknown fields such as message text fail — checks that the
 * service may report this kind of evidence, and that it belongs to a kingdom of this realm's origin.
 */
export class IngressGate {
  private readonly keys: readonly { readonly service: 'herald' | 'panel'; readonly hash: Buffer }[];

  constructor(credentials: IngressCredentials, private readonly origin: 'live' | 'simulated') {
    this.keys = (['herald', 'panel'] as const).flatMap(service => credentials[service] ? [{ service, hash: sha256(credentials[service]) }] : []);
  }

  get configured(): boolean { return this.keys.length > 0; }

  /** Which service presented this `Authorization` header, or null. Every key is compared, so timing reveals nothing. */
  authenticate(authorization: string | undefined): 'herald' | 'panel' | null {
    const match = /^Bearer ([\x21-\x7e]{1,512})$/.exec(authorization ?? '');
    const presented = sha256(match?.[1] ?? '');
    let found: 'herald' | 'panel' | null = null;
    for (const key of this.keys) if (timingSafeEqual(key.hash, presented) && match) found = key.service;
    return found;
  }

  admit(authorization: string | undefined, body: unknown): Admission {
    const service = this.authenticate(authorization);
    if (!service) return { ok: false, status: 'unauthenticated', message: 'This service is not known to the realm.' };
    const envelope = EnvelopeSchema.safeParse(body);
    if (!envelope.success) return { ok: false, status: 'refused', message: 'Send { version: 1, observation } or { version: 1, cue }.' };
    if ('cue' in envelope.data) {
      if (service !== 'herald') return { ok: false, status: 'refused', message: 'Only Herald relays witnessed speech.' };
      const cue = CitizenChatCueSchema.safeParse(envelope.data.cue);
      if (!cue.success) return { ok: false, status: 'refused', message: 'The speech cue is malformed.' };
      if (cue.data.origin !== this.origin) return { ok: false, status: 'refused', message: `This ${this.origin} realm does not take ${cue.data.origin} speech.` };
      return { ok: true, admitted: { kind: 'cue', service, kingdomId: cue.data.kingdomId, cue: cue.data } };
    }
    return this.observe(service, envelope.data.observation);
  }

  /** In-process observations (the room's walkers) pass the same validation, minus the bearer check. */
  observe(service: IngressService, raw: unknown): Admission {
    const parsed = PresenceInputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, status: 'refused', message: 'The observation is malformed.' };
    const observation = parsed.data;
    if (!GRANTS[service](observation)) return { ok: false, status: 'refused', message: `${service} may not report that observation.` };
    if (observation.origin !== this.origin && observation.origin !== 'recovered') {
      return { ok: false, status: 'refused', message: `This ${this.origin} realm does not take ${observation.origin} observations.` };
    }
    const kingdomId = KingdomIdSchema.parse(observation.kingdomId);
    return { ok: true, admitted: { kind: 'observation', service, kingdomId, capability: 'presence', digest: digestOf(observation), observation } };
  }
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest();
