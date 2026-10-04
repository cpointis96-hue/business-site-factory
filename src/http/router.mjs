import { readJsonBody, sendContent, sendJson } from './json.mjs';
import { AppError, NotFoundError, ValidationError } from '../core/errors.mjs';

const id = value => { if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new ValidationError('Identifiant invalide.'); return value; };
const REPORT_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'";

export function createRouter({ artifacts = null, audits = null, publicAudits = null, publicControlPlane = null, demoWorkbench = null, demos = null, dossiers = null, googlePlacesAutocomplete = null, providers, prompts, contracts = null, cliProfiles = null, ready = Promise.resolve(), templates = null, workflows, runs, simulation = null, internet = null }) {
  return async function route(request, response, url) {
    const parts = url.pathname.split('/').filter(Boolean); const method = request.method ?? 'GET';
    try {
      await ready;
      if (parts[0] === 'demo' && parts.length === 2 && demos) {
        const demo = await demos.read(parts[1]);
        return sendContent(response, 200, demo.value.replace(/<head>/i, '<head><meta name="robots" content="noindex,nofollow">'), demo.contentType, { 'X-Robots-Tag': 'noindex, nofollow' });
      }
      if (parts[0] !== 'api') throw new NotFoundError();
      if (parts[1] === 'demo' && parts[2] === 'workbench' && parts[3] === 'audits' && demoWorkbench) {
        if (parts.length === 4 && method === 'GET') return sendJson(response, 200, await demoWorkbench.list());
        if (parts.length === 4 && method === 'POST') return sendJson(response, 201, await demoWorkbench.create(await readJsonBody(request)));
        if (parts.length === 6 && method === 'GET' && ['report', 'site'].includes(parts[5])) return sendContent(response, 200, (await demoWorkbench.readArtifact(id(parts[4]), parts[5])).value, 'text/html; charset=utf-8');
      }
      if (parts[1] === 'public' && publicControlPlane) {
        if (parts[2] === 'requests' && parts.length === 3 && method === 'GET') return sendJson(response, 200, await publicControlPlane.listRequests());
        if (parts[2] === 'demo-requests' && parts.length === 3 && method === 'GET') return sendJson(response, 200, await publicControlPlane.listDemoRequests());
        if (parts[2] === 'requests' && parts.length === 3 && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 201, await publicControlPlane.createRequest({ ...body, idempotencyKey: body.idempotencyKey ?? request.headers['idempotency-key'] })); }
        if (parts[2] === 'requests' && parts.length >= 4) {
          const requestId = id(parts[3]);
          if (parts.length === 4 && method === 'GET') return sendJson(response, 200, await publicControlPlane.getRequest(requestId));
          if (parts[4] === 'match-decision' && parts.length === 5 && method === 'POST') return sendJson(response, 200, await publicControlPlane.decideMatch(requestId, await readJsonBody(request)));
          if (parts[4] === 'reports' && parts.length === 5 && method === 'GET') return sendJson(response, 200, await publicControlPlane.listReports(requestId));
          if (parts[4] === 'reports' && parts.length >= 6 && method === 'GET') return sendContent(response, 200, (await publicControlPlane.readReport(requestId, id(parts[5]), parts[6] === 'pdf' ? 'pdf' : 'html')).value, parts[6] === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8', { 'Content-Security-Policy': REPORT_CONTENT_SECURITY_POLICY });
          if (parts[4] === 'preparation' && parts.length === 5 && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 201, await publicControlPlane.createPreparation(requestId, { ...body, idempotencyKey: body.idempotencyKey ?? request.headers['idempotency-key'] })); }
        }
        if (parts[2] === 'demo-requests' && parts.length >= 4) {
          const demoRequestId = id(parts[3]);
          if (parts.length === 4 && method === 'GET') return sendJson(response, 200, await publicControlPlane.getDemoRequest(demoRequestId));
          if (parts[4] === 'intake' && parts.length === 5 && method === 'PUT') return sendJson(response, 200, await publicControlPlane.updateIntake(demoRequestId, await readJsonBody(request)));
          if (parts[4] === 'assets' && parts.length === 5 && method === 'POST') return sendJson(response, 201, await publicControlPlane.addAsset(demoRequestId, await readJsonBody(request)));
          if (parts[4] === 'start' && parts.length === 5 && method === 'POST') return sendJson(response, 200, await publicControlPlane.start(demoRequestId));
          if (parts[4] === 'decision' && parts.length === 5 && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await publicControlPlane.validateDemo(demoRequestId, body.decision)); }
        }
      }
      if (parts[1] === 'intake' && parts[2] === 'dossiers' && parts.length === 3 && method === 'POST' && dossiers) {
        const body = await readJsonBody(request);
        return sendJson(response, 201, await dossiers.create(body, { source: 'local-public-intake' }));
      }
      if (parts[1] === 'dossiers' && dossiers) {
        if (parts.length === 2 && method === 'GET') return sendJson(response, 200, await dossiers.list());
        if (parts.length === 2 && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 201, await dossiers.create(body, { source: 'local-operator' })); }
        const dossierId = id(parts[2]);
        if (parts.length === 3 && method === 'GET') return sendJson(response, 200, await dossiers.get(dossierId));
        if (parts[3] === 'open' && parts.length === 4 && method === 'POST') return sendJson(response, 200, await dossiers.open(dossierId));
        if (parts[3] === 'runs' && parts.length === 4 && method === 'POST' && simulation) { const body = await readJsonBody(request); return sendJson(response, 201, await simulation.startDossier(dossierId, { fault: body.fault ?? null })); }
        if (parts[3] === 'assets' && parts.length === 5 && method === 'GET') { const asset = await dossiers.readAsset(dossierId, decodeURIComponent(parts[4])); return sendContent(response, 200, asset.value, asset.type, { 'Content-Disposition': `inline; filename="${asset.name}"` }); }
      }
      if (parts[1] === 'providers') {
        if (parts.length === 2 && method === 'GET') return sendJson(response, 200, await providers.list());
        const providerId = id(parts[2]);
        if (parts[3] === 'secret' && method === 'PUT') { const body = await readJsonBody(request); return sendJson(response, 200, await providers.saveSecret(providerId, body.secret)); }
        if (parts[3] === 'secret' && method === 'DELETE') return sendJson(response, 200, await providers.deleteSecret(providerId));
        if (parts[3] === 'test' && method === 'POST') return sendJson(response, 200, await providers.testConnection(providerId));
        if (parts[3] === 'test-secret' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await providers.testConnection(providerId, { secretOverride: body.secret })); }
        if (parts[3] === 'models' && method === 'GET') return sendJson(response, 200, await providers.listModels(providerId));
        if (parts[3] === 'enabled' && method === 'PUT') { const body = await readJsonBody(request); return sendJson(response, 200, await providers.setEnabled(providerId, body.enabled)); }
      }
      if (parts[1] === 'places' && parts[2] === 'autocomplete' && parts.length === 3 && method === 'GET' && googlePlacesAutocomplete) return sendJson(response, 200, await googlePlacesAutocomplete({ input: url.searchParams.get('input'), countryCode: url.searchParams.get('country'), mode: url.searchParams.get('mode') ?? 'city' }));
      if (parts[1] === 'places' && parts[2] === 'details' && parts.length === 3 && method === 'GET' && googlePlacesAutocomplete?.details) return sendJson(response, 200, await googlePlacesAutocomplete.details({ placeId: url.searchParams.get('placeId') }));
      if (parts[1] === 'prompts') {
        if (parts.length === 2 && method === 'GET') return sendJson(response, 200, await prompts.list());
        const promptId = id(parts[2]);
        if (parts.length === 3 && method === 'GET') return sendJson(response, 200, await prompts.get(promptId));
        if (parts[3] === 'draft' && method === 'PUT') { const body = await readJsonBody(request); return sendJson(response, 200, await prompts.saveDraft(promptId, body.markdown, { expectedHash: body.expectedHash })); }
        if (parts[3] === 'versions' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await prompts.createVersion(promptId, { expectedDraftHash: body.expectedDraftHash })); }
        if (parts[3] === 'activate' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await prompts.activate(promptId, body.versionId)); }
      }
      if (parts[1] === 'contracts' && contracts) {
        if (parts.length === 2 && method === 'GET') return sendJson(response, 200, await contracts.list());
        const contractId = id(parts[2]);
        if (parts.length === 3 && method === 'GET') return sendJson(response, 200, await contracts.get(contractId));
        if (parts[3] === 'draft' && method === 'PUT') { const body = await readJsonBody(request); return sendJson(response, 200, await contracts.save(contractId, body, { expectedHash: body.expectedHash })); }
        if (parts[3] === 'versions' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await contracts.createVersion(contractId, { expectedDraftHash: body.expectedDraftHash })); }
        if (parts[3] === 'activate' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await contracts.activate(contractId, body.versionId)); }
      }
      if (parts[1] === 'cli-profiles' && cliProfiles) {
        if (parts.length === 2 && method === 'GET') return sendJson(response, 200, await cliProfiles.list());
        const profileId = id(parts[2]);
        if (parts.length === 3 && method === 'GET') return sendJson(response, 200, await cliProfiles.get(profileId));
        if (parts[3] === 'draft' && method === 'PUT') { const body = await readJsonBody(request); return sendJson(response, 200, await cliProfiles.save(profileId, body, { expectedHash: body.expectedHash })); }
        if (parts[3] === 'versions' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await cliProfiles.createVersion(profileId, { expectedDraftHash: body.expectedDraftHash })); }
        if (parts[3] === 'activate' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await cliProfiles.activate(profileId, body.versionId)); }
      }
      if (parts[1] === 'workflows') {
        if (parts.length === 2 && method === 'GET') return sendJson(response, 200, await workflows.list());
        const workflowId = id(parts[2]);
        if (parts.length === 3 && method === 'GET') return sendJson(response, 200, await workflows.get(workflowId));
        if (parts[3] === 'resources' && parts[4] === 'open' && parts.length === 5 && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await workflows.openStepResource(workflowId, body)); }
        if (parts[3] === 'draft' && method === 'PUT') { const body = await readJsonBody(request); return sendJson(response, 200, await workflows.save(workflowId, body.definition, { expectedHash: body.expectedHash })); }
        if (parts[3] === 'versions' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await workflows.createVersion(workflowId, { expectedDraftHash: body.expectedDraftHash })); }
        if (parts[3] === 'activate' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await workflows.activate(workflowId, body.versionId)); }
      }
      if (parts[1] === 'templates' && templates) {
        if (parts.length === 2 && method === 'GET') return sendJson(response, 200, await templates.list());
        const templateId = id(parts[2]);
        if (parts.length === 3 && method === 'GET') return sendJson(response, 200, await templates.get(templateId));
        if (parts[3] === 'draft' && method === 'PUT') { const body = await readJsonBody(request); return sendJson(response, 200, await templates.save(templateId, body, { expectedHash: body.expectedHash })); }
        if (parts[3] === 'versions' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await templates.createVersion(templateId, { expectedDraftHash: body.expectedDraftHash })); }
        if (parts[3] === 'activate' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await templates.activate(templateId, body.versionId)); }
        if (parts.length === 3 && method === 'DELETE') return sendJson(response, 200, await templates.remove(templateId));
      }
      if (parts[1] === 'runs') {
        if (parts.length === 2 && method === 'GET') return sendJson(response, 200, await runs.list());
        if (parts.length === 2 && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 201, await runs.start(body.workflowId, body.input ?? {})); }
        if (parts.length === 4 && parts[3] === 'artifacts' && method === 'GET' && artifacts) return sendJson(response, 200, await artifacts.list(id(parts[2])));
        if (parts.length === 5 && parts[3] === 'artifacts' && method === 'GET' && artifacts) { const artifact = await artifacts.read(id(parts[2]), id(parts[4])); return sendContent(response, 200, artifact.value, artifact.contentType, { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:" }); }
        if (parts.length === 4 && parts[3] === 'decision' && method === 'PUT') { const body = await readJsonBody(request); const decided = await runs.decide(id(parts[2]), body.decision); const presentation = body.decision === 'APPROVED' && demos ? await demos.create(decided.id) : null; return sendJson(response, 200, presentation ? { ...decided, presentation } : decided); }
        if (parts.length === 3 && method === 'GET') return sendJson(response, 200, await runs.get(id(parts[2])));
        if (parts.length === 4 && parts[3] === 'events' && method === 'GET') return sendJson(response, 200, await runs.events(id(parts[2])));
        if (parts.length === 4 && parts[3] === 'resume' && method === 'POST') {
          const runId = id(parts[2]);
          const run = await runs.get(runId);
          const resumed = run.workflowId === simulation?.workflowId ? await simulation.resume(runId) : await runs.resume(runId);
          return sendJson(response, 200, resumed);
        }
      }
      if (parts[1] === 'internet' && parts[2] === 'search' && method === 'POST') { if (!internet) throw new AppError('Recherche Internet non configurée.', { code: 'INTERNET_NOT_CONFIGURED', status: 503 }); const body = await readJsonBody(request); return sendJson(response, 200, await internet(body)); }
      if (parts[1] === 'audits' && parts[2] === 'seo' && audits) {
        if (parts.length === 3 && method === 'GET') return sendJson(response, 200, await audits.list());
        if (parts.length === 3 && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 201, await audits.create({ ...body, idempotencyKey: body.idempotencyKey ?? request.headers['idempotency-key'] })); }
        if (parts.length === 4 && method === 'GET') return sendJson(response, 200, await audits.get(id(parts[3])));
        if (parts.length === 5 && parts[4] === 'report' && method === 'GET') { const report = await audits.readReport(id(parts[3])); return sendContent(response, 200, report.value, report.contentType); }
      }
      if (parts[1] === 'audits' && parts[2] === 'local' && publicAudits) {
        if (parts.length === 3 && method === 'GET') return sendJson(response, 200, await publicAudits.list());
        if (parts.length === 3 && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 201, await publicAudits.create({ ...body, idempotencyKey: body.idempotencyKey ?? request.headers['idempotency-key'] })); }
        if (parts.length === 5 && parts[4] === 'reports' && method === 'GET') { const report = await publicAudits.readReport(id(parts[3]), url.searchParams.get('kind') ?? 'final'); return sendContent(response, 200, report.value, report.contentType, { 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': REPORT_CONTENT_SECURITY_POLICY }); }
        if (parts.length === 4 && method === 'GET') return sendJson(response, 200, await publicAudits.get(id(parts[3])));
      }
      if (parts[1] === 'simulations' && parts[2] === 'client-site' && simulation) {
        if (parts.length === 3 && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 201, await simulation.start(body.profile ?? {}, { fault: body.fault ?? null })); }
        if (parts.length === 5 && parts[4] === 'resume' && method === 'POST') { const body = await readJsonBody(request); return sendJson(response, 200, await simulation.resume(id(parts[3]), { fault: body.fault ?? null })); }
      }
      throw new NotFoundError();
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError('Erreur interne.');
      const publicRoute = request.url?.startsWith('/api/public/'); const message = appError.status >= 500 ? 'Erreur interne.' : appError.message;
      const publicRequestId = publicRoute ? request.url.match(/\/api\/public\/(?:requests|demo-requests)\/([^/?]+)/)?.[1] ?? null : null;
      const publicDetails = publicRoute && appError.status < 500 ? { requestId: publicRequestId, retryable: Boolean(appError.details?.retryable), nextAction: appError.details?.nextAction ?? null, ...(appError.details?.field ? { fieldErrors: { [appError.details.field]: message } } : {}) } : {};
      sendJson(response, appError.status ?? 500, { error: { code: appError.code, message, ...publicDetails } });
    }
  };
}
