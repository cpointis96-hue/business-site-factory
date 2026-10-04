import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../../src/app.mjs';
import { createLocalServer } from '../../src/http/server.mjs';
import { createRouter } from '../../src/http/router.mjs';
import { createMemorySecretStore } from '../../src/providers/memory-secret-store.mjs';
import { runSeoAudit } from '../../src/audit/seo-audit-service.mjs';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url); const req = http.request(target, { ...options, headers: options.headers }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ headers: response.headers, status: response.statusCode, text: () => Promise.resolve(Buffer.concat(chunks).toString()) })); }); req.on('error', reject); if (options.body) req.write(options.body); req.end();
  });
}

test('restitue le rapport d’un audit public par son identifiant', async () => {
  let response = null;
  let received = null;
  const route = createRouter({
    publicAudits: { async readReport(id, kind) { received = { id, kind }; return { value: '<html>rapport</html>', contentType: 'text/html; charset=utf-8' }; } },
    providers: {}, prompts: {}, workflows: {}, runs: {},
  });
  const url = new URL('http://127.0.0.1:4173/api/audits/local/audit-run-1/reports?kind=final');
  await route({ method: 'GET', url: url.pathname + url.search }, { writeHead(status, headers) { response = { status, headers }; }, end(value) { response.value = value; } }, url);
  assert.deepEqual(received, { id: 'audit-run-1', kind: 'final' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.match(response.headers['Content-Security-Policy'], /style-src 'unsafe-inline'/);
  assert.equal(response.value, '<html>rapport</html>');
});

test('API loopback refuse origine étrangère et ne divulgue pas les secrets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-')); const api = createLocalServer({ app: createApp({ dataDir: root, secretStore: createMemorySecretStore() }) }); const address = await api.listen(); const base = `http://127.0.0.1:${address.port}`;
  try {
    const bad = await request(`${base}/api/providers`, { headers: { origin: 'https://evil.example' } }); assert.equal(bad.status, 403);
    const save = await request(`${base}/api/providers/openai/secret`, { method: 'PUT', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'sk-test-secret' }) }); assert.equal(save.status, 200); assert.equal((await save.text()).includes('sk-test-secret'), false);
    const invalid = await request(`${base}/api/providers/openai/secret`, { method: 'PUT', headers: { origin: base, 'content-type': 'application/json' }, body: '{' }); assert.equal(invalid.status, 400);
    const missing = await request(`${base}/api/not-found`, { headers: { origin: base } }); assert.equal(missing.status, 404);
  } finally { await api.close(); }
});

test('expose les modèles du provider IA actif sans son secret', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-'));
  const adapter = async ({ secret }) => { assert.equal(secret, 'sk-models-secret'); };
  adapter.models = async ({ secret }) => { assert.equal(secret, 'sk-models-secret'); return [{ id: 'model-a', name: 'Model A' }]; };
  const secretStore = createMemorySecretStore();
  const api = createLocalServer({ app: createApp({ dataDir: root, secretStore, adapters: { openai: adapter } }) });
  const address = await api.listen(); const base = `http://127.0.0.1:${address.port}`;
  try {
    await request(`${base}/api/providers/openai/secret`, { method: 'PUT', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'sk-models-secret' }) });
    await request(`${base}/api/providers/openai/test`, { method: 'POST', headers: { origin: base } });
    await request(`${base}/api/providers/openai/enabled`, { method: 'PUT', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    const response = await request(`${base}/api/providers/openai/models`, { headers: { origin: base } });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), [{ id: 'model-a', name: 'Model A' }]);
    assert.equal(body.includes('sk-models-secret'), false);
  } finally { await api.close(); }
});

test('sert les modules du cockpit avec un type JavaScript', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-'));
  const api = createLocalServer({ app: createApp({ dataDir: root, secretStore: createMemorySecretStore() }), staticRoot: path.resolve('app') });
  const address = await api.listen();
  try {
    const response = await request(`http://127.0.0.1:${address.port}/app.mjs`);
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /^text\/javascript/);
    const image = await request(`http://127.0.0.1:${address.port}/assets/brand-rock.png`);
    assert.equal(image.status, 200);
    assert.equal(image.headers['content-type'], 'image/png');
  } finally { await api.close(); }
});

