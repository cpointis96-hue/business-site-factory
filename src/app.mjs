import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAtomicStore } from './core/atomic-store.mjs';
import { createPromptRegistry } from './config/prompt-registry.mjs';
import { createWorkflowRegistry } from './config/workflow-registry.mjs';
import { createTemplateRegistry } from './config/template-registry.mjs';
import { createContractRegistry } from './config/contract-registry.mjs';
import { createCliProfileRegistry } from './config/cli-profile-registry.mjs';
import { createDossierRegistry } from './dossiers/dossier-registry.mjs';
import { createDomainCandidatesImplementation, createDomainResearchService } from './internet/domain-research-service.mjs';
import { createMemorySecretStore } from './providers/memory-secret-store.mjs';
import { createKeychainSecretStore } from './providers/keychain-secret-store.mjs';
import { createProviderRegistry } from './providers/provider-registry.mjs';
import { createArtifactRegistry } from './runs/artifact-registry.mjs';
import { createLocalOpener } from './system/local-opener.mjs';
import { createProviderChatImplementation, defaultImplementations } from './workflows/implementations.mjs';
import { createWorkflowEngine } from './workflows/workflow-engine.mjs';
import { clientSiteWorkflow, createClientSiteSimulation, createSimulationImplementations } from './simulation/client-site-simulation.mjs';
import { createDefaultProviderAdapters } from './providers/http-adapters.mjs';
import { createSeoAuditRegistry } from './audit/audit-registry.mjs';
import { runSeoAudit } from './audit/seo-audit-service.mjs';
import { createPublicAuditWorkflow } from './audit/public-audit-workflow.mjs';
import { createSeoResearchPlanner } from './audit/seo-research-planner.mjs';
import { createDemoRegistry } from './demos/demo-registry.mjs';
import { createPublicControlPlane } from './public/public-control-plane.mjs';
import { createDemoWorkbench } from './demo/demo-workbench.mjs';
import { createGooglePlacesAutocomplete } from './geography/google-places-autocomplete.mjs';

const defaultsRoot = new URL('../fixtures/defaults/', import.meta.url);
const implementationFiles = {
  'collect-query': fileURLToPath(new URL('./workflows/implementations.mjs', import.meta.url)),
  'domain-candidates': fileURLToPath(new URL('./internet/domain-research-service.mjs', import.meta.url)),
  'provider-chat': fileURLToPath(new URL('./workflows/implementations.mjs', import.meta.url)),
  'simulation-dossier-validation': fileURLToPath(new URL('./simulation/client-site-simulation.mjs', import.meta.url)),
  'simulation-content-plan': fileURLToPath(new URL('./simulation/client-site-simulation.mjs', import.meta.url)),
  'simulation-site-build': fileURLToPath(new URL('./simulation/client-site-simulation.mjs', import.meta.url)),
  'simulation-gmb-audit-report': fileURLToPath(new URL('./simulation/client-site-simulation.mjs', import.meta.url)),
  'simulation-seo-competition-report': fileURLToPath(new URL('./simulation/client-site-simulation.mjs', import.meta.url)),
  'simulation-quality-gate': fileURLToPath(new URL('./simulation/client-site-simulation.mjs', import.meta.url)),
};
const legacyLocalSeoResearchPlanner = `---
id: local-seo-research-planner
name: Plan de recherche SEO locale
ownerStep: research-plan
outputContract: seo-research-plan
---
Tu prépares un plan de recherche SEO locale, pas un audit et pas une liste de mots-clés mesurés.

Utilise exclusivement les faits fournis dans l’entrée. La catégorie doit être l’une des catégories autorisées. Ne déduis jamais une catégorie depuis un type Google générique. Ne cite ni volume, ni concurrence, ni concurrent, ni position.

Retourne uniquement un objet JSON conforme au contrat. Propose de une à six requêtes françaises, courtes et utiles. Chaque requête doit contenir le nom de l’établissement ou une catégorie autorisée, et la localité fournie. Utilise \`business-name\` seulement si le nom est présent dans la requête, sinon \`observed-category\`.
`;

