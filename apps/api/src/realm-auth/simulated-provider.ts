import type { IncomingMessage, ServerResponse } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { OidcProvider } from './oidc';
import { secret } from './secrets';

/**
 * A SIMULATED OpenID provider for development previews and tests. It speaks the same authorize/token/JWKS protocol
 * as Twitch and signs real RS256 ID tokens, so sign-in runs through the production verification path. Everyone it
 * vouches for is simulated: their sessions, tickets and principals carry `origin: 'simulated'`, which live realms
 * refuse. No Twitch account is involved and nothing it does reaches Twitch.
 */
export const SIMULATED_OIDC_PATH = '/api/realm/simulated-oidc';
/** Reserved simulated person IDs. Named people first; the rest of the range is available to tests. */
export const SIMULATED_PEOPLE: readonly { readonly personId: string; readonly name: string; readonly note: string }[] = [
  { personId: '990100001', name: 'Wren', note: 'first evening in the kingdom' },
  { personId: '990100002', name: 'Tamsin', note: 'a regular who never misses a stream' },
  { personId: '990100003', name: 'Oko', note: 'quiet, mostly lurks' },
  { personId: '990100004', name: 'Bram', note: 'owns the loudest emotes' },
  { personId: '990100005', name: 'Ilse', note: 'came in with a raid' },
  { personId: '990100006', name: 'Juno ✦', note: 'a display name with a symbol in it' },
];
const SIMULATED_RANGE = { first: 990_100_001, last: 990_199_999 };

export interface SimulatedOidcOptions {
  /** Browser-facing base, for example `http://localhost:5190`. */
  readonly publicOrigin: string;
  /** Server-reachable base for token and key requests, for example `http://127.0.0.1:5192`. */
  readonly internalOrigin: string;
  /** The only redirect URI this provider will send codes to. */
  readonly redirectUri: string;
}
interface PendingCode { readonly personId: string; readonly nonce: string; readonly name: boolean; readonly expiresAt: number }

