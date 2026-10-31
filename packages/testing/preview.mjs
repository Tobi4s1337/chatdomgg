import { preview } from 'vite';
import { assertCapturePort } from './capture-ports.mjs';

/** Port zero lets the OS allocate atomically; parallel lane checks never reserve the same port. */
export async function startCapturePreview(envName = 'CHATDOM_SHOT_PORT') {
  const raw = process.env[envName];
  const port = raw === undefined ? 0 : Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || raw === '') throw new Error(`${envName} must be an integer port in 0..65535`);
  assertCapturePort(port, { allowZero: true, name: envName });
  const server = await preview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', preview: { host: '127.0.0.1', port, strictPort: true } });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') { await closeCapturePreview(server); throw new Error('Capture preview has no TCP address'); }
  return { server, base: `http://127.0.0.1:${address.port}` };
}

export function closeCapturePreview(server) {
  return new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
