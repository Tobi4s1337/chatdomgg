import { createServer } from 'node:net';
import { CAPTURE_PORTS, assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';

async function isFree(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => probe.close(error => error ? reject(error) : resolve(true)));
  });
}

/** Called under the capture lock. Never reclaim another service's port. */
export async function findCapturePort(probe = isFree) {
  for (const candidate of CAPTURE_PORTS) {
    const port = assertCapturePort(candidate);
    if (await probe(port)) return port;
  }
  throw new Error('All permitted capture ports are occupied');
}
