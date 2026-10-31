import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
const realmPreview = { target: 'http://127.0.0.1:5187', ws: true, rewrite: (path: string) => path.replace(/^\/realm-data/, '') };
const realmTarget = process.env.CHATDOM_REALM_TARGET ?? 'http://127.0.0.1:5191';
const realmLive = { target: realmTarget, ws: true, rewrite: (path: string) => path.replace(/^\/live-realm-data/, '') };
const proxies = { '/live-realm-data': realmLive, '/realm-data': realmPreview,
  '/api/realm/founded': realmTarget, '/api/realm/entry': realmTarget,
  '/api': process.env.CHATDOM_API_TARGET ?? 'http://127.0.0.1:5192', '/forge-data': 'http://127.0.0.1:5195',
  '/map-data': 'http://127.0.0.1:5193', '/presence-data': 'http://127.0.0.1:5194' };
export default defineConfig({ plugins: [solid()], server: { proxy: proxies }, preview: { proxy: proxies }, build: { target: 'es2022' } });
