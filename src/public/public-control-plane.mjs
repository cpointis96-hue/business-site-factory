import { createHash } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError, AppError } from '../core/errors.mjs';
import { createId } from '../core/ids.mjs';

const REQUEST_INDEX = 'public-control-plane/requests/index.json';
const requestPath = id => `public-control-plane/requests/${id}.json`;
const preparationPath = id => `public-control-plane/preparations/${id}.json`;
const idempotencyPath = (scope, key) => `public-control-plane/idempotency/${scope}-${createHash('sha256').update(key).digest('hex')}.json`;
const categories = new Set(['facade', 'signature-dish-1', 'signature-dish-2', 'interior-or-terrace', 'team-or-service']);
const knownRights = new Set(['OWNED', 'AUTHORIZED', 'LICENSED']);
const imageTypes = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);
const maxImageBytes = 700 * 1024;
const reportTtlMs = 7 * 24 * 60 * 60 * 1000;

const text = (value, field, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ValidationError(`${field} est invalide.`, { field });
  return value.trim();
};
const fingerprint = value => JSON.stringify(value);
const emailHash = value => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
const response = value => JSON.parse(JSON.stringify(value));
function publicDomain(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new ValidationError('domain est invalide.', { field: 'domain' });
  let parsed; try { parsed = new URL(value.trim()); } catch { throw new ValidationError('domain est invalide.', { field: 'domain' }); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) throw new ValidationError('domain est invalide.', { field: 'domain' });
  return parsed.toString().replace(/\/$/, '');
}

function publicIdentity(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object') throw new ValidationError('identity est invalide.', { field: 'identity' });
  if (value.source === 'google-places') {
    const coordinates = value.coordinates;
    if (coordinates !== undefined && (!coordinates || typeof coordinates !== 'object' || !Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude))) throw new ValidationError('identity.coordinates est invalide.', { field: 'identity.coordinates' });
    const types = Array.isArray(value.types) ? value.types.map((item, index) => text(item, `identity.types.${index}`, 120)).slice(0, 20) : [];
    const categories = Array.isArray(value.categories) ? value.categories.map((item, index) => text(item, `identity.categories.${index}`, 120)).slice(0, 20) : [];
    return {
      source: value.source,
      placeId: text(value.placeId, 'identity.placeId', 200),
      address: text(value.address, 'identity.address', 500),
      ...(coordinates ? { coordinates: { latitude: coordinates.latitude, longitude: coordinates.longitude } } : {}),
      ...(typeof value.primaryType === 'string' && value.primaryType.trim() ? { primaryType: text(value.primaryType, 'identity.primaryType', 120) } : {}),
      ...(typeof value.primaryTypeDisplayName === 'string' && value.primaryTypeDisplayName.trim() ? { primaryTypeDisplayName: text(value.primaryTypeDisplayName, 'identity.primaryTypeDisplayName', 120) } : {}),
      ...(types.length ? { types } : {}),
      ...(categories.length ? { categories } : {}),
    };
  }
  if (value.source === 'manual') return { source: value.source, address: value.address && typeof value.address === 'object' ? response(value.address) : text(value.address, 'identity.address', 500) };
  throw new ValidationError('identity est invalide.', { field: 'identity' });
}

function nextAction(kind, reasonCode) { return { kind, reasonCode }; }

function optionalText(value, field, max = 4000) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > max) throw new ValidationError(`${field} est invalide.`, { field });
  return value.trim();
}

function normalizeMenu(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new ValidationError('menu est invalide.', { field: 'menu' });
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new ValidationError('Plat invalide.', { field: `menu.${index}` });
    const name = optionalText(item.name, `menu.${index}.name`, 160);
    const priceText = String(item.price ?? '').trim().replace(',', '.');
    const price = Number(priceText.match(/^\d+(?:\.\d+)?/)?.[0] ?? NaN);
    if (!name || !Number.isFinite(price) || price < 0 || price > 100000) throw new ValidationError('Chaque plat doit avoir un nom et un prix valide.', { field: `menu.${index}` });
    return { name, price };
  });
}

