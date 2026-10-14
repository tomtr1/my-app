import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In the plain browser dev build there is no native HTTP layer, so cross-origin
// requests (RSS, ICS, OAuth token exchange) go through this dev-only proxy.
// Native builds (Tauri/Capacitor) never use it — they fetch through Rust / iOS networking.
function devProxy(): Plugin {
  return {
    name: 'lifedash-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__proxy', async (req, res) => {
        try {
          const target = new URL(req.url ?? '', 'http://x').searchParams.get('url');
          if (!target || !/^https?:\/\//.test(target)) throw new Error('missing url');
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (k.startsWith('x-fwd-') && typeof v === 'string') headers[k.slice(6)] = v;
          }
          const r = await fetch(target, {
            method: req.method,
            headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          });
          res.statusCode = r.status;
          res.setHeader('content-type', r.headers.get('content-type') ?? 'application/octet-stream');
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          res.statusCode = 502;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devProxy()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1200 },
  test: { environment: 'jsdom', setupFiles: ['src/test-setup.ts'] },
});
