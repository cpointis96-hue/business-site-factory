import { ConflictError, NotFoundError, ValidationError } from '../core/errors.mjs';
import { assertResourceId } from '../core/ids.mjs';

const INDEX_PATH = 'config/contracts/index.json';
const schemaPath = id => `config/contracts/${id}.schema.json`;
const manifestPath = id => `config/contracts/${id}/manifest.json`;
const versionPath = (id, versionId) => `config/contracts/${id}/versions/${versionId}.schema.json`;

function versionStamp(date) { return date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); }

export function normalizeContractId(value) {
  return String(value ?? '').replace(/^contracts\//, '').replace(/\.schema\.json$/, '');
}

function validateSchema(id, schema) {
  assertResourceId(id, 'contractId');
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new ValidationError('Schéma de contrat invalide.');
  if (schema.$id !== undefined && (typeof schema.$id !== 'string' || normalizeContractId(schema.$id) !== id)) throw new ValidationError('Le $id du contrat ne correspond pas à son identifiant.');
  if (schema.type !== undefined && typeof schema.type !== 'string') throw new ValidationError('Le type du contrat est invalide.');
  return { ...schema, $id: id };
}

export function createContractRegistry({ store, clock = () => new Date() } = {}) {
  async function ensureIndexed(id) {
    const currentText = await store.readText(INDEX_PATH, null);
    const current = currentText === null ? [] : JSON.parse(currentText);
    if (current.includes(id)) return;
    await store.writeJson(INDEX_PATH, [...current, id].sort(), { expectedHash: currentText === null ? null : store.hashText(currentText) });
  }

  async function get(id) {
    assertResourceId(id, 'contractId');
    const text = await store.readText(schemaPath(id), null);
    if (text === null) throw new NotFoundError(`Contrat introuvable : ${id}`);
    const schema = JSON.parse(text);
    const manifest = await store.readJson(manifestPath(id), { id, name: schema.title ?? id, activeVersionId: null, versions: [] });
    return { ...manifest, id, schema: validateSchema(id, schema), draftHash: store.hashText(text) };
  }

  async function list() {
    const ids = await store.readJson(INDEX_PATH, []);
    return Promise.all(ids.map(get));
  }

  async function getActiveVersion(id) {
    const contract = await get(id);
    if (!contract.activeVersionId) throw new ValidationError(`Aucune version active pour le contrat : ${id}`);
    const version = contract.versions.find(item => item.id === contract.activeVersionId);
    if (!version) throw new NotFoundError(`Version active introuvable pour le contrat : ${id}`);
    const schema = await store.readJson(versionPath(id, version.id), null);
    if (!schema) throw new NotFoundError(`Schéma de version introuvable pour le contrat : ${id}`);
    return { id, versionId: version.id, hash: version.hash, schema: validateSchema(id, schema) };
  }

  async function save(id, { name, schema }, { expectedHash } = {}) {
    const validated = validateSchema(id, schema);
    const result = await store.writeJson(schemaPath(id), validated, { expectedHash });
    await ensureIndexed(id);
    const currentManifest = await store.readJson(manifestPath(id), null);
    const manifest = { id, name: String(name || validated.title || id).trim().slice(0, 100), activeVersionId: currentManifest?.activeVersionId ?? null, versions: currentManifest?.versions ?? [], updatedAt: clock().toISOString() };
    const currentText = await store.readText(manifestPath(id), null);
    await store.writeJson(manifestPath(id), manifest, { expectedHash: currentText === null ? null : store.hashText(currentText) });
    return { ...manifest, id, schema: validated, draftHash: result.hash };
  }

  async function ensure(id, name = id) {
    assertResourceId(id, 'contractId');
    const current = await store.readJson(schemaPath(id), null);
    if (current === null) throw new NotFoundError(`Contrat introuvable : ${id}`);
    await ensureIndexed(id);
    const existing = await store.readJson(manifestPath(id), null);
    if (!existing) await store.writeJson(manifestPath(id), { id, name, activeVersionId: null, versions: [], updatedAt: clock().toISOString() }, { expectedHash: null });
    const contract = await get(id);
    if (!contract.activeVersionId) {
      const version = await createVersion(id, { expectedDraftHash: contract.draftHash });
      return activate(id, version.id);
    }
    return contract;
  }

  async function createVersion(id, { expectedDraftHash }) {
    const contract = await get(id);
    if (contract.draftHash !== expectedDraftHash) throw new ConflictError(undefined, { currentHash: contract.draftHash });
    const versionId = `v-${versionStamp(clock())}-${contract.draftHash.slice(-8)}`;
    const existing = contract.versions.find(version => version.id === versionId);
    if (existing) return existing;
    await store.writeJson(versionPath(id, versionId), contract.schema, { immutable: true });
    const version = { id: versionId, hash: contract.draftHash, createdAt: clock().toISOString() };
    const manifest = await store.readJson(manifestPath(id));
    const currentText = await store.readText(manifestPath(id));
    await store.writeJson(manifestPath(id), { ...manifest, versions: [...manifest.versions, version], updatedAt: clock().toISOString() }, { expectedHash: store.hashText(currentText) });
    return version;
  }

  async function activate(id, versionId) {
    assertResourceId(versionId, 'versionId');
    const contract = await get(id);
    if (!contract.versions.some(version => version.id === versionId)) throw new NotFoundError(`Version introuvable : ${versionId}`);
    const currentText = await store.readText(manifestPath(id));
    await store.writeJson(manifestPath(id), { id, name: contract.name, activeVersionId: versionId, versions: contract.versions, activatedAt: clock().toISOString(), updatedAt: clock().toISOString() }, { expectedHash: store.hashText(currentText) });
    return get(id);
  }

  return { activate, createVersion, ensure, get, getActiveVersion, list, save };
}