test('crée, versionne et active un workflow via l’API', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-'));
  const api = createLocalServer({ app: createApp({ dataDir: root, secretStore: createMemorySecretStore() }) });
  const address = await api.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const definition = { id: 'audit-simple', name: 'Audit simple', version: 1, steps: [{ id: 'collecte', kind: 'deterministic', trigger: 'start', dependsOn: [], inputRefs: [], outputRefs: ['faits'], implementation: 'collect-query', timeoutMs: 1000, budget: 0, approval: 'none' }] };
  try {
    const savedResponse = await request(`${base}/api/workflows/audit-simple/draft`, { method: 'PUT', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ definition, expectedHash: null }) });
    assert.equal(savedResponse.status, 200);
    const saved = JSON.parse(await savedResponse.text());
    const versionResponse = await request(`${base}/api/workflows/audit-simple/versions`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ expectedDraftHash: saved.hash }) });
    const version = JSON.parse(await versionResponse.text());
    assert.equal(versionResponse.status, 200);
    const activeResponse = await request(`${base}/api/workflows/audit-simple/activate`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ versionId: version.id }) });
    assert.equal(activeResponse.status, 200);
    assert.equal(JSON.parse(await activeResponse.text()).activeVersionId, version.id);
  } finally { await api.close(); }
});

test('préserve toutes les valeurs éditables d’un workflow lors de la sauvegarde', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-'));
  const api = createLocalServer({ app: createApp({ dataDir: root, secretStore: createMemorySecretStore() }) });
  const address = await api.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const definition = { id: 'full-workflow', name: 'Workflow complet', version: 3, outputTemplateId: 'site-preview', limits: { urls: 10, minutes: 7, megabytes: 18, dollars: 1.25 }, steps: [{ id: 'analyse', kind: 'ai', trigger: 'start', dependsOn: [], inputRefs: ['dossier'], outputRefs: ['rapport', 'preuves'], implementation: 'provider-chat', promptRef: 'audit-analyst', contractRef: 'audit-report', timeoutMs: 2400, budget: 0.4, approval: 'none', actor: 'analyste', provider: 'openai', model: 'gpt-test', profile: '' }] };
  try {
    const savedResponse = await request(`${base}/api/workflows/full-workflow/draft`, { method: 'PUT', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ definition, expectedHash: null }) });
    assert.equal(savedResponse.status, 200);
    const saved = JSON.parse(await savedResponse.text());
    assert.deepEqual(saved.limits, definition.limits);
    assert.deepEqual(saved.steps[0], definition.steps[0]);
    const reloaded = await request(`${base}/api/workflows/full-workflow`, { headers: { origin: base } });
    assert.deepEqual(JSON.parse(await reloaded.text()).steps[0], definition.steps[0]);
  } finally { await api.close(); }
});

test('relie les routes contrat, prompt et profil CLI à un workflow', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-'));
  const api = createLocalServer({ app: createApp({ dataDir: root, secretStore: createMemorySecretStore() }) });
  const address = await api.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { origin: base, 'content-type': 'application/json' };
  try {
    const contractResponse = await request(`${base}/api/contracts/site-output/draft`, { method: 'PUT', headers, body: JSON.stringify({ name: 'Sortie site', schema: { type: 'object', required: ['title'] }, expectedHash: null }) });
    assert.equal(contractResponse.status, 200);
    const contract = JSON.parse(await contractResponse.text());
    const contractVersionResponse = await request(`${base}/api/contracts/site-output/versions`, { method: 'POST', headers, body: JSON.stringify({ expectedDraftHash: contract.draftHash }) });
    const contractVersion = JSON.parse(await contractVersionResponse.text());
    await request(`${base}/api/contracts/site-output/activate`, { method: 'POST', headers, body: JSON.stringify({ versionId: contractVersion.id }) });

    const profileResponse = await request(`${base}/api/cli-profiles/html-crawler/draft`, { method: 'PUT', headers, body: JSON.stringify({ name: 'HTML crawler', profile: { command: '/usr/bin/curl', args: ['--fail'], timeoutMs: 1000, maxBytes: 10000, allowedOrigins: ['https://example.test'] }, expectedHash: null }) });
    assert.equal(profileResponse.status, 200);
    const profile = JSON.parse(await profileResponse.text());
    const profileVersionResponse = await request(`${base}/api/cli-profiles/html-crawler/versions`, { method: 'POST', headers, body: JSON.stringify({ expectedDraftHash: profile.draftHash }) });
    const profileVersion = JSON.parse(await profileVersionResponse.text());
    await request(`${base}/api/cli-profiles/html-crawler/activate`, { method: 'POST', headers, body: JSON.stringify({ versionId: profileVersion.id }) });

    const markdown = '---\nid: site-copy\nname: Site copy\nownerStep: S7\noutputContract: site-output\n---\nRédige la sortie.';
    const promptResponse = await request(`${base}/api/prompts/site-copy/draft`, { method: 'PUT', headers, body: JSON.stringify({ markdown, expectedHash: null }) });
    assert.equal(promptResponse.status, 200);
    const prompt = JSON.parse(await promptResponse.text());
    const promptVersionResponse = await request(`${base}/api/prompts/site-copy/versions`, { method: 'POST', headers, body: JSON.stringify({ expectedDraftHash: prompt.hash }) });
    const promptVersion = JSON.parse(await promptVersionResponse.text());
    await request(`${base}/api/prompts/site-copy/activate`, { method: 'POST', headers, body: JSON.stringify({ versionId: promptVersion.id }) });

    const definition = { id: 'connected-workflow', name: 'Workflow connecté', version: 1, steps: [{ id: 'copy', kind: 'ai', trigger: 'start', dependsOn: [], inputRefs: [], outputRefs: ['site'], implementation: 'copy', promptRef: 'site-copy', model: 'approved-model', contractRef: 'site-output', profile: 'html-crawler', timeoutMs: 1000, budget: 0, approval: 'none' }] };
    const workflowResponse = await request(`${base}/api/workflows/connected-workflow/draft`, { method: 'PUT', headers, body: JSON.stringify({ definition, expectedHash: null }) });
    assert.equal(workflowResponse.status, 200);
    const workflow = JSON.parse(await workflowResponse.text());
    const versionResponse = await request(`${base}/api/workflows/connected-workflow/versions`, { method: 'POST', headers, body: JSON.stringify({ expectedDraftHash: workflow.hash }) });
    assert.equal(versionResponse.status, 200);
  } finally { await api.close(); }
});

