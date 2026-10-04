import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { ConflictError, ValidationError } from '../../src/core/errors.mjs';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createPromptRegistry } from '../../src/config/prompt-registry.mjs';

const prompt = `---
id: copywriter
name: Copywriter
ownerStep: S7
outputContract: copy-draft
---
Rédige uniquement à partir des faits autorisés.
`;

let rootDir;
let store;
let registry;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), 'ancrage-prompts-'));
  store = createAtomicStore(rootDir);
  registry = createPromptRegistry({
    store,
    clock: () => new Date('2026-08-26T09:10:11.000Z'),
  });
  await store.writeJson('config/contracts/copy-draft.schema.json', { type: 'object' }, { expectedHash: null });
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

test('enregistre un brouillon Markdown et le liste', async () => {
  const saved = await registry.saveDraft('copywriter', prompt, { expectedHash: null });
  const loaded = await registry.get('copywriter');

  assert.equal(saved.hash, loaded.draftHash);
  assert.equal(loaded.markdown, prompt);
  assert.equal(loaded.name, 'Copywriter');
  assert.equal(loaded.activeVersionId, null);
  assert.deepEqual((await registry.list()).map(item => item.id), ['copywriter']);
});

test('refuse un frontmatter inconnu ou incohérent', async () => {
  await assert.rejects(
    registry.saveDraft('copywriter', prompt.replace('outputContract:', 'secretKey:'), {
      expectedHash: null,
    }),
    ValidationError,
  );
  await assert.rejects(
    registry.saveDraft('audit-analyst', prompt, { expectedHash: null }),
    ValidationError,
  );
});

test('détecte un brouillon modifié depuis son chargement', async () => {
  await registry.saveDraft('copywriter', prompt, { expectedHash: null });

  await assert.rejects(
    registry.saveDraft('copywriter', `${prompt}\nNouvelle règle.\n`, {
      expectedHash: 'sha256:stale',
    }),
    ConflictError,
  );
});

test('crée une version immuable puis l’active', async () => {
  const saved = await registry.saveDraft('copywriter', prompt, { expectedHash: null });
  const version = await registry.createVersion('copywriter', {
    expectedDraftHash: saved.hash,
  });
  const activated = await registry.activate('copywriter', version.id);

  assert.equal(version.id, `v-20260826091011-${saved.hash.slice(-8)}`);
  assert.equal(activated.activeVersionId, version.id);
  assert.equal(
    await store.readText(`config/prompts/copywriter/versions/${version.id}.md`),
    prompt,
  );
  await assert.rejects(
    store.writeText(`config/prompts/copywriter/versions/${version.id}.md`, 'écrasé', {
      immutable: true,
    }),
    ConflictError,
  );
});

test('refuse de versionner un hash de brouillon obsolète', async () => {
  await registry.saveDraft('copywriter', prompt, { expectedHash: null });
  await assert.rejects(
    registry.createVersion('copywriter', { expectedDraftHash: 'sha256:stale' }),
    ConflictError,
  );
});

test('compare le brouillon à la version active', async () => {
  const first = await registry.saveDraft('copywriter', prompt, { expectedHash: null });
  const version = await registry.createVersion('copywriter', {
    expectedDraftHash: first.hash,
  });
  await registry.activate('copywriter', version.id);
  await registry.saveDraft('copywriter', prompt.replace('faits autorisés', 'preuves validées'), {
    expectedHash: first.hash,
  });

  const diff = await registry.diff('copywriter', version.id, 'draft');
  assert.equal(diff.changed, true);
  assert.equal(diff.removed.includes('Rédige uniquement à partir des faits autorisés.'), true);
  assert.equal(diff.added.includes('Rédige uniquement à partir des preuves validées.'), true);
});
