import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { KingdomIdSchema } from '../../../../packages/shared/src/identity';
import { RaidCrierAuthority, CrierError } from '../../../realm/src/raid-gate/crier';
import { dockMutationAllowed, dockPrincipal } from '../dock/auth';
import { csrfFor } from '../realm-auth/secrets';
import type { RealmAuthConfig } from '../realm-auth/config';
import { RAID_CRIER_SETTINGS_PREFIX, RaidCrierSettingChangeSchema } from './crier-contracts';

interface SettingOptions { readonly pool: Pool; readonly config: RealmAuthConfig; readonly authority?: RaidCrierAuthority }
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
const reply = (response: ServerResponse, status: number, value: unknown) => { response.writeHead(status, headers).end(JSON.stringify(value)); };

/** The broadcaster's own persisted crier switch. Body fields never supply a role, person or kingdom. */
export async function handleRaidCrierSetting(request: IncomingMessage, response: ServerResponse, options: SettingOptions): Promise<boolean> {
  const url = new URL(request.url ?? '/', options.config.publicOrigin);
  if (!url.pathname.startsWith(`${RAID_CRIER_SETTINGS_PREFIX}/`)) return false;
  const kingdom = KingdomIdSchema.safeParse(url.pathname.slice(RAID_CRIER_SETTINGS_PREFIX.length + 1));
  if (!kingdom.success || url.search) { reply(response, 400, { version: 1, status: 'refused' }); return true; }
  if (request.method !== 'GET' && request.method !== 'POST') { reply(response, 405, { version: 1, status: 'refused' }); return true; }
  const { pool, config } = options;
  const session = await dockPrincipal(pool, config.mode, config.secureCookies, request.headers.cookie);
  if (!session) { reply(response, 401, { version: 1, status: 'refused' }); return true; }
  if (session.principal.personId !== kingdom.data) { reply(response, 403, { version: 1, status: 'refused' }); return true; }
  const exists = await pool.query('SELECT kingdom_id FROM realm_kingdoms WHERE kingdom_id = $1 AND origin = $2', [kingdom.data, config.mode]);
  if (exists.rows.length !== 1) { reply(response, 404, { version: 1, status: 'refused' }); return true; }
  const authority = options.authority ?? new RaidCrierAuthority({ pool, origin: config.mode, publicOrigin: config.publicOrigin, clock: Date.now });
  try {
    if (request.method === 'GET') {
      reply(response, 200, { ...await authority.setting(kingdom.data), csrfToken: csrfFor(session.handle) }); return true;
    }
    if (!dockMutationAllowed(request.headers, config.publicOrigin, session.handle)) { reply(response, 403, { version: 1, status: 'refused' }); return true; }
    if (!/^application\/json(?:;|$)/iu.test(String(request.headers['content-type'] ?? ''))) { reply(response, 415, { version: 1, status: 'refused' }); return true; }
    if (Number(request.headers['content-length'] ?? 0) > 1_024) { reply(response, 413, { version: 1, status: 'refused' }); return true; }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk); size += bytes.byteLength;
      if (size > 1_024) { reply(response, 413, { version: 1, status: 'refused' }); return true; }
      chunks.push(bytes);
    }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply(response, 400, { version: 1, status: 'refused' }); return true; }
    const change = RaidCrierSettingChangeSchema.safeParse(raw);
    if (!change.success) { reply(response, 400, { version: 1, status: 'refused' }); return true; }
    reply(response, 200, await authority.configure(kingdom.data, change.data.mode, change.data.expectedRevision));
  } catch (error) {
    const status = error instanceof CrierError ? error.kind === 'conflict' ? 409 : error.kind === 'invalid' ? 400 : 503 : 503;
    reply(response, status, { version: 1, status: status === 503 ? 'unavailable' : 'refused' });
  }
  return true;
}
