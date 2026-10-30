import {defineConfig} from 'vite';
export default defineConfig({build:{ssr:'src/main.ts',outDir:'dist',target:'node22',rollupOptions:{output:{entryFileNames:'codex.mjs'}}},ssr:{noExternal:true,target:'node'}});
