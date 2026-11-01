import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({ base: '/dock/', plugins: [solid()], build: { target: 'es2022' },
  server: { proxy: { '/api': { target: process.env.CHATDOM_DOCK_API ?? 'http://127.0.0.1:5174' } } } });
