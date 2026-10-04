import { createHash } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors.mjs';
import { assertResourceId, createId } from '../core/ids.mjs';
import { renderSeoAuditReport } from './audit-report.mjs';
import { runSeoAudit } from './seo-audit-service.mjs';

const INDEX_PATH = 'audits/index.json';
const IDEMPOTENCY_PATH = key => `audits/idempotency/${createHash('sha256').update(key).digest('hex')}.json`;

function auditPath(id, suffix) {
  return `audits/${id}/${suffix}`;
}

export function createSeoAuditRegistry({ store, runner = runSeoAudit, renderer = renderSeoAuditReport, clock = () => new Date(), idFactory = prefix => createId(prefix, clock()) }) {
  async function addToIndex(id) {
    const currentText = await store.readText(INDEX_PATH, null);
    const current = currentText === null ? [] : JSON.parse(currentText);
    if (current.includes(id)) return;
    await store.writeJson(INDEX_PATH, [...current, id].sort(), { expectedHash: currentText === null ? null : store.hashText(currentText) });
  }

  async function get(id) {
    assertResourceId(id, 'auditId');
    const audit = await store.readJson(auditPath(id, 'audit.json'), null);
    if (!audit) throw new NotFoundError(`Audit introuvable : ${id}`);
    return audit;
  }

  async function create({ target, observedAt = clock().toISOString(), profile = {}, idempotencyKey } = {}) {
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200)) throw new ValidationError('idempotencyKey est invalide.', { field: 'idempotencyKey' });
    const fingerprint = JSON.stringify({ target, observedAt, profile });
    if (idempotencyKey) {
      const path = IDEMPOTENCY_PATH(idempotencyKey.trim());
      const previous = await store.readJson(path, null);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ConflictError('La clé d’idempotence est déjà associée à une autre requête.');
        return get(previous.auditId);
      }
    }
    const audit = await runner({ target, observedAt, profile });
    const id = idFactory('audit');
    const createdAt = clock().toISOString();
    const stored = { ...audit, id, createdAt, updatedAt: createdAt };
    await store.writeJson(auditPath(id, 'audit.json'), stored, { immutable: true });
    await store.writeText(auditPath(id, 'report.html'), renderer(stored), { immutable: true });
    await addToIndex(id);
    if (idempotencyKey) await store.writeJson(IDEMPOTENCY_PATH(idempotencyKey.trim()), { fingerprint, auditId: id }, { immutable: true });
    return stored;
  }

  async function list() {
    const ids = await store.readJson(INDEX_PATH, []);
    const audits = await Promise.all(ids.map(get));
    return audits.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function readReport(id) {
    const audit = await get(id);
    const value = await store.readText(auditPath(audit.id, 'report.html'), null);
    if (value === null) throw new NotFoundError('Rapport d’audit introuvable.');
    return { value, contentType: 'text/html; charset=utf-8', auditId: audit.id };
  }

  return { create, get, list, readReport };
}
