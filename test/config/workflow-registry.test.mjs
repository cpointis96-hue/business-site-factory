import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createApp } from '../../src/app.mjs';
import { createWorkflowRegistry } from '../../src/config/workflow-registry.mjs';
import { createMemorySecretStore } from '../../src/providers/memory-secret-store.mjs';
import { clientSiteWorkflow } from '../../src/simulation/client-site-simulation.mjs';

const definition = {
  id: 'audit-site',
  name: 'Audit du site',
  version: 1,
  steps: [{ id: 'collecte', kind: 'deterministic', trigger: 'start', dependsOn: [], inputRefs: [], outputRefs: ['faits'], implementation: 'collecte', timeoutMs: 1000, budget: 0, approval: 'none', contractRef: 'audit-report' }],
};

let rootDir;
let store;
let registry;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), 'ancrage-workflows-'));
  store = createAtomicStore(rootDir);
  await store.writeJson('config/contracts/audit-report.schema.json', { type: 'object' }, { expectedHash: null });
  registry = createWorkflowRegistry({ store, clock: () => new Date('2026-08-27T10:11:12.000Z') });
});

afterEach(async () => { await rm(rootDir, { recursive: true, force: true }); });

test('versionne et active un workflow sans modifier la version gelée', async () => {
  const saved = await registry.save(definition.id, definition, { expectedHash: null });
  const version = await registry.createVersion(definition.id, { expectedDraftHash: saved.hash });
  await registry.activate(definition.id, version.id);
  const changed = await registry.save(definition.id, { ...definition, name: 'Audit du site modifié', version: 2 }, { expectedHash: saved.hash });
  const active = await registry.resolveActive(definition.id);

  assert.equal(changed.name, 'Audit du site modifié');
  assert.equal(active.definition.name, 'Audit du site');
  assert.equal(active.versionId, version.id);
  assert.equal(active.hash, version.hash);
  assert.equal((await registry.list())[0].versions.length, 1);
});

test('ouvre dans Finder le fichier source associé à une entrée ou une sortie', async () => {
  let opened = null;
  registry = createWorkflowRegistry({
    store,
    clock: () => new Date('2026-08-27T10:11:12.000Z'),
    implementationFiles: { collecte: '/tmp/collecte.mjs' },
    opener: async (target, options) => { opened = { target, options }; },
  });
  await registry.save(definition.id, definition, { expectedHash: null });

  assert.deepEqual(await registry.openStepResource(definition.id, { stepId: 'collecte', field: 'outputRefs', reference: 'faits' }), {
    opened: true,
    workflowId: definition.id,
    stepId: 'collecte',
    field: 'outputRefs',
    reference: 'faits',
  });
  assert.deepEqual(opened, { target: '/tmp/collecte.mjs', options: { reveal: true } });
  await assert.rejects(() => registry.openStepResource(definition.id, { stepId: 'collecte', field: 'outputRefs', reference: 'absente' }), /Référence de workflow introuvable/);
});

test('nettoie une seule fois les champs IA et métadonnées persistés sur le workflow déterministe', async () => {
  await store.writeJson('config/workflows/client-site-simulation.json', {
    ...clientSiteWorkflow,
    hash: 'stale',
    activeVersionId: 'stale',
    versions: [],
    steps: clientSiteWorkflow.steps.map(step => ({ ...step, actor: '', provider: '' })),
  }, { expectedHash: null });

  const firstApp = createApp({ dataDir: rootDir, secretStore: createMemorySecretStore(), opener: null });
  await firstApp.ready;
  const migrated = await store.readJson('config/workflows/client-site-simulation.json');
  assert.equal(Object.hasOwn(migrated, 'hash'), false);
  assert.equal(Object.hasOwn(migrated, 'activeVersionId'), false);
  assert.equal(migrated.steps.every(step => !Object.hasOwn(step, 'actor') && !Object.hasOwn(step, 'provider')), true);
  const versionCount = (await firstApp.workflows.get('client-site-simulation')).versions.length;

  const secondApp = createApp({ dataDir: rootDir, secretStore: createMemorySecretStore(), opener: null });
  await secondApp.ready;
  assert.equal((await secondApp.workflows.get('client-site-simulation')).versions.length, versionCount);
});

test('met à jour uniquement le prompt local SEO fourni par défaut', async () => {
  const legacy = `---
id: local-seo-research-planner
name: Plan de recherche SEO locale
ownerStep: research-plan
outputContract: seo-research-plan
---
Tu prépares un plan de recherche SEO locale, pas un audit et pas une liste de mots-clés mesurés.

Utilise exclusivement les faits fournis dans l’entrée. La catégorie doit être l’une des catégories autorisées. Ne déduis jamais une catégorie depuis un type Google générique. Ne cite ni volume, ni concurrence, ni concurrent, ni position.

Retourne uniquement un objet JSON conforme au contrat. Propose de une à six requêtes françaises, courtes et utiles. Chaque requête doit contenir le nom de l’établissement ou une catégorie autorisée, et la localité fournie. Utilise \`business-name\` seulement si le nom est présent dans la requête, sinon \`observed-category\`.
`;
  await store.writeText('config/prompts/local-seo-research-planner/draft.md', legacy, { expectedHash: null });
  const app = createApp({ dataDir: rootDir, secretStore: createMemorySecretStore(), opener: null });
  await app.ready;
  const updated = await store.readText('config/prompts/local-seo-research-planner/draft.md');
  assert.match(updated, /Une requête générique sans localité/);

  const custom = updated.replace('Une requête générique sans localité, ou une requête de spécialité non observée, est interdite.', 'Ma règle personnalisée.');
  await store.writeText('config/prompts/local-seo-research-planner/draft.md', custom, { expectedHash: store.hashText(updated) });
  const reloaded = createApp({ dataDir: rootDir, secretStore: createMemorySecretStore(), opener: null });
  await reloaded.ready;
  assert.equal(await store.readText('config/prompts/local-seo-research-planner/draft.md'), custom);
});
