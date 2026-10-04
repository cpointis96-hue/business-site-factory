import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createMemorySecretStore } from '../../src/providers/memory-secret-store.mjs';
import { createProviderRegistry } from '../../src/providers/provider-registry.mjs';

async function setup(adapter = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-provider-'));
  const secretStore = createMemorySecretStore();
  return { root, store: createAtomicStore(root), secretStore, registry: createProviderRegistry({ store: createAtomicStore(root), secretStore, adapters: adapter }) };
}

test('conserve les providers autorisés et ne divulgue jamais le secret', async () => {
  const { registry, store } = await setup();
  await registry.saveSecret('openai', 'sk-test-secret');
  const provider = (await registry.list()).find(item => item.id === 'openai');
  assert.equal(provider.configured, true);
  assert.equal(JSON.stringify(provider).includes('sk-test-secret'), false);
  assert.equal(JSON.stringify(await store.readJson('state/provider-status.json', {})).includes('sk-test-secret'), false);
  assert.equal((await registry.list()).some(item => item.name.includes('Mistral')), false);
});

test('health check borné puis activation conditionnelle', async () => {
  const { registry } = await setup({ openai: async ({ secret }) => { assert.equal(secret, 'secret'); } });
  await registry.saveSecret('openai', 'secret');
  await assert.rejects(() => registry.setEnabled('openai', true));
  const checked = await registry.testConnection('openai');
  assert.equal(checked.health, 'healthy');
  assert.equal((await registry.setEnabled('openai', true)).enabled, true);
  assert.equal((await registry.testConnection('openai')).enabled, true);
});

test('échec du provider reste expurgé et désactivé', async () => {
  const { registry } = await setup({ openai: async () => { throw new Error('secret should not persist'); } });
  await registry.saveSecret('openai', 'secret');
  const result = await registry.testConnection('openai');
  assert.equal(result.health, 'unhealthy');
  assert.equal(result.enabled, false);
  assert.equal(result.lastErrorCode, 'CONNECTION_FAILED');
});

test('ignore un état sain persistant quand le credential a disparu', async () => {
  const { registry, store } = await setup();
  await store.writeJson('state/provider-status.json', { openai: { enabled: true, health: 'healthy', lastCheckedAt: '2026-08-28T00:00:00.000Z' } });
  const provider = (await registry.list()).find(item => item.id === 'openai');
  assert.equal(provider.configured, false);
  assert.equal(provider.enabled, false);
  assert.equal(provider.health, 'unknown');
  assert.equal(provider.lastCheckedAt, null);
  assert.equal(provider.lastErrorCode, null);
});

test('ne déclare jamais saine une connexion sans adaptateur réel', async () => {
  const { registry } = await setup();
  await registry.saveSecret('openai', 'secret');
  const result = await registry.testConnection('openai');
  assert.equal(result.health, 'unhealthy');
  assert.equal(result.lastErrorCode, 'ADAPTER_NOT_CONFIGURED');
  await assert.rejects(() => registry.setEnabled('openai', true));
});

test('liste les modèles uniquement pour un provider IA actif', async () => {
  const adapter = async () => {};
  adapter.models = async ({ secret }) => { assert.equal(secret, 'secret'); return [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B', secret: 'must-not-leak' }]; };
  const { registry } = await setup({ openai: adapter });
  await registry.saveSecret('openai', 'secret');
  await registry.testConnection('openai');
  await registry.setEnabled('openai', true);
  assert.deepEqual(await registry.listModels('openai'), [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }]);
  await assert.rejects(() => registry.listModels('dataforseo'), /ne propose pas de modèles IA/);
});