export async function createSimulatedOidcProvider(options: SimulatedOidcOptions) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const kid = `simulated-${secret(6)}`;
  const jwk = { ...await exportJWK(publicKey), kid, alg: 'RS256', use: 'sig' };
  const issuer = `${options.publicOrigin}${SIMULATED_OIDC_PATH}`;
  const provider: OidcProvider = {
    origin: 'simulated', issuer, clientId: `simulated-${secret(9)}`, clientSecret: secret(),
    authorizationEndpoint: `${options.publicOrigin}${SIMULATED_OIDC_PATH}/authorize`,
    tokenEndpoint: `${options.internalOrigin}${SIMULATED_OIDC_PATH}/token`,
    jwksUri: `${options.internalOrigin}${SIMULATED_OIDC_PATH}/keys`,
  };
  const codes = new Map<string, PendingCode>();

  const authorizeRequest = (params: URLSearchParams) => {
    const state = params.get('state') ?? '', nonce = params.get('nonce') ?? '';
    if (params.get('client_id') !== provider.clientId || params.get('redirect_uri') !== options.redirectUri || params.get('response_type') !== 'code'
      || !(params.get('scope') ?? '').split(' ').includes('openid') || !state || !nonce || state.length > 128 || nonce.length > 128) return null;
    let claims: { id_token?: object } | null;
    try { claims = JSON.parse(params.get('claims') ?? '{}'); } catch { return null; }
    return { state, nonce, name: Object.hasOwn(claims?.id_token ?? {}, 'preferred_username') };
  };

  async function handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith(`${SIMULATED_OIDC_PATH}/`)) return false;
    const route = url.pathname.slice(SIMULATED_OIDC_PATH.length);
    for (const [code, pending] of codes) if (pending.expiresAt <= Date.now()) codes.delete(code);
    if (route === '/keys' && request.method === 'GET') return send(response, 200, 'application/json', JSON.stringify({ keys: [jwk] })), true;
    if (route === '/authorize' && request.method === 'GET') {
      const valid = authorizeRequest(url.searchParams);
      if (!valid) return send(response, 400, 'text/plain; charset=utf-8', 'SIMULATED provider: this sign-in request is not for this client.'), true;
      send(response, 200, 'text/html; charset=utf-8', chooserPage(url.searchParams));
      return true;
    }
    if (route === '/approve' && request.method === 'POST') {
      const form = new URLSearchParams(await readBody(request));
      const valid = authorizeRequest(form);
      if (!valid) return send(response, 400, 'text/plain; charset=utf-8', 'SIMULATED provider: this sign-in request is not for this client.'), true;
      const back = new URL(options.redirectUri);
      back.searchParams.set('state', valid.state);
      const person = Number(form.get('person'));
      if (form.get('decision') !== 'allow') back.searchParams.set('error', 'access_denied');
      else if (!Number.isInteger(person) || person < SIMULATED_RANGE.first || person > SIMULATED_RANGE.last) {
        return send(response, 400, 'text/plain; charset=utf-8', 'SIMULATED provider: choose one of the simulated people.'), true;
      } else {
        const code = secret();
        codes.set(code, { personId: String(person), nonce: valid.nonce, name: valid.name, expiresAt: Date.now() + 60_000 });
        back.searchParams.set('code', code);
      }
      response.writeHead(302, { Location: back.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end();
      return true;
    }
    if (route === '/token' && request.method === 'POST') {
      const form = new URLSearchParams(await readBody(request));
      const pending = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      if (form.get('client_id') !== provider.clientId || form.get('client_secret') !== provider.clientSecret || form.get('grant_type') !== 'authorization_code'
        || form.get('redirect_uri') !== options.redirectUri || !pending || pending.expiresAt <= Date.now()) {
        return send(response, 400, 'application/json', JSON.stringify({ status: 400, message: 'Invalid authorization code' })), true;
      }
      const named = SIMULATED_PEOPLE.find(p => p.personId === pending.personId)?.name ?? `Visitor ${pending.personId.slice(-3)}`;
      const idToken = await new SignJWT({ nonce: pending.nonce, azp: provider.clientId, ...(pending.name ? { preferred_username: named } : {}) })
        .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' }).setIssuer(issuer).setSubject(pending.personId).setAudience(provider.clientId)
        .setIssuedAt().setExpirationTime('15m').sign(privateKey);
      send(response, 200, 'application/json', JSON.stringify({
        access_token: secret(), refresh_token: secret(), id_token: idToken, expires_in: 900, scope: ['openid'], token_type: 'bearer',
      }));
      return true;
    }
    send(response, 404, 'text/plain; charset=utf-8', 'SIMULATED provider: no such endpoint.');
    return true;
  }

  return { provider, handle };
}

