// Run the capture in its own process group so a dead or wedged worker cannot
// leave the machine capture lock or an owned Chromium process behind.
import { fileURLToPath } from 'node:url';
import { superviseCapture } from './capture-supervisor.mjs';

try {
  await superviseCapture(process.execPath, [fileURLToPath(new URL('./capture-worker.mjs', import.meta.url)), ...process.argv.slice(2)]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
