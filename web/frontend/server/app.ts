import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

export const app = new Hono();

app.use('*', async (c, next) => {
  await next();
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('Cross-Origin-Embedder-Policy', 'require-corp');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  const path = new URL(c.req.url).pathname;
  if (path === '/sw.js' || path.endsWith('.html') || path === '/') {
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else if (path.startsWith('/assets/')) {
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  }
});

app.get('/api/health', c => c.json({ ok: true }));

// Reject former recording endpoints before static serving and the SPA fallback.
for (const route of ['/api', '/api/*', '/admin', '/admin/*', '/storage', '/storage/*']) {
  app.all(route, c => c.json({ error: 'Not found' }, 404));
}
app.use('/*', serveStatic({ root: './dist' }));
app.get('/*', serveStatic({ root: './dist', path: 'index.html' }));
