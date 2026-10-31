// Server-only bindings for the emote transport. Not exported from the package root, so browser
// bundles never pull in Node modules: import from `@chatdom/emotes/server`.
import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import type { CheckedTransportOptions, PinnedGet } from '../catalogue/checked-transport';

/**
 * A pinned HTTPS GET for Node: connects to the checked address through a custom `lookup`, keeps the
 * URL's hostname for SNI and certificate validation, follows no redirects and streams the body.
 */
export function createNodePinnedGet(): PinnedGet {
  return ({ url, address, family, headers, signal }) => new Promise((resolve, reject) => {
    const req = request({
      protocol: 'https:', hostname: url.hostname, servername: url.hostname, port: 443, path: url.pathname + url.search, method: 'GET',
      headers: { 'user-agent': 'chatdom-emotes/1 (+https://chatdom.gg)', ...headers },
      lookup: (_host, options, callback) => {
        if ((options as { all?: boolean }).all) (callback as unknown as (error: null, list: { address: string; family: number }[]) => void)(null, [{ address, family }]);
        else callback(null, address, family);
      },
      signal,
    }, response => {
      resolve({
        status: response.statusCode ?? 0,
        headers: { get: name => { const value = response.headers[name.toLowerCase()]; return Array.isArray(value) ? value.join(',') : value ?? null; } },
        body: response as AsyncIterable<Uint8Array>,
        cancel: () => { response.destroy(); },
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** System DNS, every answer, for the checked transport's public-address test. */
export const nodeResolve: CheckedTransportOptions['resolve'] = async hostname => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map(answer => ({ address: answer.address, family: answer.family === 6 ? 6 as const : 4 as const }));
};
