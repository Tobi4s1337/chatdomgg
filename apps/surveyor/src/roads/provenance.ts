import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { surveyorBaseUrl } from './surveyor-stream';

/** Private identity of one explicitly paired collector HTTP + database source. Never a browser identifier. */
export function collectorProvenance(base: string | null, database: string | null): string {
  const identity = { base: base === null ? null : surveyorBaseUrl(base).href, database: database === null ? null : resolve(database) };
  return `collector:${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 32)}`;
}
