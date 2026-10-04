import { ConflictError, NotFoundError, ValidationError } from '../core/errors.mjs';
import { assertResourceId } from '../core/ids.mjs';

const INDEX_PATH = 'config/templates/index.json';
const draftPath = id => `config/templates/${id}/draft.html`;
const manifestPath = id => `config/templates/${id}/manifest.json`;
const versionPath = (id, versionId) => `config/templates/${id}/versions/${versionId}.html`;

function versionStamp(date) { return date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); }

export function createTemplateRegistry({ store, clock = () => new Date() }) {
  async function ensureIndexed(id) {
    const currentText = await store.readText(INDEX_PATH, null);
    const current = currentText === null ? [] : JSON.parse(currentText);
    if (current.includes(id)) return;
    await store.writeJson(INDEX_PATH, [...current, id].sort(), { expectedHash: currentText === null ? null : store.hashText(currentText) });
  }

  async function get(id) {
    assertResourceId(id, 'templateId');
    const content = await store.readText(draftPath(id), null);
    if (content === null) throw new NotFoundError(`Template introuvable : ${id}`);
    const manifest = await store.readJson(manifestPath(id), { id, name: id, versions: [], activeVersionId: null });
    return { ...manifest, id, content, draftHash: store.hashText(content) };
  }

  async function list() {
    const ids = await store.readJson(INDEX_PATH, []);
    return Promise.all(ids.map(get));
  }

  async function getActiveVersion(id) {
    const template = await get(id);
    if (!template.activeVersionId) throw new ValidationError(`Aucune version active pour le template : ${id}`);
    const version = template.versions.find(item => item.id === template.activeVersionId);
    if (!version) throw new NotFoundError(`Version active introuvable pour le template : ${id}`);
    const content = await store.readText(versionPath(id, version.id), null);
    if (content === null) throw new NotFoundError(`Contenu de version introuvable pour le template : ${id}`);
    return { id, versionId: version.id, hash: version.hash, content };
  }

  async function save(id, { name, content }, { expectedHash } = {}) {
    assertResourceId(id, 'templateId');
    if (typeof content !== 'string' || !content.trim() || content.length > 25 * 1024 * 1024) throw new ValidationError('Template vide ou trop volumineux.');
    const result = await store.writeText(draftPath(id), content, { expectedHash });
    await ensureIndexed(id);
    const current = await store.readJson(manifestPath(id), null);
    const manifest = { id, name: String(name || id).trim().slice(0, 100), versions: current?.versions ?? [], activeVersionId: current?.activeVersionId ?? null, updatedAt: clock().toISOString() };
    const currentText = await store.readText(manifestPath(id), null);
    await store.writeJson(manifestPath(id), manifest, { expectedHash: currentText === null ? null : store.hashText(currentText) });
    return { ...manifest, content, draftHash: result.hash };
  }

  async function createVersion(id, { expectedDraftHash }) {
    const template = await get(id);
    if (template.draftHash !== expectedDraftHash) throw new ConflictError(undefined, { currentHash: template.draftHash });
    const versionId = `v-${versionStamp(clock())}-${template.draftHash.slice(-8)}`;
    if (template.versions.some(version => version.id === versionId)) return template.versions.find(version => version.id === versionId);
    await store.writeText(versionPath(id, versionId), template.content, { immutable: true });
    const version = { id: versionId, hash: template.draftHash, createdAt: clock().toISOString() };
    const manifest = await store.readJson(manifestPath(id));
    const currentText = await store.readText(manifestPath(id));
    await store.writeJson(manifestPath(id), { ...manifest, versions: [...manifest.versions, version], updatedAt: clock().toISOString() }, { expectedHash: store.hashText(currentText) });
    return version;
  }

  async function activate(id, versionId) {
    assertResourceId(versionId, 'versionId');
    const template = await get(id);
    if (!template.versions.some(version => version.id === versionId)) throw new NotFoundError(`Version introuvable : ${versionId}`);
    const currentText = await store.readText(manifestPath(id));
    await store.writeJson(manifestPath(id), { ...template, content: undefined, draftHash: undefined, activeVersionId: versionId, updatedAt: clock().toISOString() }, { expectedHash: store.hashText(currentText) });
    return get(id);
  }

  async function remove(id) {
    assertResourceId(id, 'templateId');
    await get(id);
    const { rm } = await import('node:fs/promises');
    await rm(store.resolveSafe(`config/templates/${id}`), { recursive: true, force: false });
    const currentText = await store.readText(INDEX_PATH);
    const ids = (JSON.parse(currentText) ?? []).filter(item => item !== id);
    await store.writeJson(INDEX_PATH, ids, { expectedHash: store.hashText(currentText) });
    return { id, removed: true };
  }

  return { activate, createVersion, get, getActiveVersion, list, remove, save };
}
