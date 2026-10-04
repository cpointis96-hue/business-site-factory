import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors.mjs';
import { assertResourceId } from '../core/ids.mjs';

const STATUS_PATH = 'state/provider-status.json';
const defaultsUrl = new URL('../../fixtures/defaults/providers.json', import.meta.url);
const SECRET_REF = id => `provider:${id}`;

async function defaultDefinitions() { return JSON.parse(await readFile(fileURLToPath(defaultsUrl), 'utf8')); }

export function createProviderRegistry({ store, secretStore, adapters = {}, clock = () => new Date(), definitions = null }) {
  async function defs() { return definitions ?? defaultDefinitions(); }
  async function statuses() { return store.readJson(STATUS_PATH, {}); }
  async function list() {
    const [items, status] = await Promise.all([defs(), statuses()]);
    return Promise.all(items.map(async item => {
      const configured = await secretStore.has(SECRET_REF(item.id));
      return {
        ...item,
        configured,
        enabled: configured && Boolean(status[item.id]?.enabled),
        health: configured ? status[item.id]?.health ?? 'unknown' : 'unknown',
        lastCheckedAt: configured ? status[item.id]?.lastCheckedAt ?? null : null,
        lastErrorCode: configured ? status[item.id]?.lastErrorCode ?? null : null,
      };
    }));
  }
  async function getDefinition(id) { const item = (await defs()).find(entry => entry.id === id); if (!item) throw new NotFoundError(`Provider introuvable : ${id}`); return item; }
  async function saveStatus(id, next) {
    const current = await statuses();
    const existing = current[id] ?? {};
    await store.writeJson(STATUS_PATH, { ...current, [id]: { ...existing, ...next } }, { expectedHash: (await store.readText(STATUS_PATH, null)) === null ? null : store.hashText(await store.readText(STATUS_PATH)) });
  }
  async function saveSecret(id, secret) {
    assertResourceId(id, 'providerId'); await getDefinition(id);
    if (typeof secret !== 'string' || secret.trim().length < 3) throw new ValidationError('Secret invalide.');
    await secretStore.set(SECRET_REF(id), secret.trim());
    await saveStatus(id, { enabled: false, health: 'unknown', lastCheckedAt: null, lastErrorCode: null });
    return (await list()).find(item => item.id === id);
  }
  async function deleteSecret(id) { await getDefinition(id); await secretStore.delete(SECRET_REF(id)); await saveStatus(id, { enabled: false, health: 'unknown', lastCheckedAt: null, lastErrorCode: null }); return (await list()).find(item => item.id === id); }
  async function testConnection(id, { timeoutMs = 8000, secretOverride = null } = {}) {
    const definition = await getDefinition(id); const secret = secretOverride ?? await secretStore.get(SECRET_REF(id));
    if (!secret) throw new ValidationError('Secret absente.');
    const adapter = adapters[id];
    const wasEnabled = Boolean((await statuses())[id]?.enabled);
    const started = Date.now();
    let health = 'healthy'; let lastErrorCode = null;
    try {
      let timer;
      try {
        if (!adapter) throw Object.assign(new Error('adapter unavailable'), { code: 'ADAPTER_NOT_CONFIGURED' });
        await Promise.race([Promise.resolve(adapter({ secret, definition })), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), timeoutMs); })]);
      } finally { clearTimeout(timer); }
    } catch (error) { health = 'unhealthy'; lastErrorCode = error.code?.startsWith('DATAFORSEO_') ? error.code : error.code === 'TIMEOUT' ? 'TIMEOUT' : error.code === 'ADAPTER_NOT_CONFIGURED' ? 'ADAPTER_NOT_CONFIGURED' : error.code?.startsWith('HTTP_') ? `${error.code}${error.providerCode ? `_${error.providerCode}` : ''}` : 'CONNECTION_FAILED'; }
    await saveStatus(id, { health, lastCheckedAt: clock().toISOString(), lastErrorCode, enabled: health === 'healthy' ? wasEnabled : false });
    return { ...(await list()).find(item => item.id === id), durationMs: Date.now() - started };
  }
  async function setEnabled(id, enabled) {
    const provider = (await list()).find(item => item.id === id); if (!provider) throw new NotFoundError(`Provider introuvable : ${id}`);
    if (enabled && (!provider.configured || provider.health !== 'healthy')) throw new ConflictError('Le provider doit être configuré et testé avec succès.');
    await saveStatus(id, { enabled: Boolean(enabled) }); return (await list()).find(item => item.id === id);
  }
  async function executionContext(id) {
    const provider = (await list()).find(item => item.id === id);
    if (!provider) throw new NotFoundError(`Provider introuvable : ${id}`);
    if (!provider.configured || provider.health !== 'healthy' || !provider.enabled) throw new ConflictError(`Le provider ${id} doit être configuré, testé et activé.`);
    const secret = await secretStore.get(SECRET_REF(id));
    if (!secret) throw new ValidationError('Secret provider absent.');
    return { provider, secret };
  }
  async function listModels(id) {
    const definition = await getDefinition(id);
    if (definition.kind !== 'ai') throw new ValidationError(`Le provider ${id} ne propose pas de modèles IA.`);
    const { secret } = await executionContext(id);
    const adapter = adapters[id];
    if (typeof adapter?.models !== 'function') throw Object.assign(new ValidationError(`Découverte des modèles indisponible pour le provider ${id}.`), { code: 'MODEL_DISCOVERY_UNAVAILABLE' });
    const models = await adapter.models({ secret, definition });
    if (!Array.isArray(models)) throw Object.assign(new ValidationError('Réponse de modèles invalide.'), { code: 'MODEL_DISCOVERY_INVALID' });
    return models.map(model => ({ id: String(model.id ?? '').trim(), name: String(model.name ?? model.id ?? '').trim() })).filter(model => model.id && model.name);
  }
  return { deleteSecret, executionContext, list, listModels, saveSecret, setEnabled, testConnection };
}
