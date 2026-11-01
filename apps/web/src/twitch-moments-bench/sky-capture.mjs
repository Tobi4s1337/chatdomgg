// The sky over the stream picture, captured in its own process group (see capture-supervisor.mjs).
import { fileURLToPath } from 'node:url';
import { superviseCapture } from './capture-supervisor.mjs';

try {
  await superviseCapture(process.execPath, [fileURLToPath(new URL('./sky-capture-worker.mjs', import.meta.url)), ...process.argv.slice(2)],
    // The deadline counts the wait for the shared host lock, which other lanes may hold for a long while.
    { deadlineMs: 90 * 60_000 });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
