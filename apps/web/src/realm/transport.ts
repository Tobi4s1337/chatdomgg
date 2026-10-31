import { Client } from '@colyseus/sdk';
import { readRealmJson } from './adapters/entry';

/** Keep every SDK HTTP/reconnect/socket request on the configured reverse-proxy mount. */
export function realmProxyUrl(endpoint: string, requested: URL): URL {
  const base = new URL(endpoint), url = new URL(requested);
  const prefix = base.pathname.replace(/\/+$/, '');
  url.hostname = base.hostname; url.port = base.port;
  const secure = base.protocol === 'https:' || base.protocol === 'wss:';
  url.protocol = url.protocol.startsWith('ws') ? secure ? 'wss:' : 'ws:' : secure ? 'https:' : 'http:';
  if (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) url.pathname = `${prefix}${url.pathname}`;
  return url;
}

export function createRealmNetwork(endpoint: string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Client {
  return new Client(endpoint, {
    urlBuilder: url => realmProxyUrl(endpoint, url).toString(),
    fetchFn: async (input, init) => {
      const url = realmProxyUrl(endpoint, new URL(String(input)));
      const response = await fetcher(url, init);
      const step = url.pathname.includes('/reconnect/') ? 'Reconnecting to the kingdom' : 'Joining the kingdom';
      await readRealmJson(response.clone(), `${step} (${url.pathname})`);
      return response;
    },
  });
}
