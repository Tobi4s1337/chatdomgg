import { createRealmServer } from './server';
import { referenceServices } from './reference';

if (process.env.REALM_SIMULATED !== '1') throw new Error('Realm live entry requires the durable repository and verified session service. Use REALM_SIMULATED=1 for the labelled reference court.');
const services = referenceServices();
const { server, transport } = createRealmServer(services);
transport.app.post('/reference/session', response => {
  response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store').writeHeader('Content-Type', 'application/json').end(JSON.stringify(services.issue()));
});
const port = Number(process.env.REALM_PORT ?? 5191);
if (!Number.isInteger(port) || port < 5170 || port > 5199) throw new Error('Use a development port in 5170–5199');
await server.listen(port, '0.0.0.0');
console.info(`SIMULATED realm reference listening on ${port}`);
