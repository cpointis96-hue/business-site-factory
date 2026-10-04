import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createCliProfileRegistry } from '../../src/config/cli-profile-registry.mjs';
import { createContractRegistry } from '../../src/config/contract-registry.mjs';
import { createPromptRegistry } from '../../src/config/prompt-registry.mjs';
import { createWorkflowRegistry } from '../../src/config/workflow-registry.mjs';

test('relie workflow, prompt, contrat et profil CLI et refuse les références incohérentes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-references-'));
  try {
    const store = createAtomicStore(root);
    const contracts = createContractRegistry({ store });
    const prompts = createPromptRegistry({ store, contractRegistry: contracts });
    const cliProfiles = createCliProfileRegistry({ store });
    const workflows = createWorkflowRegistry({ store, promptRegistry: prompts, contractRegistry: contracts, cliProfileRegistry: cliProfiles });
    await contracts.save('copy-draft', { name: 'Copy draft', schema: { type: 'object' } }, { expectedHash: null });
    await prompts.saveDraft('copywriter', '---\nid: copywriter\nname: Copywriter\nownerStep: S7\noutputContract: copy-draft\n---\nRédige.', { expectedHash: null });
    await cliProfiles.save('html-crawler', { name: 'HTML crawler', profile: { command: '/usr/bin/curl', args: [], timeoutMs: 1000, maxBytes: 10000, allowedOrigins: [] } }, { expectedHash: null });
    const definition = { id: 'site-copy', name: 'Site copy', version: 1, steps: [{ id: 'copy', kind: 'ai', dependsOn: [], inputRefs: [], outputRefs: ['copy'], implementation: 'copy', timeoutMs: 1000, budget: 0, promptRef: 'copywriter', model: 'approved-model', contractRef: 'copy-draft', profile: 'html-crawler' }] };
    await workflows.save(definition.id, definition, { expectedHash: null });
    await assert.rejects(workflows.save('bad-prompt', { ...definition, id: 'bad-prompt', steps: [{ ...definition.steps[0], promptRef: 'missing' }] }, { expectedHash: null }), /Prompt introuvable/);
    await assert.rejects(workflows.save('bad-contract', { ...definition, id: 'bad-contract', steps: [{ ...definition.steps[0], contractRef: 'missing' }] }, { expectedHash: null }), /Contrat introuvable/);
    await assert.rejects(workflows.save('bad-match', { ...definition, id: 'bad-match', steps: [{ ...definition.steps[0], contractRef: 'other-contract' }] }, { expectedHash: null }), /Contrat introuvable|diffère/);
    await assert.rejects(workflows.createVersion('site-copy', { expectedDraftHash: (await workflows.get('site-copy')).hash }), /Aucune version active/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
