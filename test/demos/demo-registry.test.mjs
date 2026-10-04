import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createDemoRegistry } from '../../src/demos/demo-registry.mjs';

test('crée une présentation privée approuvée, expirante et révocable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-demos-'));
  let now = new Date('2026-08-27T10:00:00.000Z');
  const runs = { get: async () => ({ id: 'run-1', status: 'SUCCEEDED', operatorDecision: { decision: 'APPROVED' } }) };
  const artifacts = { read: async () => ({ hash: 'sha256:site', value: '<html><head></head><body>demo</body></html>', contentType: 'text/html; charset=utf-8' }) };
  const demos = createDemoRegistry({ store: createAtomicStore(root), artifacts, runs, clock: () => now });
  const created = await demos.create('run-1');
  assert.match(created.token, /^[A-Za-z0-9_-]{40,}$/); assert.equal(created.href, `/demo/${created.token}`);
  const visible = await demos.read(created.token); assert.match(visible.value, /demo/); assert.equal(visible.runId, 'run-1');
  now = new Date(created.expiresAt); await assert.rejects(() => demos.read(created.token), /Démo introuvable/);
});

test('refuse de créer une présentation avant validation opérateur', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-demos-'));
  const demos = createDemoRegistry({ store: createAtomicStore(root), artifacts: { read: async () => ({ hash: 'hash', value: '', contentType: 'text/html' }) }, runs: { get: async () => ({ status: 'SUCCEEDED', operatorDecision: null }) } });
  await assert.rejects(() => demos.create('run-1'), /validation opérateur/);
});
