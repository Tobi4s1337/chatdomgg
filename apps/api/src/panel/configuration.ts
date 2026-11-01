import { jwtVerify } from 'jose';
import { z } from 'zod';
import type { PanelSettingsReading } from '../../../../packages/shared/src/panel';
import { parsePanelSettings } from '../../../panel/src/settings/schema';
import { extensionKey } from '../public/panel/token';
import { verifyViewerToken } from './token';

export type PanelConfigurationRoute = 'configuration' | 'configure';
export interface PanelConfigurationReply { readonly http: number; readonly body: unknown }
export interface PanelConfigurationOptions {
  readonly extensionSecret: string;
  readonly realm: (path: string, body: unknown) => Promise<Record<string, unknown>>;
  readonly now?: () => number;
}
class BroadcasterRequired extends Error {}
const Id = z.string().regex(/^[1-9][0-9]{0,31}$/);
const Revision = z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(value => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) < 9_223_372_036_854_775_807n);
const Write = z.strictObject({ expectedRevision: Revision, settings: z.unknown() });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Verify the signature and current expiry before inspecting admin claims. No decoded-token authorization. */
export async function verifyBroadcaster(authorization: string | null, key: Uint8Array, now = Date.now()): Promise<{
  readonly channelId: string; readonly personId: string; readonly role: 'broadcaster'; readonly kind: 'shared';
}> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token || token.length > 4096) throw new Error('No broadcaster token.');
  const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'],
    requiredClaims: ['exp', 'channel_id', 'role', 'opaque_user_id'], currentDate: new Date(now) });
  if (payload.role !== 'broadcaster' || !Id.safeParse(payload.channel_id).success || !Id.safeParse(payload.user_id).success
    || payload.user_id !== payload.channel_id || typeof payload.opaque_user_id !== 'string' || !/^U[A-Za-z0-9]+$/.test(payload.opaque_user_id)
    || payload.is_unlinked === true || payload.is_unlinked === 'true') throw new BroadcasterRequired();
  return { channelId: payload.channel_id as string, personId: payload.user_id as string, role: 'broadcaster', kind: 'shared' };
}

function reading(raw: unknown): PanelSettingsReading | null {
  if (!record(raw) || raw.version !== 1 || raw.status !== 'settings' || !Revision.safeParse(raw.revision).success || typeof raw.connected !== 'boolean') return null;
  const settings = parsePanelSettings(raw.settings);
  return settings ? { version: 1, status: 'settings', revision: raw.revision as string, settings, connected: raw.connected } : null;
}
const reply = (http: number, status: string, message: string): PanelConfigurationReply => ({ http, body: { version: 1, status, message } });
const unavailable = () => reply(503, 'unavailable', 'The panel settings are out of reach. Try again shortly.');
const refused = () => reply(400, 'refused', 'These panel settings could not be saved.');

/** The authenticated realm mirror is the purchase gate. Helper configuration is written by the config page after this succeeds. */
export function createPanelConfiguration(options: PanelConfigurationOptions) {
  let key: Uint8Array | undefined;
  try { key = extensionKey(options.extensionSecret); } catch { /* Missing setup is an honest unavailable state. */ }
  return {
    async handle(route: PanelConfigurationRoute, authorization: string | null, raw: unknown): Promise<PanelConfigurationReply> {
      if (!key) return unavailable();
      let identity: { readonly channelId: string; readonly personId?: string };
      try {
        identity = route === 'configure' ? await verifyBroadcaster(authorization, key, options.now?.()) : await verifyViewerToken(authorization, key);
      } catch (error) {
        return error instanceof BroadcasterRequired ? reply(403, 'refused', 'Only the broadcaster can change these settings.')
          : reply(401, 'refused', 'Open the panel on Twitch and try again.');
      }
      try {
        let answer: Record<string, unknown>;
        if (route === 'configuration') {
          z.strictObject({}).parse(raw);
          answer = await options.realm('/internal/realm/panel/settings', { kingdomId: identity.channelId });
        } else {
          const body = Write.parse(raw), settings = parsePanelSettings(body.settings);
          if (!settings) return refused();
          answer = await options.realm('/internal/realm/panel/settings-save', { kingdomId: identity.channelId, personId: identity.personId,
            expectedRevision: body.expectedRevision, settings });
        }
        const saved = reading(answer);
        if (saved) return { http: 200, body: saved };
        if (route === 'configure' && answer.version === 1 && answer.status === 'conflict') {
          const current = reading(answer.current);
          if (current) return { http: 200, body: { version: 1, status: 'conflict', current } };
        }
        return unavailable();
      } catch (error) { return error instanceof z.ZodError ? refused() : unavailable(); }
    },
  };
}
