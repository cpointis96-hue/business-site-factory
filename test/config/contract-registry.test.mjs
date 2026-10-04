import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createContractRegistry, normalizeContractId } from '../../src/config/contract-registry.mjs';

test('persiste, versionne et active un contrat JSON Schema', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-contracts-'));
  try {
    const registry = createContractRegistry({ store: createAtomicStore(root), clock: () => new Date('2026-08-27T10:00:00.000Z') });
    const schema = { type: 'object', required: ['title'], properties: { title: { type: 'string' } } };
    const saved = await registry.save('site-output', { name: 'Sortie site', schema }, { expectedHash: null });
    const version = await registry.createVersion('site-output', { expectedDraftHash: saved.draftHash });
    const active = await registry.activate('site-output', version.id);
    assert.equal(active.activeVersionId, version.id);
    assert.equal(active.schema.$id, 'site-output');
    assert.equal(normalizeContractId('contracts/site-output.schema.json'), 'site-output');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
