import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../../src/app.mjs';
import { createLocalServer } from '../../src/http/server.mjs';
import { createMemorySecretStore } from '../../src/providers/memory-secret-store.mjs';

function request(url, options = {}) { return new Promise((resolve, reject) => { const req = http.request(new URL(url), { ...options, headers: options.headers }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, text: () => Promise.resolve(Buffer.concat(chunks).toString()) })); }); req.on('error', reject); if (options.body) req.write(options.body); req.end(); }); }

test('le workbench local produit un rapport et un site de démo', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-workbench-')); const app = createApp({ dataDir: root, secretStore: createMemorySecretStore(), auditRunner: async ({ target }) => ({ status: 'PARTIAL', target, observedAt: '2026-08-28T00:00:00.000Z', ruleVersion: 'test', summary: { pagesAnalyzed: 1, pagesSkipped: 1 }, findings: [] }) }); const server = createLocalServer({ app }); const address = await server.listen(); const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await request(`${base}/api/demo/workbench/audits`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Maison Sillage', city: { id: 'city-fr-nantes', label: 'Nantes', countryCode: 'FR' }, domain: 'https://example.com', menu: [{ name: 'Plat', price: '14 €' }] }) });
    assert.equal(response.status, 201); const record = JSON.parse(await response.text()); assert.equal(record.mode, 'DEMO_ONLY'); assert.equal(record.audit.status, 'PARTIAL');
    const site = await request(`${base}${record.artifacts.siteHref}`, { headers: { origin: base } }); assert.equal(site.status, 200); assert.match(await site.text(), /Maison Sillage/);
  } finally { await server.close(); }
});
