import { defineConfig } from 'vite';
export default defineConfig({
  base: process.env.VITE_SITE_BASE ?? '/',
  server: { proxy: { '/api': 'http://127.0.0.1:8080', '/v1': 'http://127.0.0.1:8095' } },
  build: { target: 'es2022' },
});
