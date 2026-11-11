import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import { VERSION } from './version.js';

/** The Nuntio server: a small JSON API under /api, plus the existing static site from dist/.
 * It is research only. There are no wallet, signing, trading or custody routes, by design.
 * On Vercel the site is served by its CDN from public/, so distDir is left out there.
 * @param {{ distDir?: string, version?: string }} [options] */
export function createApp({ distDir, version = VERSION } = {}) {
  const app = new Hono();

  // Browser security headers. Each HTML page also carries its own Content Security Policy.
  app.use('*', secureHeaders({ referrerPolicy: 'no-referrer', crossOriginEmbedderPolicy: false }));

  app.get('/api/health', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'ok', service: 'nuntio', version });
  });
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  // Static site (local and non Vercel hosts): hashed routes live after the #, so plain file serving is enough.
  if (distDir) {
    app.use('/*', async (c, next) => {
      await next();
      if (c.res.status === 200) c.header('Cache-Control', c.req.path.startsWith('/assets/') ? 'public, max-age=300' : 'no-cache');
    });
    app.use('/*', serveStatic({ root: distDir }));
  }
  app.notFound((c) => c.text('Not found', 404));

  // Never send internal error details to the browser.
  app.onError((error, c) => {
    console.error(`Request failed: ${c.req.method} ${c.req.path}: ${error.name}`);
    return c.json({ error: 'Something went wrong' }, 500);
  });
  return app;
}
