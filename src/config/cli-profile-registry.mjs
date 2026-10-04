import { ConflictError, NotFoundError, ValidationError } from '../core/errors.mjs';
import { assertResourceId } from '../core/ids.mjs';

const INDEX_PATH = 'config/cli-profiles/index.json';
const profilePath = id => `config/cli-profiles/${id}.json`;
const manifestPath = id => `config/cli-profiles/${id}/manifest.json`;
const versionPath = (id, versionId) => `config/cli-profiles/${id}/versions/${versionId}.json`;

function versionStamp(date) { return date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); }

function validateProfile(id, profile) {
  assertResourceId(id, 'cliProfileId');
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new ValidationError('Profil CLI invalide.');
  if (typeof profile.command !== 'string' || !profile.command.trim() || profile.command.length > 200) throw new ValidationError('Commande CLI invalide.');
  if (profile.args !== undefined && (!Array.isArray(profile.args) || profile.args.some(arg => typeof arg !== 'string' || arg.length > 500))) throw new ValidationError('Arguments CLI invalides.');
  if (!Number.isInteger(profile.timeoutMs) || profile.timeoutMs < 100 || profile.timeoutMs > 900000) throw new ValidationError('Timeout CLI invalide.');
  if (!Number.isInteger(profile.maxBytes) || profile.maxBytes < 1 || profile.maxBytes > 25 * 1024 * 1024) throw new ValidationError('Limite CLI invalide.');
  if (profile.allowedOrigins !== undefined && (!Array.isArray(profile.allowedOrigins) || profile.allowedOrigins.some(origin => typeof origin !== 'string' || origin.length > 200))) throw new ValidationError('Origines autorisées invalides.');
  return { command: profile.command.trim(), args: profile.args ?? [], timeoutMs: profile.timeoutMs, maxBytes: profile.maxBytes, allowedOrigins: profile.allowedOrigins ?? [] };
}

export function createCliProfileRegistry({ store, clock = () => new Date() } = {}) {
  async function ensureIndexed(id) {
    const currentText = await store.readText(INDEX_PATH, null);
    const current = currentText === null ? [] : JSON.parse(currentText);
    if (current.includes(id)) return;
    await store.writeJson(INDEX_PATH, [...current, id].sort(), { expectedHash: currentText === null ? null : store.hashText(currentText) });
  }

  async function get(id) {
    assertResourceId(id, 'cliProfileId');
    const text = await store.readText(profilePath(id), null);
    if (text === null) throw new NotFoundError(`Profil CLI introuvable : ${id}`);
    const profile = JSON.parse(text);
    const manifest = await store.readJson(manifestPath(id), { id, name: id, activeVersionId: null, versions: [] });
    return { ...manifest, id, profile: validateProfile(id, profile), draftHash: store.hashText(text) };
  }

  async function list() {
    const ids = await store.readJson(INDEX_PATH, []);
    return Promise.all(ids.map(get));
  }

  async function save(id, { name, profile }, { expectedHash } = {}) {
    const validated = validateProfile(id, profile);
    const result = await store.writeJson(profilePath(id), validated, { expectedHash });
    await ensureIndexed(id);
    const currentManifest = await store.readJson(manifestPath(id), null);
    const manifest = { id, name: String(name || id).trim().slice(0, 100), activeVersionId: currentManifest?.activeVersionId ?? null, versions: currentManifest?.versions ?? [], updatedAt: clock().toISOString() };
    const currentText = await store.readText(manifestPath(id), null);
    await store.writeJson(manifestPath(id), manifest, { expectedHash: currentText === null ? null : store.hashText(currentText) });
    return { ...manifest, id, profile: validated, draftHash: result.hash };
  }

  async function createVersion(id, { expectedDraftHash }) {
    const profile = await get(id);
    if (profile.draftHash !== expectedDraftHash) throw new ConflictError(undefined, { currentHash: profile.draftHash });
    const versionId = `v-${versionStamp(clock())}-${profile.draftHash.slice(-8)}`;
    const existing = profile.versions.find(version => version.id === versionId);
    if (existing) return existing;
    await store.writeJson(versionPath(id, versionId), profile.profile, { immutable: true });
    const version = { id: versionId, hash: profile.draftHash, createdAt: clock().toISOString() };
    const manifest = await store.readJson(manifestPath(id));
    const currentText = await store.readText(manifestPath(id));
    await store.writeJson(manifestPath(id), { ...manifest, versions: [...manifest.versions, version], updatedAt: clock().toISOString() }, { expectedHash: store.hashText(currentText) });
    return version;
  }

  async function activate(id, versionId) {
    assertResourceId(versionId, 'versionId');
    const profile = await get(id);
    if (!profile.versions.some(version => version.id === versionId)) throw new NotFoundError(`Version introuvable : ${versionId}`);
    const currentText = await store.readText(manifestPath(id));
    await store.writeJson(manifestPath(id), { id, name: profile.name, activeVersionId: versionId, versions: profile.versions, activatedAt: clock().toISOString(), updatedAt: clock().toISOString() }, { expectedHash: store.hashText(currentText) });
    return get(id);
  }

  return { activate, createVersion, get, list, save };
}
