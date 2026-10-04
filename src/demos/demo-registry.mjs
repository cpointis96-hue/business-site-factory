import { createHash, randomBytes } from 'node:crypto';
import { ConflictError, NotFoundError } from '../core/errors.mjs';

const INDEX_PATH = 'demos/index.json';
const tokenHash = token => createHash('sha256').update(token, 'utf8').digest('hex');

export function createDemoRegistry({ store, artifacts, runs, clock = () => new Date(), ttlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
  async function create(runId) {
    const run = await runs.get(runId);
    if (run && (run.status !== 'SUCCEEDED' || run.operatorDecision?.decision !== 'APPROVED')) throw new ConflictError('La démo exige une validation opérateur.');
    const site = await artifacts.read(runId, 'site');
    const token = randomBytes(32).toString('base64url');
    const now = clock();
    const record = { runId, artifactHash: site.hash, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString(), revokedAt: null };
    const index = await store.readJson(INDEX_PATH, {});
    await store.writeJson(INDEX_PATH, { ...index, [tokenHash(token)]: record }, { expectedHash: (await store.readText(INDEX_PATH, null)) === null ? null : store.hashText(await store.readText(INDEX_PATH)) });
    return { token, runId, expiresAt: record.expiresAt, href: `/demo/${token}` };
  }

  async function read(token) {
    const record = (await store.readJson(INDEX_PATH, {}))[tokenHash(token)];
    if (!record || record.revokedAt || new Date(record.expiresAt).getTime() <= clock().getTime()) throw new NotFoundError('Démo introuvable.');
    const site = await artifacts.read(record.runId, 'site');
    if (site.hash !== record.artifactHash) throw new ConflictError('L’artefact de la démo a changé.');
    return { ...record, value: site.value, contentType: site.contentType };
  }

  async function revoke(token) {
    const hash = tokenHash(token); const index = await store.readJson(INDEX_PATH, {}); const record = index[hash];
    if (!record) throw new NotFoundError('Démo introuvable.');
    const currentText = await store.readText(INDEX_PATH);
    await store.writeJson(INDEX_PATH, { ...index, [hash]: { ...record, revokedAt: clock().toISOString() } }, { expectedHash: store.hashText(currentText) });
    return { revoked: true };
  }

  return { create, read, revoke };
}
