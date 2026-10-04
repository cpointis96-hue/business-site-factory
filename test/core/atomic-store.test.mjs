import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { ConflictError, PathViolationError } from '../../src/core/errors.mjs';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';

let rootDir;
let store;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), 'ancrage-store-'));
  store = createAtomicStore(rootDir);
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

test('refuse les chemins hors du répertoire de données', () => {
  assert.throws(() => store.resolveSafe('../secret'), PathViolationError);
  assert.throws(() => store.resolveSafe('/tmp/secret'), PathViolationError);
  assert.throws(() => store.resolveSafe('config//secret'), PathViolationError);
});

test('écrit et relit du texte avec un hash stable', async () => {
  const written = await store.writeText('config/prompts/a.md', 'version 1');

  assert.match(written.hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(await store.readText('config/prompts/a.md'), 'version 1');
  assert.equal(written.hash, store.hashText('version 1'));
});

test('écrit et relit un fichier binaire atomiquement', async () => {
  const value = Buffer.from([0, 1, 2, 255]);
  const written = await store.writeBuffer('dossiers/dossier-test/assets/photo.bin', value, { expectedHash: null });

  assert.match(written.hash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(await store.readBuffer('dossiers/dossier-test/assets/photo.bin'), value);
  await assert.rejects(() => store.writeBuffer('dossiers/dossier-test/assets/photo.bin', value, { expectedHash: null }), ConflictError);
});

test('détecte une écriture concurrente avec expectedHash', async () => {
  await store.writeText('config/prompts/a.md', 'version 1');

  await assert.rejects(
    store.writeText('config/prompts/a.md', 'version 2', {
      expectedHash: 'sha256:stale',
    }),
    ConflictError,
  );

  assert.equal(await store.readText('config/prompts/a.md'), 'version 1');
});

test('refuse de remplacer un fichier immuable', async () => {
  await store.writeText('runs/RUN-1/run-manifest.json', '{}', { immutable: true });

  await assert.rejects(
    store.writeText('runs/RUN-1/run-manifest.json', '{"changed":true}', {
      immutable: true,
    }),
    ConflictError,
  );
});

test('écrit du JSON et journalise en JSON Lines', async () => {
  await store.writeJson('state/status.json', { state: 'ready' });
  await store.appendJsonLine('runs/RUN-1/events.jsonl', { type: 'RUN_STARTED' });
  await store.appendJsonLine('runs/RUN-1/events.jsonl', { type: 'RUN_SUCCEEDED' });

  assert.deepEqual(await store.readJson('state/status.json'), { state: 'ready' });
  const events = await readFile(store.resolveSafe('runs/RUN-1/events.jsonl'), 'utf8');
  assert.deepEqual(
    events.trim().split('\n').map(line => JSON.parse(line)),
    [{ type: 'RUN_STARTED' }, { type: 'RUN_SUCCEEDED' }],
  );
});

test('retourne les valeurs de repli pour un fichier absent', async () => {
  assert.equal(await store.readText('missing.txt', null), null);
  assert.deepEqual(await store.readJson('missing.json', []), []);
});
