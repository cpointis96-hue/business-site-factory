import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../../src/app.mjs';
import { createLocalServer } from '../../src/http/server.mjs';
import { createMemorySecretStore } from '../../src/providers/memory-secret-store.mjs';

function request(base, route, options = {}) { return new Promise((resolve, reject) => { const url = new URL(route, base); const req = http.request(url, { ...options, headers: { origin: base, ...options.headers } }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) })); }); req.on('error', reject); if (options.body) req.write(options.body); req.end(); }); }

test('vertical slice secret -> prompt -> workflow -> artefact -> reprise', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-e2e-')); const secretStore = createMemorySecretStore(); const app = createApp({ dataDir: root, secretStore, adapters: { openai: async () => {} } }); const server = createLocalServer({ app }); const address = await server.listen(); const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await request(base, '/api/providers/openai/secret', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'sk-e2e-secret' }) })).status, 200);
    assert.equal((await request(base, '/api/providers/openai/test', { method: 'POST' })).body.health, 'healthy');
    const markdown = '---\nid: copywriter\nname: Copywriter\nownerStep: S7\noutputContract: copy-draft\n---\nRéponds avec les faits autorisés.';
    const current = await request(base, '/api/prompts/copywriter');
    const saved = await request(base, '/api/prompts/copywriter/draft', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown, expectedHash: current.body.draftHash }) }); const version = await request(base, '/api/prompts/copywriter/versions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedDraftHash: saved.body.hash }) }); await request(base, '/api/prompts/copywriter/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ versionId: version.body.id }) });
    const run = await request(base, '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workflowId: 'domain-research', input: { query: 'restaurant pattaya' } }) }); assert.equal(run.status, 201); assert.equal(run.body.status, 'SUCCEEDED'); assert.equal(run.body.steps.every(step => step.outputHash), true); assert.equal((await readFile(path.join(root, `runs/${run.body.id}/steps/domain-candidates/step-run.json`), 'utf8')).includes('candidates'), true);
  } finally { await server.close(); }
  const reloaded = createApp({ dataDir: root, secretStore }); const reloadedServer = createLocalServer({ app: reloaded }); const newAddress = await reloadedServer.listen(); const persisted = await request(`http://127.0.0.1:${newAddress.port}`, `/api/runs/${(await reloaded.runs.list())[0].id}`); assert.equal(persisted.body.status, 'SUCCEEDED'); assert.equal((await reloaded.prompts.get('copywriter')).activeVersionId.startsWith('v-'), true); assert.equal((await readFile(path.join(root, 'state/provider-status.json'), 'utf8')).includes('sk-e2e-secret'), false); await reloadedServer.close();
});
