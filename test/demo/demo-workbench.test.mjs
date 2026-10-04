import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createDemoWorkbench } from '../../src/demo/demo-workbench.mjs';

test('crée un audit et une démo locale à partir de faits fournis', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-workbench-')); const workbench = createDemoWorkbench({ store: createAtomicStore(root), auditRunner: async ({ target }) => ({ status: 'SUCCEEDED', target, observedAt: '2026-08-28T00:00:00.000Z', ruleVersion: 'test', summary: { pagesAnalyzed: 1, pagesSkipped: 0 }, findings: [] }) });
  const result = await workbench.create({ name: 'Maison <Sillage>', city: { id: 'city-fr-nantes', label: 'Nantes', countryCode: 'fr' }, domain: 'https://example.com', story: 'Cuisine fournie', menu: [{ name: 'Plat', price: '14 €' }] });
  assert.equal(result.mode, 'DEMO_ONLY'); assert.equal(result.gmb.status, 'PARTIAL'); assert.match((await workbench.readArtifact(result.id, 'report')).value, /Rapport d’audit SEO/); const site = (await workbench.readArtifact(result.id, 'site')).value; assert.match(site, /Maison &lt;Sillage&gt;/); assert.match(site, /14 €/); assert.equal(site.includes('Cuisine fournie'), true);
});

test('accepte une identité sans domaine et refuse un domaine non public', async () => {
  const workbench = createDemoWorkbench({ store: createAtomicStore(await mkdtemp(path.join(tmpdir(), 'ancrage-workbench-'))), auditRunner: async () => ({}) });
  const result = await workbench.create({ name: 'Maison', city: { id: 'city', label: 'Nantes', countryCode: 'FR' } });
  assert.equal(result.audit.status, 'PARTIAL');
  assert.equal(result.domain, null);
  await assert.rejects(() => workbench.create({ name: 'Maison', city: { id: 'city', label: 'Nantes', countryCode: 'FR' }, domain: 'http://localhost:3000' }), error => error.code === 'INVALID_TARGET' || error.code === 'VALIDATION_ERROR');
});