test('expose la simulation client via l’API et permet la reprise', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-')); const api = createLocalServer({ app: createApp({ dataDir: root, secretStore: createMemorySecretStore() }) }); const address = await api.listen(); const base = `http://127.0.0.1:${address.port}`;
  try {
    const start = await request(`${base}/api/simulations/client-site`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ profile: { name: 'Maison Sillage' }, fault: 'site-build' }) }); assert.equal(start.status, 201); const failed = JSON.parse(await start.text()); assert.equal(failed.status, 'FAILED');
    const resumed = await request(`${base}/api/simulations/client-site/${failed.id}/resume`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{}' }); assert.equal(resumed.status, 200); assert.equal(JSON.parse(await resumed.text()).status, 'SUCCEEDED');
    const second = await request(`${base}/api/simulations/client-site`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ profile: { name: 'Maison Générique' }, fault: 'site-build' }) }); const secondFailed = JSON.parse(await second.text());
    const genericResume = await request(`${base}/api/runs/${secondFailed.id}/resume`, { method: 'POST', headers: { origin: base } }); assert.equal(genericResume.status, 200); assert.equal(JSON.parse(await genericResume.text()).status, 'SUCCEEDED');
  } finally { await api.close(); }
});

test('reçoit un intake, crée le dossier, exécute son run et sert ses artefacts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-'));
  let opened = null;
  const app = createApp({ dataDir: root, secretStore: createMemorySecretStore(), opener: async (target, options) => { opened = { target, options }; } });
  const api = createLocalServer({ app });
  const address = await api.listen();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const intake = await request(`${base}/api/intake/dossiers`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Le Rivage', city: 'Nantes', story: 'Texte client', menu: [{ name: 'Bar grillé', price: 22 }] }) });
    assert.equal(intake.status, 201);
    const dossier = JSON.parse(await intake.text());
    const listed = await request(`${base}/api/dossiers`, { headers: { origin: base } });
    assert.equal(JSON.parse(await listed.text())[0].id, dossier.id);

    const runResponse = await request(`${base}/api/dossiers/${dossier.id}/runs`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(runResponse.status, 201);
    const run = JSON.parse(await runResponse.text());
    assert.equal(run.status, 'SUCCEEDED');
    const events = await request(`${base}/api/runs/${run.id}/events`, { headers: { origin: base } });
    assert.deepEqual(JSON.parse(await events.text()).map(event => event.type).filter(type => ['RUN_STARTED', 'RUN_FINISHED'].includes(type)), ['RUN_STARTED', 'RUN_FINISHED']);

    const artifacts = await request(`${base}/api/runs/${run.id}/artifacts`, { headers: { origin: base } });
    assert.deepEqual(JSON.parse(await artifacts.text()).map(item => item.kind).sort(), ['gmb-report', 'seo-report', 'site']);
    const gmbReport = await request(`${base}/api/runs/${run.id}/artifacts/gmb-report`, { headers: { origin: base } });
    assert.equal(gmbReport.status, 200);
    assert.match(await gmbReport.text(), /AUDIT GMB/);
    const seoReport = await request(`${base}/api/runs/${run.id}/artifacts/seo-report`, { headers: { origin: base } });
    assert.equal(seoReport.status, 200);
    assert.match(await seoReport.text(), /AUDIT SEO ET CONCURRENCE/);
    const site = await request(`${base}/api/runs/${run.id}/artifacts/site`, { headers: { origin: base } });
    assert.equal(site.status, 200);
    assert.match(await site.text(), /Le Rivage/);

    const decision = await request(`${base}/api/runs/${run.id}/decision`, { method: 'PUT', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'APPROVED' }) });
    const decided = JSON.parse(await decision.text());
    assert.equal(decided.operatorDecision.decision, 'APPROVED');
    assert.match(decided.presentation.href, /^\/demo\/[A-Za-z0-9_-]{40,}$/);
    const demo = await request(`${base}${decided.presentation.href}`);
    assert.equal(demo.status, 200);
    assert.equal(demo.headers['x-robots-tag'], 'noindex, nofollow');
    assert.match(await demo.text(), /Le Rivage/);
    const missingDemo = await request(`${base}/demo/not-a-real-token`);
    assert.equal(missingDemo.status, 404);
    const resource = await request(`${base}/api/workflows/client-site-simulation/resources/open`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ stepId: 'content-plan', field: 'inputRefs', reference: 'dossier-validation' }) });
    assert.equal(resource.status, 200);
    assert.equal(opened.target, path.resolve('src/simulation/client-site-simulation.mjs'));
    assert.deepEqual(opened.options, { reveal: true });
    const open = await request(`${base}/api/dossiers/${dossier.id}/open`, { method: 'POST', headers: { origin: base } });
    assert.equal(open.status, 200);
    assert.deepEqual(opened, { target: path.join(root, 'dossiers', dossier.id), options: undefined });
  } finally { await api.close(); }
});

