// Load the latest rehearsal only after this single capture obtains the shared host lock.
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

const release = await acquireCaptureLock({ priority: 'lane' });
try {
  await import('./rehearsal.mjs');
} finally {
  await release();
}