function send(response: ServerResponse, status: number, type: string, body: string) {
  response.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  }).end(body);
}
async function readBody(request: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of request as AsyncIterable<Buffer>) { body += chunk.toString('utf8'); if (body.length > 8_192) break; }
  return body;
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function chooserPage(params: URLSearchParams): string {
  const hidden = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'nonce', 'claims']
    .map(key => `<input type="hidden" name="${key}" value="${escape(params.get(key) ?? '')}">`).join('');
  const people = SIMULATED_PEOPLE.map(p => `<button name="person" value="${p.personId}"><span class="initial">${escape(p.name[0] ?? '?')}</span><span class="who"><b>${escape(p.name)}</b><i>${escape(p.note)}</i></span></button>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SIMULATED sign-in · Chatdom</title><style>
:root{color-scheme:dark;font-family:Georgia,'Iowan Old Style','Times New Roman',serif}*{box-sizing:border-box}
body{margin:0;min-height:100svh;display:grid;place-items:center;padding:28px 18px;color:#3b2a1a;
background:repeating-linear-gradient(90deg,#6a442a 0 9px,#5e3c25 9px 13px,#714a2e 13px 31px,#5a3923 31px 34px,#684329 34px 52px),#643f27}
body::before{content:"";position:fixed;inset:0;background:radial-gradient(ellipse 70% 60% at 50% 38%,#ffcf8a30,transparent 70%),radial-gradient(ellipse at 50% 50%,transparent 45%,#1a0d06c0);pointer-events:none}
.sheet{position:relative;width:min(470px,100%);filter:drop-shadow(0 2px 1px #2a160a88) drop-shadow(0 26px 40px #1a0d06aa)}
.card{padding:34px 34px 26px;background:radial-gradient(ellipse at 30% 20%,#fbf1d9,#f1e0b9 55%,#e4cd9c);
clip-path:polygon(0 1%,4% 0,12% .8%,25% 0,38% .6%,52% 0,66% .9%,80% .1%,93% .7%,100% 0,99.4% 14%,100% 30%,99.3% 48%,100% 66%,99.5% 82%,100% 100%,88% 99.3%,72% 100%,57% 99.4%,41% 100%,26% 99.2%,11% 100%,0 99.4%,.6% 84%,0 66%,.7% 47%,0 29%,.5% 13%)}
.stamp{position:absolute;z-index:1;top:22px;right:-10px;transform:rotate(9deg);font:700 12px ui-monospace,Menlo,monospace;letter-spacing:.24em;color:#a3322a;
border:2px solid #a3322acc;padding:6px 10px 5px 12px;border-radius:3px;background:#f6e6c4e6;box-shadow:0 1px 2px #5a2a1a33}
.eyebrow{font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;color:#7a5a36;margin:0 0 10px}
h1{font-weight:400;font-size:34px;line-height:1.05;letter-spacing:-.02em;margin:0 0 12px;color:#2e1f12}
p{margin:0 0 20px;font-size:16px;line-height:1.5;color:#5a4128}p b{color:#a3322a;font-weight:600}
.people{display:grid;gap:8px;margin:0 0 18px}
button{font:inherit;cursor:pointer}
.people button{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:10px 14px;border:1px solid #9b7a4a66;border-radius:4px;
background:linear-gradient(#fff8e6aa,#f3e2bdaa);color:#2e1f12;box-shadow:0 1px 0 #fffbe9 inset,0 2px 0 #8a6a3f33;transition:transform .08s,box-shadow .08s}
.people button:hover,.people button:focus-visible{outline:none;border-color:#8a5a2a;box-shadow:0 0 0 2px #c78a3a55,0 2px 0 #8a6a3f33}
.people button:active{transform:translateY(1px);box-shadow:0 1px 0 #fffbe9 inset}
.initial{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;font-size:18px;color:#fbe9c4;
background:radial-gradient(circle at 35% 30%,#c0473b,#8e2a22 70%);box-shadow:0 0 0 2px #8e2a2255,0 2px 3px #4a1a1255 inset}
.who{display:grid;gap:1px}.who b{font-weight:600;font-size:17px}.who i{font-size:13.5px;color:#7a5a36}
.foot{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid #9b7a4a55;padding-top:14px;font-size:13px;color:#7a5a36}
.decline{border:0;background:none;color:#7a3a2a;text-decoration:underline;text-underline-offset:3px;padding:6px 0}
@media(max-width:420px){.card{padding:28px 20px 20px}h1{font-size:29px}.stamp{right:-4px;top:14px;font-size:10px}p{font-size:15px}}
</style></head><body><main class="sheet"><div class="stamp">SIMULATED</div><div class="card">
<p class="eyebrow">Development sign-in</p><h1>Who is walking in?</h1>
<p>This stands in for Twitch while Chatdom is built. <b>No Twitch account is used</b>, and these people exist only in the simulated kingdom.</p>
<form method="post" action="${SIMULATED_OIDC_PATH}/approve">${hidden}<input type="hidden" name="decision" value="allow"><div class="people">${people}</div></form>
<form method="post" action="${SIMULATED_OIDC_PATH}/approve" class="foot">${hidden}<span>Signing in grants no Twitch access.</span><button class="decline" name="decision" value="deny">Decline</button></form>
</div></main></body></html>`;
}