async function seedPrompt(store, prompts, id) {
  let migrated = false;
  if (await store.readText(`config/prompts/${id}/draft.md`, null) === null) {
    const markdown = await readFile(new URL(`prompts/${id}.md`, defaultsRoot), 'utf8');
    await prompts.saveDraft(id, markdown, { expectedHash: null });
  } else {
    const current = await store.readText(`config/prompts/${id}/draft.md`);
    let normalized = current.replace(/^modelProfile:.*\n/m, '');
    if (id === 'audit-analyst') normalized = normalized.replace(/^outputContract: local-report$/m, 'outputContract: audit-report');
    if (id === 'local-seo-research-planner' && normalized === legacyLocalSeoResearchPlanner) normalized = await readFile(new URL(`prompts/${id}.md`, defaultsRoot), 'utf8');
    if (normalized !== current) {
      await prompts.saveDraft(id, normalized, { expectedHash: store.hashText(current) });
      migrated = true;
    }
  }
  const prompt = await prompts.get(id);
  if (!prompt.activeVersionId || migrated) {
    const version = await prompts.createVersion(id, { expectedDraftHash: prompt.draftHash });
    await prompts.activate(id, version.id);
  }
}

async function seedContract(store, contracts, id) {
  if (await store.readText(`config/contracts/${id}.schema.json`, null) === null) {
    const schema = JSON.parse(await readFile(new URL(`contracts/${id}.schema.json`, defaultsRoot), 'utf8'));
    await store.writeJson(`config/contracts/${id}.schema.json`, schema, { expectedHash: null });
  }
  await contracts.ensure(id, id);
}

async function seedTemplate(store, templates, id) {
  if (await store.readText(`config/templates/${id}/draft.html`, null) !== null) return;
  const content = await readFile(new URL(`templates/${id}.html`, defaultsRoot), 'utf8');
  const names = { 'site-preview': 'Site preview', 'audit-initial': 'Premier audit', 'audit-gmb': 'Audit GMB', 'audit-seo': 'Audit SEO et concurrence' };
  const saved = await templates.save(id, { name: names[id] ?? id, content }, { expectedHash: null });
  const version = await templates.createVersion(id, { expectedDraftHash: saved.draftHash });
  await templates.activate(id, version.id);
}

async function ensureClientAuditTemplates(workflows) {
  const current = await workflows.get('client-site-simulation');
  const templateByStep = { 'dossier-validation': 'audit-initial', 'gmb-audit-report': 'audit-gmb', 'seo-competition-report': 'audit-seo' };
  const legacySimulation = current.steps.length === 5
    && current.steps.some(step => step.id === 'report-build' && step.implementation === 'simulation-report-build')
    && !current.steps.some(step => step.id === 'gmb-audit-report' || step.id === 'seo-competition-report');
  const contentPlan = current.steps.find(step => step.id === 'content-plan');
  const finalReport = current.steps.find(step => step.id === 'seo-competition-report');
  const staleSequence = Boolean(contentPlan?.dependsOn?.includes('dossier-validation') || finalReport?.dependsOn?.includes('site-build'));
  const sourceSteps = legacySimulation || staleSequence ? clientSiteWorkflow.steps : current.steps;
  const steps = sourceSteps.map(step => {
    const withTemplate = templateByStep[step.id] && !step.outputTemplateId ? { ...step, outputTemplateId: templateByStep[step.id] } : step;
    if (withTemplate.kind === 'ai') return withTemplate;
    if (!['actor', 'model', 'promptRef', 'provider'].some(field => Object.hasOwn(withTemplate, field))) return withTemplate;
    const { actor: _actor, model: _model, promptRef: _promptRef, provider: _provider, ...deterministicStep } = withTemplate;
    return deterministicStep;
  });
  if (JSON.stringify(steps) === JSON.stringify(current.steps)) return;
  const { hash: _hash, activeVersionId: _activeVersionId, versions: _versions, ...definition } = current;
  const saved = await workflows.save(current.id, { ...definition, steps }, { expectedHash: current.hash });
  const version = await workflows.createVersion(current.id, { expectedDraftHash: saved.hash });
  await workflows.activate(current.id, version.id);
}

