// Regression test (needs `npm i ws`): run with `node scripts/reconnect-race-test.ts` from the skill dir.
// Race: old socket closes while the session_reconnect socket hasn't sent its welcome yet.
// Expect: exactly one subscribe pass total, and the client ends on the reconnect socket's session.
import { WebSocketServer } from 'ws';
import http from 'node:http';
import { EventSubWsClient } from '../assets/templates/eventsub-ws-client.ts';
let posts = 0, conns = 0;
const api = http.createServer((req, res) => { posts++; res.writeHead(202, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'sub' + posts, type: 'stream.online', version: '1', status: 'enabled', condition: {}, transport: {}, created_at: '' }], total: 1, total_cost: 0, max_total_cost: 10 })); }).listen(9291);
const wss = new WebSocketServer({ port: 9290 });
const welcome = (id: string) => JSON.stringify({ metadata: { message_id: 'w' + id, message_type: 'session_welcome', message_timestamp: new Date().toISOString() }, payload: { session: { id, status: 'connected', keepalive_timeout_seconds: 10, reconnect_url: null, connected_at: '' } } });
wss.on('connection', (sock, req) => {
  conns++;
  if (req.url?.startsWith('/reconnect')) { setTimeout(() => sock.send(welcome('S2')), 400); return; } // delayed welcome
  sock.send(welcome('S1'));
  setTimeout(() => {
    sock.send(JSON.stringify({ metadata: { message_id: 'r1', message_type: 'session_reconnect', message_timestamp: '' }, payload: { session: { id: 'S1', status: 'reconnecting', keepalive_timeout_seconds: null, reconnect_url: 'ws://127.0.0.1:9290/reconnect', connected_at: '' } } }));
    setTimeout(() => sock.close(4004), 50); // old socket dies before the new welcome
  }, 300);
});
const logs: string[] = [];
const c = new EventSubWsClient({ clientId: 'x', getUserToken: () => 't', url: 'ws://127.0.0.1:9290/ws', helixBase: 'http://127.0.0.1:9291', subscriptions: [{ type: 'stream.online', version: '1', condition: { broadcaster_user_id: '1' } }], log: (m) => logs.push(m) });
c.start();
setTimeout(() => {
  c.stop(); wss.close(); api.close();
  const ok = posts === 1 && conns === 2 && logs.some((l) => l.includes('reconnected, session S2'));
  console.log(logs.join('\n')); console.log({ posts, conns }); console.log(ok ? 'RACE TEST PASS' : 'RACE TEST FAIL'); process.exit(ok ? 0 : 1);
}, 3500);
