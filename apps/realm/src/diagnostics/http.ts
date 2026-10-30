import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import type { RealmReadiness } from './readiness';
import type { KingdomGauge, RealmDiagnostics } from './metrics';

export const HEALTH_ROUTE = '/healthz';
export const READY_ROUTE = '/readyz';

type App = uWebSocketsTransport['app'];

/**
 * `GET /healthz`: 200 while the process answers, whatever its dependencies say (restart only on this).
 * `GET /readyz`: 200 when database, sessions and writer leases all answer, 503 otherwise; the body names the
 * unready dependency, why owned actions are held, and the measured high-water marks beside their limits.
 * Both are counts and reasons only: no connection strings, tokens, people or chat.
 */
export function mountDiagnosticsRoutes(app: App, readiness: RealmReadiness, diagnostics: RealmDiagnostics, kingdoms: () => Iterable<KingdomGauge>) {
  const json = (res: Parameters<Parameters<App['get']>[1]>[0], status: string, body: unknown) => {
    res.cork(() => {
      res.writeStatus(status).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store').end(JSON.stringify(body));
    });
  };
  app.get(HEALTH_ROUTE, res => {
    const { version, alive, uptimeMs } = readiness.report();
    json(res, '200 OK', { version, alive, uptimeMs });
  });
  app.get(READY_ROUTE, res => {
    const report = readiness.report();
    json(res, report.ready ? '200 OK' : '503 Service Unavailable', { ...report, limits: diagnostics.report(kingdoms()) });
  });
}
