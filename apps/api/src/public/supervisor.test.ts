import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPublicConfig } from './config';
import { bindPublicGateway, supervise, type Supervised } from './supervisor';

const servers: Server[] = [];
const children: Supervised[] = [];
const makeServer = () => {
  const server = createServer((_request, response) => response.end('public'));
  servers.push(server);
  return server;
};
const unexpectedRealm = () => { throw new Error('Proxy mode must not start a realm'); };

afterEach(async () => {
  await Promise.all(children.splice(0).map(child => child.stop(100)));
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

describe('public gateway startup', () => {
  it('does not create a writer when the public listener cannot bind', async () => {
    const occupied = makeServer();
    await bindPublicGateway({ server: occupied, host: '127.0.0.1', port: 0, realmMode: 'proxy', startRealm: unexpectedRealm });
    const startRealm = vi.fn(unexpectedRealm);
    await expect(bindPublicGateway({ server: makeServer(), host: '127.0.0.1', port: (occupied.address() as AddressInfo).port,
      realmMode: 'spawn', startRealm })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(startRealm).not.toHaveBeenCalled();
  });

  it('uses PUBLIC_REALM_TARGET without starting any child', async () => {
    const config = readPublicConfig({ PUBLIC_KINGDOMS: '1001:tobi4s_', PUBLIC_REALM_TARGET: 'http://127.0.0.1:5173' }, '/tmp/chatdom-public-test');
    const startRealm = vi.fn(unexpectedRealm);
    const server = makeServer();
    expect(await bindPublicGateway({ server, host: '127.0.0.1', port: 0, realmMode: config.realm.mode, startRealm })).toBeNull();
    expect(server.listening).toBe(true);
    expect(startRealm).not.toHaveBeenCalled();
  });

  it('starts its child only after the gateway owns its listener, then waits for the child to close on stop', async () => {
    const server = makeServer();
    const child = await bindPublicGateway({ server, host: '127.0.0.1', port: 0, realmMode: 'spawn', startRealm: () => {
      expect(server.listening).toBe(true);
      const process = supervise({ name: 'test-child', command: globalThis.process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: '/tmp', env: globalThis.process.env, log: vi.fn() });
      children.push(process);
      return process;
    } });
    expect(child?.running()).toBe(true);
    const firstStop = child!.stop(100);
    expect(child!.stop(100)).toBe(firstStop);
    await firstStop;
    expect(child?.running()).toBe(false);
  });

  it('releases the listener when child creation throws during startup', async () => {
    const server = makeServer();
    await expect(bindPublicGateway({ server, host: '127.0.0.1', port: 0, realmMode: 'spawn',
      startRealm: () => { throw new Error('The child configuration failed'); } })).rejects.toThrow('The child configuration failed');
    expect(server.listening).toBe(false);
  });

  it('can stop a failed spawn without waiting for an exit event that will never arrive', async () => {
    const log = vi.fn();
    const child = supervise({ name: 'missing-child', command: '/tmp/chatdom-public-nonexistent-executable', args: [], cwd: '/tmp', env: {}, log });
    children.push(child);
    await expect.poll(() => log.mock.calls.some(([line]) => String(line).includes('could not start'))).toBe(true);
    await child.stop(100);
    expect(child.running()).toBe(false);
  });
});
