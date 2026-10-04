import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createWorkflowEngine } from '../../src/workflows/workflow-engine.mjs';
import { createClientSiteSimulation, createSimulationImplementations } from '../../src/simulation/client-site-simulation.mjs';

test('simulation client : dossier, rapports progressifs, site, crash puis reprise', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-client-sim-')); const store = createAtomicStore(root); const faults = new Set(); const engine = createWorkflowEngine({ store, implementations: createSimulationImplementations({ store, faults }) }); const simulation = createClientSiteSimulation({ store, engine, faults });
  assert.deepEqual(simulation.workflowId, 'client-site-simulation');
  const definition = (await store.readJson('config/workflows/client-site-simulation.json', null)) ?? (await import('../../src/simulation/client-site-simulation.mjs')).clientSiteWorkflow;
  assert.equal(definition.steps.find(step => step.id === 'content-plan').dependsOn[0], 'seo-competition-report');
  assert.equal(definition.steps.find(step => step.id === 'site-build').dependsOn[0], 'content-plan');
  const failed = await simulation.start({ name: 'Maison Sillage', city: 'Pattaya', story: 'Texte fourni par le restaurateur.', menu: [{ name: 'Khao soi', price: 14 }] }, { fault: 'site-build' });
  assert.equal(failed.status, 'FAILED'); assert.equal(failed.steps.map(step => step.id).join(','), 'dossier-validation,gmb-audit-report,seo-competition-report,content-plan');
  await assert.rejects(() => readFile(path.join(root, `runs/${failed.id}/artifacts/site/index.html`)));
  const recovered = await simulation.resume(failed.id); assert.equal(recovered.status, 'SUCCEEDED'); assert.equal(recovered.attempts.filter(attempt => attempt.stepId === 'dossier-validation').length, 1); assert.equal(recovered.attempts.filter(attempt => attempt.stepId === 'site-build').length, 2);
  const siteSpec = await readFile(path.join(root, `runs/${failed.id}/steps/content-plan/step-run.json`), 'utf8'); const site = await readFile(path.join(root, `runs/${failed.id}/artifacts/site/index.html`), 'utf8'); const gmbReport = await readFile(path.join(root, `runs/${failed.id}/artifacts/gmb-audit-report/report.html`), 'utf8'); const seoReport = await readFile(path.join(root, `runs/${failed.id}/artifacts/seo-competition-report/report.html`), 'utf8'); assert.match(siteSpec, /site-spec-v1/); assert.match(site, /Maison Sillage/); assert.match(site, /Texte fourni par le restaurateur/); assert.match(site, /Khao soi/); assert.match(site, /data:image\/png;base64/); assert.match(site, /@media/); assert.match(gmbReport, /données publiques GMB restent à confirmer/); assert.match(seoReport, /Mots-clés locaux/); assert.match(seoReport, /rapport GMB/);
  const quality = await store.readJson(`runs/${failed.id}/steps/quality-gate/step-run.json`); assert.deepEqual(quality.output.checks, ['site-artifact', 'site-responsive', 'site-content', 'gmb-report-artifact', 'seo-report-artifact', 'seo-report-provenance']);
  const dossier = await store.readJson(`dossiers/${failed.input.dossierId}/dossier.json`); assert.equal(dossier.provenance, 'synthetic-fixture'); assert.equal((await readFile(path.join(root, `dossiers/${failed.input.dossierId}/assets/photo-1.png`))).length > 0, true); assert.equal(JSON.stringify(await store.readJson(`runs/${failed.id}/run-manifest.json`)).includes('secret'), false);
});
