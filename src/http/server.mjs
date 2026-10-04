import http from 'node:http';
import { createRouter } from './router.mjs';

export function createLocalServer({ app, host = '127.0.0.1', port = 0, staticRoot = null }) {
  let server;
  const router = createRouter(app);
  server = http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    const address = server.address(); const expectedOrigin = `http://${host}:${address?.port ?? port}`;
    const headers = { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
    if (origin && origin !== expectedOrigin) { response.writeHead(403, headers); response.end('Forbidden'); return; }
    if ((request.url ?? '').startsWith('/api/') || (request.url ?? '').startsWith('/demo/')) { for (const [name, value] of Object.entries(headers)) response.setHeader(name, value); return router(request, response, new URL(request.url, expectedOrigin)); }
    if (staticRoot) return serveStatic(request, response, staticRoot, headers);
    response.writeHead(404, headers); response.end('Not found');
  });
  return { server, async listen() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); return server.address(); }, async close() { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}

async function serveStatic(request, response, root, headers) {
  const { readFile } = await import('node:fs/promises');
  const { extname, relative, resolve, sep } = await import('node:path');
  const staticRoot = resolve(root);
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = resolve(staticRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relativePath = relative(staticRoot, file);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.startsWith(sep)) { response.writeHead(403, headers); response.end('Forbidden'); return; }
  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
  };
  try {
    const body = await readFile(file);
    response.writeHead(200, { ...headers, 'Content-Type': contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    if (!response.headersSent) response.writeHead(404, headers);
    if (!response.writableEnded) response.end('Not found');
  }
}