test('expose un audit SEO local, son rapport, puis le recharge', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-http-audit-'));
  const fetchImpl = async url => ({
    url,
    status: 200,
    headers: { get: name => name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null },
    text: async () => '<!doctype html><html lang="fr"><head><title>Maison Sillage</title><meta name="description" content="Restaurant"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com/"><script type="application/ld+json">{}</script></head><body><h1>Maison Sillage</h1></body></html>',
  });
  const auditRunner = input => runSeoAudit({ ...input, fetchImpl, lookup: async () => ['93.184.216.34'] });
  const app = createApp({ dataDir: root, secretStore: createMemorySecretStore(), auditRunner });
  const server = createLocalServer({ app });
  const address = await server.listen();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const createdResponse = await request(`${base}/api/audits/seo`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'idempotency-key': 'audit-route-1' }, body: JSON.stringify({ target: 'https://example.com', observedAt: '2026-08-27T00:00:00.000Z' }) });
    assert.equal(createdResponse.status, 201);
    const created = JSON.parse(await createdResponse.text());
    assert.match(created.id, /^audit-/);
    assert.equal(created.status, 'SUCCEEDED');
    assert.equal(Object.hasOwn(created, 'html'), false);
    assert.equal(created.crawlSummary.pagesCompleted, 1);

    const replayResponse = await request(`${base}/api/audits/seo`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'idempotency-key': 'audit-route-1' }, body: JSON.stringify({ target: 'https://example.com', observedAt: '2026-08-27T00:00:00.000Z' }) });
    assert.equal(replayResponse.status, 201);
    assert.equal(JSON.parse(await replayResponse.text()).id, created.id);

    const listed = await request(`${base}/api/audits/seo`, { headers: { origin: base } });
    assert.deepEqual(JSON.parse(await listed.text()).map(item => item.id), [created.id]);
    const report = await request(`${base}/api/audits/seo/${created.id}/report`, { headers: { origin: base } });
    assert.equal(report.status, 200);
    assert.match(report.headers['content-type'], /^text\/html/);
    const reportBody = await report.text();
    assert.match(reportBody, /https:\/\/example\.com\//);
    assert.equal(reportBody.includes('Maison Sillage'), false);
  } finally {
    await server.close();
  }

  const reloaded = createApp({ dataDir: root, secretStore: createMemorySecretStore(), auditRunner });
  const reloadedServer = createLocalServer({ app: reloaded });
  const reloadedAddress = await reloadedServer.listen();
  try {
    const persisted = await request(`http://127.0.0.1:${reloadedAddress.port}/api/audits/seo`, { headers: { origin: `http://127.0.0.1:${reloadedAddress.port}` } });
    assert.equal(JSON.parse(await persisted.text()).length, 1);
  } finally {
    await reloadedServer.close();
  }
});
