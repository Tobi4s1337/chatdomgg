import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import type { PanelDoorReply, RealmPanelService } from './service';

type App = uWebSocketsTransport['app'];
export const REALM_PANEL_ROUTES = {
  settings: '/internal/realm/panel/settings', settingsSave: '/internal/realm/panel/settings-save',
  settingsSync: '/internal/realm/panel/settings-sync', settingsMirrorClaim: '/internal/realm/panel/settings-mirror-claim', settingsMirrorFinish: '/internal/realm/panel/settings-mirror-finish',
  settingsMirrorPermit: '/internal/realm/panel/settings-mirror-permit',
  settingsMirrorActivate: '/internal/realm/panel/settings-mirror-activate',
  giftDrain: '/internal/realm/panel/gift-drain', giftChoices: '/internal/realm/panel/gift-choices', giftResolve: '/internal/realm/panel/gift-resolve', gifts: '/internal/realm/panel/gifts', giftIntent: '/internal/realm/panel/gift-intent', giftStatus: '/internal/realm/panel/gift-status',
  giftCancel: '/internal/realm/panel/gift-cancel', giftEvidence: '/internal/realm/panel/gift-evidence',
  giftReconcile: '/internal/realm/panel/gift-reconcile', giftInbox: '/internal/realm/panel/gift-inbox',
  privacy: '/internal/realm/panel/privacy', quiet: '/internal/realm/panel/quiet', forget: '/internal/realm/panel/forget',
  claim: '/internal/realm/panel/claim', pledge: '/internal/realm/panel/pledge',
  kingdom: '/internal/realm/panel/kingdom', presence: '/internal/realm/panel/presence', scene: '/internal/realm/panel/scene/:kingdomId',
} as const;
const STATUS = { 200: '200 OK', 400: '400 Bad Request', 401: '401 Unauthorized', 503: '503 Service Unavailable' } as const;
const LIMIT = 4_096;

/** Internal service routes only: bounded JSON, a bearer gate before buffering, and no browser CORS. */
export function mountRealmPanelRoutes(app: App, panel: RealmPanelService): void {
  for (const method of ['claim', 'pledge', 'kingdom', 'presence', 'privacy', 'quiet', 'forget', 'settings', 'settingsSave', 'settingsSync', 'settingsMirrorActivate', 'settingsMirrorClaim', 'settingsMirrorFinish', 'settingsMirrorPermit', 'gifts', 'giftIntent', 'giftStatus', 'giftCancel', 'giftEvidence', 'giftReconcile', 'giftInbox', 'giftResolve', 'giftChoices', 'giftDrain'] as const) app.post(REALM_PANEL_ROUTES[method], (res, req) => {
    const authorization = req.getHeader('authorization');
    let aborted = false, finished = false, bytes = 0;
    const chunks: Buffer[] = [];
    res.onAborted(() => { aborted = true; });
    const reply = (answer: PanelDoorReply) => {
      if (aborted || finished) return;
      finished = true;
      res.cork(() => res.writeStatus(STATUS[answer.http]).writeHeader('Content-Type', 'application/json')
        .writeHeader('Cache-Control', 'no-store').writeHeader('X-Content-Type-Options', 'nosniff').end(JSON.stringify(answer.body)));
    };
    if (!panel.authenticate(authorization)) {
      reply({ http: 401, body: { version: 1, status: 'refused', message: 'Unknown panel service.' } }); return;
    }
    if (!/^application\/json\b/i.test(req.getHeader('content-type')) || Number(req.getHeader('content-length') || 0) > LIMIT) {
      reply({ http: 400, body: { version: 1, status: 'refused', message: 'Send a bounded JSON request.' } }); return;
    }
    res.onData((chunk, last) => {
      if (aborted || finished) return;
      bytes += chunk.byteLength;
      if (bytes > LIMIT) { reply({ http: 400, body: { version: 1, status: 'refused', message: 'The panel request is too large.' } }); return; }
      chunks.push(Buffer.from(chunk.slice(0)));
      if (!last) return;
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { reply({ http: 400, body: { version: 1, status: 'refused', message: 'The request is not JSON.' } }); return; }
      void panel[method](authorization, body).then(reply, () => reply({ http: 503,
        body: { version: 1, status: 'unavailable', message: 'The kingdom is not reaching the panel just now.' } }));
    });
  });
  app.get(REALM_PANEL_ROUTES.scene, (res, req) => {
    const authorization = req.getHeader('authorization'), kingdomId = req.getParameter(0) ?? '';
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    void panel.scene(authorization, kingdomId).then(answer => {
      if (aborted) return;
      res.cork(() => {
        if (answer instanceof Uint8Array) res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json')
          .writeHeader('Cache-Control', 'no-store').writeHeader('X-Content-Type-Options', 'nosniff').end(answer);
        else res.writeStatus(STATUS[answer.http]).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store')
          .end(JSON.stringify(answer.body));
      });
    });
  });
}
