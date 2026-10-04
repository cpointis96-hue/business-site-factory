import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ConflictError } from '../../src/core/errors.mjs';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createCliProfileRegistry } from '../../src/config/cli-profile-registry.mjs';

test('persiste, versionne et active un profil CLI borné', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-cli-'));
  try {
    const registry = createCliProfileRegistry({ store: createAtomicStore(root), clock: () => new Date('2026-08-27T10:00:00.000Z') });
    const profile = { command: '/usr/local/bin/crawler', args: ['--html'], timeoutMs: 1000, maxBytes: 10000, allowedOrigins: ['https://example.test'] };
    const saved = await registry.save('crawler', { name: 'Crawler borné', profile }, { expectedHash: null });
    const version = await registry.createVersion('crawler', { expectedDraftHash: saved.draftHash });
    const active = await registry.activate('crawler', version.id);
    assert.equal(active.activeVersionId, version.id);
    assert.deepEqual(active.profile, profile);
    await assert.rejects(registry.createVersion('crawler', { expectedDraftHash: 'sha256:stale' }), ConflictError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