function hasCriticalIntake(preparation) {
  const intake = preparation.intake ?? {};
  return Boolean(optionalText(intake.address, 'address', 500) && optionalText(intake.contact, 'contact', 320) && Array.isArray(intake.menu) && intake.menu.length > 0 && intake.menu.every(item => item?.name && Number.isFinite(item.price)));
}

export function createPublicControlPlane({ store, clock = () => new Date(), idFactory = prefix => createId(prefix, clock()), auditStarter = null, pipelineStarter = null, demoPresenter = null } = {}) {
  function checkpoint(key, status, { reportId = null, blockedReason = null, progressLabel = null } = {}) {
    const defaultLabels = { match: 'Établissement confirmé.', 'gmb-report': 'Rapport GMB disponible.', 'final-report': 'Rapport final disponible.' };
    return { key, status, validatedAt: clock().toISOString(), evidenceRefs: reportId ? [reportId] : [], progressLabel: progressLabel ?? defaultLabels[key] ?? key, ...(blockedReason ? { blockedReason } : {}) };
  }
  async function readRequest(id) {
    const value = await store.readJson(requestPath(id), null);
    if (!value) throw new NotFoundError(`Demande publique introuvable : ${id}`);
    return value;
  }
  async function saveRequest(value) { value.updatedAt = clock().toISOString(); await store.writeJson(requestPath(value.id), value); return projectRequest(value); }
  async function indexRequest(id) {
    const currentText = await store.readText(REQUEST_INDEX, null); const current = currentText === null ? [] : JSON.parse(currentText);
    if (current.includes(id)) return;
    await store.writeJson(REQUEST_INDEX, [...current, id].sort(), { expectedHash: currentText === null ? null : store.hashText(currentText) });
  }
  function projectRequest(value) {
    const result = response(value); delete result.emailHash;
    result.reports = (result.reports ?? []).map(({ id, kind, status, createdAt, expiresAt }) => ({ id, kind, status, createdAt, expiresAt }));
    if (result.demoRequestId) result.preparation = { id: result.demoRequestId, status: result.preparationStatus };
    return result;
  }
  function requireKey(key) { return text(key, 'Idempotency-Key', 200); }
  function requireFinalReport(request) { if (request.state !== 'FINAL_REPORT_READY') throw new AppError('Le rapport final n’est pas disponible.', { code: 'REPORT_NOT_READY', status: 409 }); }
  function checklist(preparation) {
    const photos = [...categories].every(category => preparation.assets.some(asset => asset.category === category));
    const rights = photos && preparation.assets.length === 5 && preparation.assets.every(asset => knownRights.has(asset.rightsStatus));
    return { ...preparation.checklist, criticalComplete: hasCriticalIntake(preparation), locale: Boolean(preparation.locale), photos, rights };
  }
  async function createRequest(input = {}) {
    const name = text(input.name, 'name'); const city = input.city;
    if (!city || typeof city !== 'object') throw new ValidationError('city est invalide.', { field: 'city' });
    const normalized = { name, city: { id: text(city.id, 'city.id', 120), label: text(city.label, 'city.label'), countryCode: text(city.countryCode, 'city.countryCode', 3).toUpperCase() }, domain: publicDomain(input.domain), identity: publicIdentity(input.identity) };
    const key = requireKey(input.idempotencyKey); const fp = fingerprint(normalized); const previous = await store.readJson(idempotencyPath('request', key), null);
    if (previous) { if (previous.fingerprint !== fp) throw new ConflictError('La clé d’idempotence est déjà associée à une autre requête.'); return projectRequest(await readRequest(previous.requestId)); }
    const now = clock().toISOString(); const request = { id: idFactory('public-request'), schemaVersion: 'public-control-plane-v1', state: 'MATCHING', status: 'RUNNING', input: normalized, reports: [], checkpoints: [], nextAction: nextAction('DECIDE_MATCH', 'MATCH_REVIEW_REQUIRED'), warnings: [], errors: [], createdAt: now, updatedAt: now };
    await store.writeJson(requestPath(request.id), request); await indexRequest(request.id); await store.writeJson(idempotencyPath('request', key), { fingerprint: fp, requestId: request.id }, { immutable: true });
    return projectRequest(request);
  }
  async function decideMatch(requestId, input = {}) {
    const request = await readRequest(requestId); const decision = text(input.decision, 'decision', 40);
    if (!['CONFIRM', 'LOCAL_PREVIEW_WITHOUT_GMB'].includes(decision)) throw new ValidationError('decision est invalide.', { field: 'decision' });
    if (decision === 'CONFIRM' && typeof auditStarter === 'function' && !request.input.identity) throw new AppError('Une identité confirmée est nécessaire pour lancer cet audit.', { code: 'MATCH_IDENTITY_REQUIRED', status: 409 });
    request.matchDecision = decision; request.state = decision === 'CONFIRM' ? 'AUDIT_IN_PROGRESS' : 'LOCAL_PREVIEW_WITHOUT_GMB'; request.checkpoints = [...(request.checkpoints ?? []).filter(item => item.key !== 'match'), checkpoint('match', 'SUCCEEDED', { progressLabel: decision === 'CONFIRM' ? 'Établissement confirmé.' : 'Aperçu local autorisé.' })]; if (decision === 'LOCAL_PREVIEW_WITHOUT_GMB') request.checkpoints.push(checkpoint('gmb-report', 'PARTIAL', { blockedReason: 'LOCAL_PREVIEW_WITHOUT_GMB', progressLabel: 'Audit GMB non exécuté.' })); request.nextAction = nextAction('WAIT', 'AUDIT_IN_PROGRESS'); await saveRequest(request);
    if (typeof auditStarter === 'function') {
      const reports = await auditStarter({ request: response(request), decision });
      if (reports?.audit) request.audit = response(reports.audit);
      if (reports?.gmb?.html) await publishReport(request, { kind: 'gmb', html: reports.gmb.html });
      if (reports?.final?.html) await publishReport(request, { kind: 'final', html: reports.final.html, pdf: reports.final.pdf });
      if (reports?.completion instanceof Promise) reports.completion.then(async finalReport => { if (finalReport?.audit) request.audit = response(finalReport.audit); if (finalReport?.html) await publishReport(request, { kind: 'final', html: finalReport.html, pdf: finalReport.pdf }); }).catch(async error => { request.status = 'PARTIAL'; request.errors.push({ code: error.code ?? 'AUDIT_COMPLETION_FAILED' }); await saveRequest(request); });
      if (!reports?.gmb?.html && !reports?.final?.html && !(reports?.completion instanceof Promise)) { request.status = reports?.audit?.status === 'BLOCKED' ? 'BLOCKED' : 'PARTIAL'; request.errors.push({ code: reports?.audit?.status === 'BLOCKED' ? 'AUDIT_BLOCKED' : 'AUDIT_REPORT_NOT_AVAILABLE' }); }
    }
    return saveRequest(request);
  }
  async function seedSyntheticReport(requestId, { kind, html, pdf = null } = {}) {
    return publishReport(await readRequest(requestId), { kind, html, pdf });
  }
  async function publishReport(request, { kind, html, pdf = null } = {}) {
    if (!['gmb', 'final'].includes(kind) || typeof html !== 'string') throw new ValidationError('Rapport invalide.');
    const reportId = idFactory(`${kind}-report`); const htmlPath = `public-control-plane/reports/${reportId}.html`; await store.writeText(htmlPath, html, { immutable: true });
    let pdfPath = null; if (kind === 'final' && typeof pdf === 'string') { pdfPath = `public-control-plane/reports/${reportId}.pdf`; await store.writeText(pdfPath, pdf, { immutable: true }); }
    const createdAt = clock(); request.reports.push({ id: reportId, kind, status: kind === 'gmb' ? 'GMB_REPORT_READY' : 'FINAL_REPORT_READY', htmlPath, pdfPath, createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + reportTtlMs).toISOString(), revokedAt: null }); const finalReady = request.reports.some(report => report.kind === 'final'); request.checkpoints = [...(request.checkpoints ?? []).filter(item => item.key !== `${kind}-report`), checkpoint(`${kind}-report`, 'SUCCEEDED', { reportId })]; request.state = finalReady ? 'FINAL_REPORT_READY' : 'GMB_REPORT_READY'; const auditStatus = request.audit?.status; request.status = finalReady ? (auditStatus === 'BLOCKED' ? 'BLOCKED' : auditStatus === 'PARTIAL' ? 'PARTIAL' : 'SUCCEEDED') : 'RUNNING'; request.nextAction = finalReady ? nextAction('PREPARE_SITE', 'FINAL_REPORT_READY') : nextAction('WAIT', 'SEO_MODULES_PENDING');
    return saveRequest(request);
  }
  async function getDemoRequest(id) { return projectPreparation(await readPreparation(id)); }
  async function listRequests() { return Promise.all((await store.readJson(REQUEST_INDEX, [])).map(async requestId => projectRequest(await readRequest(requestId)))); }
  async function listDemoRequests() { const requests = await listRequests(); return Promise.all(requests.filter(request => request.demoRequestId).map(async request => ({ request, preparation: await getDemoRequest(request.demoRequestId) }))); }
  async function listReports(requestId) { const request = await readRequest(requestId); return { requestId, state: request.state, reports: request.reports.map(({ id, kind, status, createdAt, expiresAt }) => ({ id, kind, status, createdAt, expiresAt })) }; }
  async function readReport(requestId, reportId, format = 'html') {
    const request = await readRequest(requestId); const report = request.reports.find(item => item.id === reportId); if (!report) throw new NotFoundError(); if (report.revokedAt) throw new AppError('Le rapport a été révoqué.', { code: 'REPORT_REVOKED', status: 410 }); if (report.expiresAt && new Date(report.expiresAt).getTime() <= clock().getTime()) throw new AppError('Le rapport a expiré.', { code: 'REPORT_EXPIRED', status: 410 });
    if (format === 'pdf' && (!report.pdfPath || request.state !== 'FINAL_REPORT_READY')) throw new AppError('Le PDF final n’est pas disponible.', { code: 'REPORT_NOT_READY', status: 409 });
    const path = format === 'pdf' ? report.pdfPath : report.htmlPath; const value = await store.readText(path, null); if (value === null) throw new NotFoundError(); return { value, contentType: format === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8' };
  }
  async function createPreparation(requestId, input = {}) {
    const request = await readRequest(requestId); requireFinalReport(request); const email = text(input.email, 'email', 320); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('email est invalide.', { field: 'email' });
    const key = requireKey(input.idempotencyKey); const fp = fingerprint({ requestId, emailHash: emailHash(email) }); const previous = await store.readJson(idempotencyPath('preparation', key), null); if (previous) { if (previous.fingerprint !== fp) throw new ConflictError('La clé d’idempotence est déjà associée à une autre préparation.'); return projectPreparation(await readPreparation(previous.preparationId)); }
    if (request.demoRequestId) {
      const existing = await readPreparation(request.demoRequestId);
      if (existing.emailHash !== emailHash(email)) throw new ConflictError('Cette demande de démo est déjà liée à une autre adresse e-mail.');
      await store.writeJson(idempotencyPath('preparation', key), { fingerprint: fp, preparationId: existing.id }, { immutable: true });
      return projectPreparation(existing);
    }
    const id = idFactory('demo-request'); const now = clock().toISOString(); const preparation = { id, requestId, emailHash: emailHash(email), status: 'INCOMPLETE', checklist: { criticalComplete: false, locale: false, photos: false, rights: false }, assets: [], pipelineRunId: null, createdAt: now, updatedAt: now };
    await store.writeJson(preparationPath(id), preparation); await store.writeJson(idempotencyPath('preparation', key), { fingerprint: fp, preparationId: id }, { immutable: true }); request.demoRequestId = id; request.preparationStatus = 'INCOMPLETE'; await saveRequest(request); return projectPreparation(preparation);
  }
  async function readPreparation(id) { const value = await store.readJson(preparationPath(id), null); if (!value) throw new NotFoundError(`Demande de démo introuvable : ${id}`); return value; }
  function projectPreparation(value) { const result = response(value); delete result.emailHash; for (const asset of result.assets ?? []) { delete asset.assetPath; delete asset.mimeType; } return result; }
  function requireEditable(preparation) { if (preparation.pipelineRunId) throw new ConflictError('La préparation est gelée pendant et après le pipeline.'); }
  async function savePreparation(value) { value.checklist = checklist(value); value.status = value.pipelineRunId ? (value.pipelineStatus ?? 'WEBSITE_FACTORY_RUNNING') : 'INCOMPLETE'; value.updatedAt = clock().toISOString(); await store.writeJson(preparationPath(value.id), value); return projectPreparation(value); }
  async function updateIntake(id, input = {}) { const preparation = await readPreparation(id); requireEditable(preparation); if (input.criticalComplete !== undefined && typeof input.criticalComplete !== 'boolean') throw new ValidationError('criticalComplete est invalide.', { field: 'criticalComplete' }); if (input.locale !== undefined) preparation.locale = text(input.locale, 'locale', 20); for (const field of ['address', 'contact', 'story']) if (input[field] !== undefined) preparation.intake = { ...(preparation.intake ?? {}), [field]: optionalText(input[field], field, field === 'story' ? 12000 : field === 'address' ? 500 : 320) }; if (input.menu !== undefined) preparation.intake = { ...(preparation.intake ?? {}), menu: normalizeMenu(input.menu) }; return savePreparation(preparation); }
  async function addAsset(id, input = {}) {
    const preparation = await readPreparation(id);
    requireEditable(preparation);
    const asset = { assetId: text(input.assetId, 'assetId', 120), category: text(input.category, 'category', 40), rightsStatus: text(input.rightsStatus, 'rightsStatus', 20), hash: text(input.hash, 'hash', 128), size: Number.isInteger(input.size) && input.size > 0 ? input.size : 0 };
    if (!categories.has(asset.category) || !knownRights.has(asset.rightsStatus) || !asset.size) throw new ValidationError('Asset photo invalide ou non autorisé.');
    if (preparation.assets.some(item => item.category === asset.category)) throw new ConflictError('Cette catégorie de photo est déjà renseignée.');
    if (input.dataUrl !== undefined) {
      if (typeof input.dataUrl !== 'string') throw new ValidationError('Image invalide.', { field: 'dataUrl' });
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.dataUrl);
      if (!match || !imageTypes.has(match[1])) throw new ValidationError('Format d’image non autorisé.', { field: 'dataUrl' });
      const value = Buffer.from(match[2], 'base64');
      const signature = match[1] === 'image/png'
        ? value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : match[1] === 'image/jpeg'
          ? value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff
          : value.subarray(0, 4).toString('ascii') === 'RIFF' && value.subarray(8, 12).toString('ascii') === 'WEBP';
      if (!value.length || value.length > maxImageBytes || !signature || value.length !== asset.size) throw new ValidationError('Le contenu de l’image est invalide.', { field: 'dataUrl' });
      const assetPath = `public-control-plane/preparations/${preparation.id}/assets/${asset.category}.${imageTypes.get(match[1])}`;
      await store.writeBuffer(assetPath, value, { expectedHash: null });
      asset.assetPath = assetPath;
      asset.mimeType = match[1];
    }
    preparation.assets.push(asset);
    return savePreparation(preparation);
  }
  async function start(id) { const preparation = await readPreparation(id); preparation.checklist = checklist(preparation); if (preparation.pipelineRunId) return projectPreparation(preparation); if (!preparation.checklist.criticalComplete || !preparation.checklist.locale || !preparation.checklist.photos || !preparation.checklist.rights) throw new AppError('La préparation est incomplète.', { code: 'PREPARATION_INCOMPLETE', status: 409 }); if (typeof pipelineStarter !== 'function') throw new AppError('Le pipeline de démo n’est pas configuré.', { code: 'PIPELINE_NOT_CONFIGURED', status: 503 }); const request = await readRequest(preparation.requestId); const started = await pipelineStarter({ request: response(request), preparation }); if (!started?.runId) throw new AppError('Le pipeline de démo n’a pas fourni de run vérifiable.', { code: 'PIPELINE_START_FAILED', status: 503 }); const runId = text(started.runId, 'pipelineRunId', 120); const acceptanceStatus = started.acceptanceReport?.status; if (!['PASS', 'WARN', 'BLOCK'].includes(acceptanceStatus)) { preparation.pipelineRunId = runId; preparation.pipelineStatus = 'ACCEPTANCE_REPORT_INVALID'; preparation.acceptanceReport = null; await savePreparation(preparation); throw new AppError('Le pipeline n’a pas fourni d’AcceptanceReport exploitable.', { code: 'ACCEPTANCE_REPORT_INVALID', status: 503 }); } preparation.pipelineRunId = runId; preparation.pipelineStatus = acceptanceStatus === 'BLOCK' ? 'BLOCKED' : 'READY_FOR_OWNER_REVIEW'; preparation.acceptanceReport = started.acceptanceReport; return savePreparation(preparation); }
  async function validateDemo(id, decision) { const preparation = await readPreparation(id); if (!preparation.pipelineRunId) throw new AppError('Aucun pipeline à valider.', { code: 'PIPELINE_NOT_READY', status: 409 }); if (!['APPROVED', 'CHANGES_REQUESTED'].includes(decision)) throw new ValidationError('Décision opérateur invalide.'); if (preparation.status !== 'READY_FOR_OWNER_REVIEW') throw new AppError('La démo n’est pas prête pour la validation opérateur.', { code: 'DEMO_NOT_READY_FOR_REVIEW', status: 409 }); if (decision === 'APPROVED' && preparation.acceptanceReport?.status === 'BLOCK') throw new AppError('Une démo bloquée ne peut pas être présentée.', { code: 'ACCEPTANCE_BLOCKED', status: 409 }); if (typeof demoPresenter !== 'function') throw new AppError('La présentation de démo n’est pas configurée.', { code: 'DEMO_PRESENTATION_NOT_CONFIGURED', status: 503 }); const presented = await demoPresenter({ runId: preparation.pipelineRunId, decision }); if (decision === 'APPROVED' && (!presented || typeof presented.href !== 'string' || !presented.href.startsWith('/demo/'))) throw new AppError('La présentation de démo n’a pas fourni de lien vérifiable.', { code: 'DEMO_PRESENTATION_INVALID', status: 503 }); preparation.pipelineStatus = decision === 'APPROVED' ? 'READY_FOR_PROSPECT' : 'NEEDS_CORRECTION'; preparation.presentation = presented ?? null; return savePreparation(preparation); }
  return { addAsset, createPreparation, createRequest, decideMatch, getDemoRequest, getRequest: async id => projectRequest(await readRequest(id)), listDemoRequests, listReports, listRequests, readReport, seedSyntheticReport, start, updateIntake, validateDemo };
}
