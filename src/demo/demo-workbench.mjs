import { createHash } from 'node:crypto';
import { NotFoundError, ValidationError } from '../core/errors.mjs';
import { createId } from '../core/ids.mjs';
import { renderSeoAuditReport } from '../audit/audit-report.mjs';
import { runSeoAudit } from '../audit/seo-audit-service.mjs';

const INDEX_PATH = 'demo-workbench/index.json';
const recordPath = id => `demo-workbench/${id}/record.json`;
const artifactPath = (id, kind) => `demo-workbench/${id}/${kind}.html`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function text(value, field, max = 500) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > max) throw new ValidationError(`${field} est invalide.`, { field });
  return value.trim();
}

function domain(value) {
  const raw = text(value, 'domain', 2048); let parsed;
  try { parsed = new URL(raw); } catch { throw new ValidationError('domain est invalide.', { field: 'domain' }); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) throw new ValidationError('domain est invalide.', { field: 'domain' });
  return parsed.toString().replace(/\/$/, '');
}

function menu(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new ValidationError('menu est invalide.', { field: 'menu' });
  return value.map((item, index) => ({ name: text(item?.name, `menu.${index}.name`, 160), price: text(item?.price, `menu.${index}.price`, 80) })).filter(item => item.name);
}

function renderSite(profile) {
  const items = profile.menu.length ? `<section><h2>Menu</h2><ul>${profile.menu.map(item => `<li><span>${esc(item.name)}</span>${item.price ? `<strong>${esc(item.price)}</strong>` : ''}</li>`).join('')}</ul></section>` : '';
  const details = [profile.address, profile.contact].filter(Boolean).map(value => `<p>${esc(value)}</p>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>${esc(profile.name)} · Démo</title><style>body{font:16px/1.6 system-ui;max-width:820px;margin:auto;padding:32px;color:#20211f;background:#f5f5f2}header{background:#173024;color:#eef4ec;padding:32px}section{border-top:1px solid #d9dbd5;padding:24px 0}ul{padding:0;list-style:none}li{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #d9dbd5;padding:12px 0}strong{color:#496b39}</style></head><body><header><p>${esc(profile.city)}</p><h1>${esc(profile.name)}</h1></header>${profile.story ? `<section><h2>À propos</h2><p>${esc(profile.story)}</p></section>` : ''}${items}<section><h2>Informations</h2>${details || '<p>Informations à compléter.</p>'}</section></body></html>`;
}

function renderPendingReport({ name, city, observedAt }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recherche d’établissement</title><style>body{font:16px/1.55 system-ui;max-width:760px;margin:auto;padding:24px;color:#20211f;background:#f5f5f2}header{background:#173024;color:#eef4ec;padding:32px}section{border-top:1px solid #d9dbd5;padding:24px 0}small{color:#5a635c}</style></head><body><header><small>RECHERCHE LOCALE · PARTIAL</small><h1>${esc(name)}</h1><div>${esc(city)}</div></header><main><section><h2>Domaine à confirmer</h2><p>Aucun site public confirmé dans le périmètre disponible pour cette démo.</p><small>Observation : ${esc(observedAt)}</small></section></main></body></html>`;
}

export function createDemoWorkbench({ store, auditRunner = runSeoAudit, fetchImpl = globalThis.fetch, lookup, clock = () => new Date(), idFactory = prefix => createId(prefix, clock()) } = {}) {
  async function get(id) { const record = await store.readJson(recordPath(id), null); if (!record) throw new NotFoundError('Démo introuvable.'); return record; }
  async function list() { return (await store.readJson(INDEX_PATH, [])).map(project); }
  async function create(input = {}) {
    const name = text(input.name, 'name', 160); if (!name) throw new ValidationError('name est requis.', { field: 'name' });
    const city = input.city; if (!city || typeof city !== 'object') throw new ValidationError('city est invalide.', { field: 'city' });
    const normalizedCity = { id: text(city.id, 'city.id', 120), label: text(city.label, 'city.label', 160), countryCode: text(city.countryCode, 'city.countryCode', 3).toUpperCase() }; if (!normalizedCity.id || !normalizedCity.label || !normalizedCity.countryCode) throw new ValidationError('city est invalide.', { field: 'city' });
    const identity = input.identity === undefined ? null : input.identity?.source === 'google-places' && text(input.identity.placeId, 'identity.placeId', 200) ? { source: 'google-places', placeId: text(input.identity.placeId, 'identity.placeId', 200), address: text(input.identity.address, 'identity.address', 500) } : input.identity?.source === 'manual' ? { source: 'manual', address: input.identity.address ?? {} } : (() => { throw new ValidationError('identity est invalide.', { field: 'identity' }); })();
    const target = input.domain === undefined || input.domain === null || input.domain === '' ? null : domain(input.domain); const id = idFactory('demo-audit'); const observedAt = clock().toISOString();
    const audit = target
      ? await auditRunner({ target, observedAt, fetchImpl, lookup, profile: input.profile ?? {} })
      : { status: 'PARTIAL', target: `${name} · ${normalizedCity.label}`, observedAt, ruleVersion: 'not-run', summary: { pagesAnalyzed: 0, pagesSkipped: 0 }, findings: [] };
    const manualAddress = identity?.source === 'manual' && identity.address && typeof identity.address === 'object' ? [identity.address.addressLine1, identity.address.addressLine2, identity.address.postalCode, identity.address.city].filter(Boolean).join(', ') : '';
    const report = target ? renderSeoAuditReport(audit) : renderPendingReport({ name, city: normalizedCity.label, observedAt }); const profile = { name, city: normalizedCity.label, address: text(input.address ?? (typeof identity?.address === 'string' ? identity.address : manualAddress), 'address', 500), contact: text(input.contact, 'contact', 320), story: text(input.story, 'story', 12000), menu: menu(input.menu) }; const site = renderSite(profile);
    await store.writeText(artifactPath(id, 'report'), report, { immutable: true }); await store.writeText(artifactPath(id, 'site'), site, { immutable: true });
    const record = { id, mode: 'DEMO_ONLY', identity, profile, domain: target, audit: { status: audit.status, target: audit.target, observedAt: audit.observedAt, summary: audit.summary, findingCount: audit.findings.length }, gmb: { status: 'PARTIAL', cause: 'GMB_PROVIDER_NOT_CONFIGURED' }, artifacts: { reportPath: artifactPath(id, 'report'), sitePath: artifactPath(id, 'site') }, createdAt: observedAt };
    await store.writeJson(recordPath(id), record, { immutable: true }); const current = await store.readJson(INDEX_PATH, []); await store.writeJson(INDEX_PATH, [...current, record].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    return project(record);
  }
  async function readArtifact(id, kind) { const record = await get(id); const path = record.artifacts[`${kind}Path`]; if (!path) throw new NotFoundError('Artefact introuvable.'); const value = await store.readText(path, null); if (value === null) throw new NotFoundError('Artefact introuvable.'); return { value, contentType: 'text/html; charset=utf-8' }; }
  function project(record) { const result = JSON.parse(JSON.stringify(record)); result.artifacts = { reportHref: `/api/demo/workbench/audits/${record.id}/report`, siteHref: `/api/demo/workbench/audits/${record.id}/site` }; return result; }
  return { create, get, list, readArtifact };
}
