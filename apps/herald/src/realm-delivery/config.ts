import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import type { HeraldConfig } from '../config';
import { RealmDelivery } from './delivery';

/** Nonsecret destination settings share Herald's settings file. The service bearer stays in process env. */
export async function configuredRealmDelivery(config: HeraldConfig, repositoryRoot: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env): Promise<RealmDelivery | null> {
  const settings = await readFile(config.settingsFile, 'utf8').then(parseEnv, () => ({} as Record<string, string>));
  const url = (env.HERALD_REALM_URL ?? settings.HERALD_REALM_URL)?.trim();
  if (!url) return null;
  const secret = env.REALM_INGRESS_HERALD_SECRET ?? '';
  const directory = (env.HERALD_REALM_OUTBOX_DIR ?? settings.HERALD_REALM_OUTBOX_DIR)?.trim() || join(config.dataDir, 'realm-delivery');
  return RealmDelivery.open({ url, secret, directory, repositoryRoot, origin: 'live' });
}
