import { isAbsolute, resolve } from 'node:path';
import { AtlasError } from './errors';

/**
 * Environment only. There are deliberately no defaults for the source host or database: this service must be told
 * which collector it reads, and the source locations of one environment never become application constants.
 */
export interface ImportConfig {
  surveyorBaseUrl: URL;
  surveyorDbPath: string | null;
  dataDir: string;
  keepRevisions: number;
  httpTimeoutMs: number;
}

export interface ServeConfig {
  dataDir: string;
  host: string;
  port: number;
}

type Env = Readonly<Record<string, string | undefined>>;

export function dataDirFrom(env: Env): string {
  const dir = env.ATLAS_DATA_DIR?.trim();
  if (!dir) throw new AtlasError('config', 'ATLAS_DATA_DIR is required: the Atlas writes only to its own data directory.');
  return isAbsolute(dir) ? dir : resolve(dir);
}

function intFrom(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new AtlasError('config', `${name} must be an integer from ${min} to ${max}.`);
  return value;
}

export function importConfigFrom(env: Env): ImportConfig {
  const base = env.SURVEYOR_BASE_URL?.trim();
  if (!base) throw new AtlasError('config', 'SURVEYOR_BASE_URL is required, for example the Surveyor\'s /atlas/api base.');
  let surveyorBaseUrl: URL;
  try {
    surveyorBaseUrl = new URL(base.endsWith('/') ? base : `${base}/`);
  } catch {
    throw new AtlasError('config', 'SURVEYOR_BASE_URL is not a valid URL.');
  }
  if (surveyorBaseUrl.protocol !== 'http:' && surveyorBaseUrl.protocol !== 'https:') {
    throw new AtlasError('config', 'SURVEYOR_BASE_URL must use http or https.');
  }
  if (surveyorBaseUrl.username || surveyorBaseUrl.password) throw new AtlasError('config', 'SURVEYOR_BASE_URL must not carry credentials.');
  const db = env.SURVEYOR_DB_PATH?.trim();
  return {
    surveyorBaseUrl,
    surveyorDbPath: db ? (isAbsolute(db) ? db : resolve(db)) : null,
    dataDir: dataDirFrom(env),
    keepRevisions: intFrom(env, 'ATLAS_KEEP_REVISIONS', 3, 1, 50),
    httpTimeoutMs: intFrom(env, 'SURVEYOR_HTTP_TIMEOUT_MS', 8_000, 250, 60_000),
  };
}

export function serveConfigFrom(env: Env): ServeConfig {
  return {
    dataDir: dataDirFrom(env),
    host: env.ATLAS_HOST?.trim() || '127.0.0.1',
    port: intFrom(env, 'ATLAS_PORT', 5193, 1, 65_535),
  };
}
