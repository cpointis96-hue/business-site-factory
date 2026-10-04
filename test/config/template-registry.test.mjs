import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createTemplateRegistry } from '../../src/config/template-registry.mjs';

test('persiste, versionne, active et supprime un template local', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-templates-'));
  const registry = createTemplateRegistry({ store: createAtomicStore(root), clock: () => new Date('2026-08-27T10:00:00.000Z') });
  const saved = await registry.save('site-preview', { name: 'Site preview', content: '<main>v1</main>' }, { expectedHash: null });
  const version = await registry.createVersion('site-preview', { expectedDraftHash: saved.draftHash });
  const active = await registry.activate('site-preview', version.id);
  assert.equal(active.activeVersionId, version.id);
  assert.equal(active.content, '<main>v1</main>');
  assert.equal((await registry.list()).length, 1);
  await registry.remove('site-preview');
  assert.deepEqual(await registry.list(), []);
});
