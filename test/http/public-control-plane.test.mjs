import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../../src/app.mjs';
import { createLocalServer } from '../../src/http/server.mjs';
import { createMemorySecretStore } from '../../src/providers/memory-secret-store.mjs';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(url), { ...options, headers: options.headers }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: () => Promise.resolve(Buffer.concat(chunks).toString()) })); });
    req.on('error', reject); if (options.body) req.write(options.body); req.end();
  });
}
const json = value => JSON.stringify(value);
const headers = base => ({ origin: base, 'content-type': 'application/json' });
const demoPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const demoImage = Buffer.from(demoPng, 'base64');

test('expose le parcours public et bloque le démarrage incomplet', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-public-')); const app = createApp({ dataDir: root, secretStore: createMemorySecretStore() }); const api = createLocalServer({ app }); const address = await api.listen(); const base = `http://127.0.0.1:${address.port}`;
  try {
    const createdResponse = await request(`${base}/api/public/requests`, { method: 'POST', headers: { ...headers(base), 'idempotency-key': 'http-request-1' }, body: json({ name: 'Maison Sillage', city: { id: 'city-fr-nantes', label: 'Nantes', countryCode: 'FR' }, identity: { source: 'manual', address: '1 rue du Port, Nantes' } }) });
    assert.equal(createdResponse.status, 201); const created = JSON.parse(await createdResponse.text());
    const replay = await request(`${base}/api/public/requests`, { method: 'POST', headers: { ...headers(base), 'idempotency-key': 'http-request-1' }, body: json({ name: 'Maison Sillage', city: { id: 'city-fr-nantes', label: 'Nantes', countryCode: 'FR' }, identity: { source: 'manual', address: '1 rue du Port, Nantes' } }) }); assert.equal(JSON.parse(await replay.text()).id, created.id);
    await request(`${base}/api/public/requests/${created.id}/match-decision`, { method: 'POST', headers: headers(base), body: json({ decision: 'CONFIRM' }) });
    const reports = await request(`${base}/api/public/requests/${created.id}/reports`, { headers: { origin: base } }); const reportBody = JSON.parse(await reports.text()); assert.equal(reports.status, 200); assert.deepEqual(reportBody.reports, []);
    const blocked = JSON.parse(await (await request(`${base}/api/public/requests/${created.id}`, { headers: { origin: base } })).text()); assert.equal(blocked.status, 'BLOCKED'); assert.equal(blocked.errors[0].code, 'AUDIT_BLOCKED');
    const preparationResponse = await request(`${base}/api/public/requests/${created.id}/preparation`, { method: 'POST', headers: { ...headers(base), 'idempotency-key': 'http-prep-1' }, body: json({ email: 'owner@example.test' }) }); assert.equal(preparationResponse.status, 409); assert.equal(JSON.parse(await preparationResponse.text()).error.code, 'REPORT_NOT_READY');
  } finally { await api.close(); }
});

test('branche la préparation complète sur le DAG de démo puis exige la validation opérateur', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-public-pipeline-')); const app = createApp({ dataDir: root, secretStore: createMemorySecretStore() }); const server = createLocalServer({ app }); const address = await server.listen(); const base = `http://127.0.0.1:${address.port}`; const city = { id: 'city-fr-nantes', label: 'Nantes', countryCode: 'FR' }; const categories = ['facade', 'signature-dish-1', 'signature-dish-2', 'interior-or-terrace', 'team-or-service'];
  try {
    const created = JSON.parse(await (await request(`${base}/api/public/requests`, { method: 'POST', headers: { ...headers(base), 'idempotency-key': 'http-pipeline-request' }, body: json({ name: 'Maison Sillage', city }) })).text()); await request(`${base}/api/public/requests/${created.id}/match-decision`, { method: 'POST', headers: headers(base), body: json({ decision: 'CONFIRM' }) }); await app.publicControlPlane.seedSyntheticReport(created.id, { kind: 'final', html: '<h1>Final</h1>', pdf: '%PDF-synthetic' });
    const preparation = JSON.parse(await (await request(`${base}/api/public/requests/${created.id}/preparation`, { method: 'POST', headers: { ...headers(base), 'idempotency-key': 'http-pipeline-preparation' }, body: json({ email: 'owner@example.test' }) })).text()); await request(`${base}/api/public/demo-requests/${preparation.id}/intake`, { method: 'PUT', headers: headers(base), body: json({ criticalComplete: true, locale: 'fr-FR', address: '1 rue du Port', contact: 'contact@example.test', story: 'Une histoire fournie.', menu: [{ name: 'Plat', price: '14' }] }) });
    for (const category of categories) await request(`${base}/api/public/demo-requests/${preparation.id}/assets`, { method: 'POST', headers: headers(base), body: json({ assetId: category, category, rightsStatus: 'AUTHORIZED', hash: `hash-${category}`, size: demoImage.length, dataUrl: `data:image/png;base64,${demoPng}` }) });
    const started = JSON.parse(await (await request(`${base}/api/public/demo-requests/${preparation.id}/start`, { method: 'POST', headers: headers(base), body: '{}' })).text()); assert.equal(started.status, 'READY_FOR_OWNER_REVIEW'); assert.match(started.pipelineRunId, /^run-/); assert.equal(started.acceptanceReport.status, 'PASS'); const generatedDossier = (await app.dossiers.list())[0]; assert.deepEqual(generatedDossier.assets.map(asset => asset.category), categories); assert.deepEqual(generatedDossier.assets.map(asset => asset.rightsStatus), categories.map(() => 'AUTHORIZED'));
    const cockpitQueue = await request(`${base}/api/public/demo-requests`, { headers: { origin: base } }); const queueBody = JSON.parse(await cockpitQueue.text()); assert.equal(cockpitQueue.status, 200); assert.equal(queueBody.length, 1); assert.equal(queueBody[0].preparation.id, preparation.id); assert.equal(queueBody[0].preparation.status, 'READY_FOR_OWNER_REVIEW');
    const presented = JSON.parse(await (await request(`${base}/api/public/demo-requests/${preparation.id}/decision`, { method: 'POST', headers: headers(base), body: json({ decision: 'APPROVED' }) })).text()); assert.equal(presented.status, 'READY_FOR_PROSPECT'); assert.match(presented.presentation.href, /^\/demo\//); const demo = await request(`${base}${presented.presentation.href}`, { headers: { origin: base } }); assert.equal(demo.status, 200); const demoHtml = await demo.text(); assert.match(demoHtml, /Maison Sillage/); assert.match(demoHtml, /id="galerie"/);
  } finally { await server.close(); }
});
