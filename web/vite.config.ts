import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
  // Development serves the same generated runtime configuration as production.
  plugins: [react(), {
    name: 'runtime-deployment',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!/^\/(imd-deployment\.json|abi\/[A-Za-z]+\.json)$/.test(req.url ?? '')) return next();
        const { readFile } = await import('node:fs/promises');
        try {
          res.setHeader('Content-Type', 'application/json');
          res.end(await readFile(new URL(`../dist${req.url}`, import.meta.url)));
        } catch { next(); }
      });
    },
  }],
});
