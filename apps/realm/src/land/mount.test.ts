import { describe, expect, it, vi } from 'vitest';
import { classify } from '../../../api/src/public/routes';
import type { LandResponse } from './routes';

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./routes', () => ({ readLandRoute: read }));
vi.mock('./store', () => ({ LandArtifactStore: class {} }));
import { mountLandRoutes } from './mount';

type Handler = (res: ResponseDouble, req: RequestDouble) => void;
type RequestDouble = { getUrl: () => string; getMethod: () => string; getHeader: (name: string) => string };
type ResponseDouble = {
  onAborted: (callback: () => void) => void;
  cork: (callback: () => void) => void;
  writeStatus: (status: string) => ResponseDouble;
  writeHeader: (key: string, value: string) => ResponseDouble;
  end: (body?: Uint8Array) => void;
  endWithoutBody: (length?: number) => void;
};

function mounted() {
  let handler!: Handler;
  const app = { any: vi.fn((_path: string, callback: Handler) => { handler = callback; }) };
  mountLandRoutes(app as unknown as Parameters<typeof mountLandRoutes>[0], '/artifacts');
  expect(app.any).toHaveBeenCalledWith('/api/realm/land/*', expect.any(Function));
  let abort = () => {};
  const writes: unknown[][] = [];
  const res: ResponseDouble = {
    onAborted: callback => { abort = callback; },
    cork: callback => { writes.push(['cork']); callback(); },
    writeStatus: status => { writes.push(['status', status]); return res; },
    writeHeader: (key, value) => { writes.push(['header', key, value]); return res; },
    end: body => { writes.push(['end', body]); },
    endWithoutBody: length => { writes.push(['endWithoutBody', length]); },
  };
  return { handler, res, abort: () => abort(), writes };
}

const path = `/api/realm/land/123/${'a'.repeat(64)}`;
const req = (): RequestDouble => ({ getUrl: () => path, getMethod: () => 'head', getHeader: () => '"etag"' });

describe('uWebSockets land mount', () => {
  it('snapshots expiring request fields synchronously and forwards the binary response', async () => {
    let finish!: (response: LandResponse) => void;
    read.mockImplementationOnce(() => new Promise<LandResponse>(resolve => { finish = resolve; }));
    const { handler, res, writes } = mounted();
    const request = req();
    handler(res, request);
    request.getUrl = request.getMethod = request.getHeader = () => { throw new Error('expired request'); };
    expect(read).toHaveBeenCalledWith(expect.anything(), path, 'HEAD', '"etag"');
    const bytes = new Uint8Array([0, 255, 13]);
    finish({ status: 200, headers: { 'content-type': 'application/gzip', etag: '"digest"', 'content-length': '3' }, body: new Uint8Array() });
    await vi.waitFor(() => expect(writes).toContainEqual(['endWithoutBody', 3]));
    expect(writes).toEqual([['cork'], ['status', '200 OK'], ['header', 'content-type', 'application/gzip'],
      ['header', 'etag', '"digest"'], ['endWithoutBody', 3]]);
    // A GET leaves Content-Length to uWS and sends the bytes.
    read.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/gzip', 'content-length': '3' }, body: bytes });
    const get = mounted(); get.handler(get.res, { ...req(), getMethod: () => 'get' });
    await vi.waitFor(() => expect(get.writes).toContainEqual(['end', bytes]));
    expect(get.writes).toEqual([['cork'], ['status', '200 OK'], ['header', 'content-type', 'application/gzip'], ['end', bytes]]);
  });

  it('does not write a successful response after an aborted request', async () => {
    let finish!: (response: LandResponse) => void;
    read.mockImplementationOnce(() => new Promise<LandResponse>(resolve => { finish = resolve; }));
    const { handler, res, abort, writes } = mounted();
    handler(res, req()); abort();
    finish({ status: 200, headers: {}, body: new Uint8Array([42]) });
    await Promise.resolve(); await Promise.resolve();
    expect(writes).toEqual([]);
  });

  it('does not write after an aborted request if the asynchronous read rejects', async () => {
    let reject!: (error: Error) => void;
    read.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const { handler, res, abort, writes } = mounted();
    handler(res, req()); abort(); reject(new Error('failed'));
    await Promise.resolve(); await Promise.resolve();
    expect(writes).toEqual([]);
  });

  it('preserves method errors and converts unmatched routes to no-store 404', async () => {
    read.mockResolvedValueOnce({ status: 405, headers: { allow: 'GET, HEAD' }, body: new Uint8Array() });
    const method = mounted(); method.handler(method.res, { ...req(), getMethod: () => 'post' });
    await vi.waitFor(() => expect(method.writes).toContainEqual(['status', '405 Method Not Allowed']));
    expect(read).toHaveBeenLastCalledWith(expect.anything(), path, 'POST', '"etag"');
    expect(method.writes).toContainEqual(['header', 'allow', 'GET, HEAD']);
    read.mockResolvedValueOnce(null);
    const missing = mounted(); missing.handler(missing.res, req());
    await vi.waitFor(() => expect(missing.writes).toContainEqual(['status', '404 Not Found']));
    expect(missing.writes).toContainEqual(['header', 'cache-control', 'no-store']);
  });
});

it('allows only the exact public land routes', () => {
  const hash = 'b'.repeat(64);
  for (const valid of [path, `${path}/${hash}`]) expect(classify(valid, '')).toEqual({ kind: 'realm' });
  for (const invalid of [`${path}/extra`, `${path}/${hash}/extra`, `${path}/../${hash}`,
    `${path}/%2e%2e/${hash}`, `/api/realm/land/0123/${hash}`, `/api/realm/land/123/${hash.toUpperCase()}`])
    expect(classify(invalid, '')).toEqual({ kind: 'not-found', api: true });
});