export function createApp({ dataDir = process.env.ANCRAGE_DATA_DIR ?? path.resolve('.ancrage'), secretStore = process.platform === 'darwin' ? createKeychainSecretStore() : createMemorySecretStore(), adapters = {}, opener = createLocalOpener(), auditRunner = runSeoAudit, auditFetchImpl = globalThis.fetch, auditLookup = undefined, publicControlPlane: providedPublicControlPlane = null, demoWorkbench: providedDemoWorkbench = null } = {}) {
  const store = createAtomicStore(dataDir);
  const contracts = createContractRegistry({ store });
  const cliProfiles = createCliProfileRegistry({ store });
  const prompts = createPromptRegistry({ store, contractRegistry: contracts });
  const workflows = createWorkflowRegistry({ store, promptRegistry: prompts, contractRegistry: contracts, cliProfileRegistry: cliProfiles, opener, implementationFiles });
  const templates = createTemplateRegistry({ store });
  const providerAdapters = { ...createDefaultProviderAdapters(), ...adapters };
  const providers = createProviderRegistry({ store, secretStore, adapters: providerAdapters });
  const googlePlacesAutocomplete = createGooglePlacesAutocomplete({ providers, adapters: providerAdapters, secretStore });
  const dossiers = createDossierRegistry({ store, opener });
  const faults = new Set();
  const implementations = { ...defaultImplementations, 'provider-chat': createProviderChatImplementation({ providers, adapters: providerAdapters }), ...createSimulationImplementations({ store, faults }), 'domain-candidates': createDomainCandidatesImplementation({ providers, adapters: providerAdapters, secretStore, fallback: query => ({ domain: `${String(query).toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`, source: 'local-candidate-generator', availability: 'unknown' }) }) };
  const runs = createWorkflowEngine({ store, promptRegistry: prompts, workflowRegistry: workflows, contractRegistry: contracts, cliProfileRegistry: cliProfiles, templateRegistry: templates, implementations });
  const simulation = createClientSiteSimulation({ store, engine: runs, dossiers, faults });
  const artifacts = createArtifactRegistry({ store, runs });
  const demos = createDemoRegistry({ store, artifacts, runs });
  const audits = createSeoAuditRegistry({ store, runner: auditRunner });
  const seoResearchPlanner = createSeoResearchPlanner({ providers, adapters: providerAdapters, prompts, workflows, contracts });
  const publicAudits = createPublicAuditWorkflow({ store, providers, adapters: providerAdapters, secretStore, fetchImpl: auditFetchImpl, lookup: auditLookup, seoResearchPlanner });
  const demoWorkbench = providedDemoWorkbench ?? createDemoWorkbench({ store, auditRunner, fetchImpl: auditFetchImpl, lookup: auditLookup });
  const publicControlPlane = providedPublicControlPlane ?? createPublicControlPlane({
    store,
    auditStarter: async ({ request, decision }) => {
      const audit = await publicAudits.create({
        name: request.input.name,
        city: { id: request.input.city.id, label: request.input.city.label, country: request.input.city.countryCode },
        domain: request.input.domain ?? undefined,
        domainSource: request.input.identity?.source === 'google-places' ? 'google-places' : 'request',
        address: request.input.identity?.address ?? undefined,
        identity: request.input.identity ?? undefined,
        idempotencyKey: `public-control-plane-${request.id}`,
      }, { mode: decision, waitFor: decision === 'CONFIRM' ? 'gmb' : undefined });
      const reports = { audit: { id: audit.id, status: audit.status, stages: audit.stages, provider: audit.provider } };
      for (const kind of ['gmb', 'final']) {
        const report = audit.reports?.find(item => item.kind === kind);
        if (report) reports[kind] = { html: (await publicAudits.readReport(audit.id, kind)).value };
        if (kind === 'final' && report) reports[kind].pdf = (await publicAudits.readReport(audit.id, kind, 'pdf')).value;
      }
      if (!reports.final && audit.completion) {
        reports.completion = audit.completion.then(async completed => ({ audit: { id: completed.id, status: completed.status, stages: completed.stages, provider: completed.provider }, html: (await publicAudits.readReport(completed.id, 'final')).value, pdf: (await publicAudits.readReport(completed.id, 'final', 'pdf')).value }));
      }
      return reports;
    },
    pipelineStarter: async ({ request, preparation }) => {
      const intake = preparation.intake ?? {};
      const firstPhoto = preparation.assets.find(asset => asset.assetPath && asset.mimeType);
      if (!firstPhoto) throw Object.assign(new Error('Les fichiers photo ne sont pas disponibles pour la démo.'), { code: 'PHOTO_BYTES_NOT_AVAILABLE', status: 409 });
      const photoFiles = await Promise.all(preparation.assets.map(async asset => ({ asset, value: await store.readBuffer(asset.assetPath, null) })));
      if (photoFiles.some(item => !item.value)) throw Object.assign(new Error('Un fichier photo est introuvable dans la préparation.'), { code: 'PHOTO_BYTES_NOT_AVAILABLE', status: 409 });
      const dossier = await dossiers.create({
        name: request.input.name,
        city: request.input.city.label,
        country: request.input.city.countryCode,
        address: intake.address ?? '',
        contact: intake.contact ?? '',
        story: intake.story ?? '',
        menu: Array.isArray(intake.menu) ? intake.menu : [],
        photos: photoFiles.map(({ asset, value }) => ({ dataUrl: `data:${asset.mimeType};base64,${value.toString('base64')}`, alt: request.input.name, category: asset.category, rightsStatus: asset.rightsStatus })),
      }, { source: 'public-demo-intake' });
      const run = await simulation.startDossier(dossier.id);
      if (run.status !== 'SUCCEEDED') throw new Error('Le pipeline de démo n’est pas terminé.');
      const quality = await store.readJson(`runs/${run.id}/steps/quality-gate/step-run.json`, null);
      return { runId: run.id, status: 'READY_FOR_OWNER_REVIEW', acceptanceReport: { status: quality?.output?.status ?? 'UNKNOWN', checks: quality?.output?.checks ?? [], photoAssets: preparation.assets.length, embeddedAssets: preparation.assets.map(asset => asset.category), note: 'Les cinq photos fournies sont intégrées à l’aperçu local.' } };
    },
    demoPresenter: async ({ runId, decision }) => {
      await runs.decide(runId, decision);
      return decision === 'APPROVED' ? demos.create(runId) : { decision };
    },
  });
  const internet = createDomainResearchService({ store, runs });
  const ready = (async () => {
    await seedContract(store, contracts, 'domain-candidates');
    await seedContract(store, contracts, 'audit-report');
    await seedContract(store, contracts, 'copy-draft');
    await seedContract(store, contracts, 'seo-research-plan');
    await seedPrompt(store, prompts, 'audit-analyst');
    await seedPrompt(store, prompts, 'copywriter');
    await seedPrompt(store, prompts, 'local-seo-research-planner');
    const domainResearch = JSON.parse(await readFile(new URL('workflows/domain-research.json', defaultsRoot), 'utf8'));
    const localSeoResearch = JSON.parse(await readFile(new URL('workflows/local-seo-research.json', defaultsRoot), 'utf8'));
    await workflows.ensure(domainResearch);
    await workflows.ensure(localSeoResearch);
    await workflows.ensure(clientSiteWorkflow);
    await seedTemplate(store, templates, 'site-preview');
    await seedTemplate(store, templates, 'audit-initial');
    await seedTemplate(store, templates, 'audit-gmb');
    await seedTemplate(store, templates, 'audit-seo');
    await ensureClientAuditTemplates(workflows);
  })();
  return { artifacts, audits, cliProfiles, contracts, demoWorkbench, demos, dossiers, googlePlacesAutocomplete, internet, providers, prompts, publicAudits, publicControlPlane, ready, runs, simulation, templates, workflows };
}
