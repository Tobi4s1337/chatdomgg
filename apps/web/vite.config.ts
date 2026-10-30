import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
export default defineConfig({ plugins: [solid()], server: { proxy: { '/api':'http://127.0.0.1:5192','/forge-data':'http://127.0.0.1:5195','/map-data': 'http://127.0.0.1:5193', '/presence-data':'http://127.0.0.1:5194' } }, preview: { proxy: { '/api':'http://127.0.0.1:5192','/forge-data':'http://127.0.0.1:5195','/map-data': 'http://127.0.0.1:5193','/presence-data':'http://127.0.0.1:5194' } }, build: { target: 'es2022' } });
