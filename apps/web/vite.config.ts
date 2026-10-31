import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import solid from 'vite-plugin-solid';

// Preview runs from apps/web, while the ignored host configuration lives at the workspace root.
// Process settings still win (capture runners use isolated services); no secret is exposed to the client.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), 'CHATDOM_');
  const setting = (name: string, fallback: string) => process.env[name] ?? env[name] ?? fallback;
  const realmPreview = { target: 'http://127.0.0.1:5187', ws: true, rewrite: (path: string) => path.replace(/^\/realm-data/, '') };
  const realmTarget = setting('CHATDOM_REALM_TARGET', 'http://127.0.0.1:5191');
  const realmLive = { target: realmTarget, ws: true, rewrite: (path: string) => path.replace(/^\/live-realm-data/, '') };
  const proxies = { '/live-realm-data': realmLive, '/realm-data': realmPreview,
    '/api/realm/founded': realmTarget, '/api/realm/entry': realmTarget, '/api/realm/watch': realmTarget,
    '/api': setting('CHATDOM_API_TARGET', 'http://127.0.0.1:5192'), '/forge-data': 'http://127.0.0.1:5195',
    '/map-data': 'http://127.0.0.1:5193', '/presence-data': 'http://127.0.0.1:5194' };
  return { plugins: [solid()], server: { proxy: proxies }, preview: { proxy: proxies }, build: { target: 'es2022' } };
});
