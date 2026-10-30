import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
export default defineConfig({ plugins: [solid()], server: { proxy: { '/map-data': 'http://127.0.0.1:5193' } }, preview: { proxy: { '/map-data': 'http://127.0.0.1:5193' } }, build: { target: 'es2022' } });
