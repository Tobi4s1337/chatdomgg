// Run one welcome still per lease: node apps/web/src/raid-gate/road/capture.mjs --only welcome
// One supervised process group owns the lock, preview and browser. The queue may
// take 20 minutes; the additional 25 minutes bound loading and rendering.
import { fileURLToPath } from 'node:url';
import { superviseCapture } from '../../twitch-moments-bench/capture-supervisor.mjs';

try {
  if (process.argv.includes('--stills') || process.argv.includes('--sequence')) {
    throw new Error('Full-series capture is disabled; use --only welcome for one still per lease');
  }
  await superviseCapture(process.execPath, [fileURLToPath(new URL('./capture-worker.mjs', import.meta.url)), ...process.argv.slice(2)], { deadlineMs: 45 * 60_000 });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
