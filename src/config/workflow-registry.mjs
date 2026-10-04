import { ConflictError, NotFoundError, ValidationError } from '../core/errors.mjs';
import { assertResourceId } from '../core/ids.mjs';
import { validateWorkflowDefinition } from '../workflows/workflow-validator.mjs';
import { normalizeContractId } from './contract-registry.mjs';

const INDEX_PATH = 'config/workflows/index.json';
const workflowPath = id => `config/workflows/${id}.json`;
const manifestPath = id => `config/workflows/${id}/manifest.json`;
const versionPath = (id, versionId) => `config/workflows/${id}/versions/${versionId}.json`;

function versionStamp(date) {
  return date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

export function createWorkflowRegistry({ store, clock = () => new Date(), promptRegistry = null, contractRegistry = null, cliProfileRegistry = null, opener = null, implementationFiles = {} }) {
  async function validateReferences(definition, { requireActive = false } = {}) {
    for (const step of definition.steps) {
      const prompt = step.promptRef && promptRegistry ? await promptRegistry.get(step.promptRef) : null;
      const contractRef = step.contractRef ?? (step.kind === 'ai' ? prompt?.outputContract : null);
      if (contractRef && contractRegistry) {
        const normalizedContractId = normalizeContractId(contractRef);
        const contract = await contractRegistry.get(normalizedContractId);
        if (requireActive && !contract.activeVersionId) throw new ValidationError(`Aucune version active pour le contrat : ${normalizedContractId}`);
      }
      if (prompt) {
        if (requireActive && step.kind === 'ai' && !prompt.activeVersionId) throw new ValidationError(`Aucune version active pour le prompt : ${step.promptRef}`);
        if (step.kind === 'ai' && step.contractRef && normalizeContractId(step.contractRef) !== normalizeContractId(prompt.outputContract)) throw new ValidationError(`Le contrat de l’étape ${step.id} diffère de celui du prompt.`);
      }
      if (step.profile && cliProfileRegistry) {
        const profile = await cliProfileRegistry.get(step.profile);
        if (requireActive && !profile.activeVersionId) throw new ValidationError(`Aucune version active pour le profil CLI : ${step.profile}`);
      }
    }
  }
  async function ensureIndexed(id) {
    const currentText = await store.readText(INDEX_PATH, null);
    const current = currentText === null ? [] : JSON.parse(currentText);
    if (current.includes(id)) return;
    await store.writeJson(INDEX_PATH, [...current, id].sort(), { expectedHash: currentText === null ? null : store.hashText(currentText) });
  }

  async function get(id) {
    assertResourceId(id, 'workflowId');
    const text = await store.readText(workflowPath(id), null);
    if (text === null) throw new NotFoundError(`Workflow introuvable : ${id}`);
    const definition = validateWorkflowDefinition(JSON.parse(text));
    await validateReferences(definition);
    const manifest = await store.readJson(manifestPath(id), { activeVersionId: null, versions: [] });
    return { ...definition, hash: store.hashText(text), activeVersionId: manifest.activeVersionId, versions: manifest.versions ?? [] };
  }

  async function list() {
    const ids = await store.readJson(INDEX_PATH, []);
    const workflows = await Promise.all(ids.map(get));
    return workflows.sort((a, b) => a.id.localeCompare(b.id));
  }

  async function save(id, definition, { expectedHash } = {}) {
    assertResourceId(id, 'workflowId');
    if (!definition || typeof definition !== 'object' || definition.id !== id) throw new ValidationError('Définition de workflow invalide.');
    const validated = validateWorkflowDefinition(definition);
    await validateReferences(validated);
    const result = await store.writeJson(workflowPath(id), validated, { expectedHash });
    await ensureIndexed(id);
    const currentManifest = await store.readJson(manifestPath(id), null);
    if (!currentManifest) {
      await store.writeJson(manifestPath(id), { id, activeVersionId: null, versions: [], updatedAt: clock().toISOString() }, { expectedHash: null });
    } else {
      const currentText = await store.readText(manifestPath(id));
      await store.writeJson(manifestPath(id), { ...currentManifest, updatedAt: clock().toISOString() }, { expectedHash: store.hashText(currentText) });
    }
    return get(id);
  }

  async function createVersion(id, { expectedDraftHash }) {
    const workflow = await get(id);
    if (workflow.hash !== expectedDraftHash) throw new ConflictError(undefined, { currentHash: workflow.hash });
    await validateReferences(workflow, { requireActive: true });
    const definition = { ...workflow };
    delete definition.hash;
    delete definition.activeVersionId;
    delete definition.versions;
    const manifest = await store.readJson(manifestPath(id), { id, activeVersionId: null, versions: [] });
    const versionId = `v-${versionStamp(clock())}-${workflow.hash.slice(-8)}`;
    if (manifest.versions.some(version => version.id === versionId)) return manifest.versions.find(version => version.id === versionId);
    await store.writeJson(versionPath(id, versionId), definition, { immutable: true });
    const version = { id: versionId, hash: workflow.hash, createdAt: clock().toISOString() };
    const currentText = await store.readText(manifestPath(id), null);
    await store.writeJson(manifestPath(id), { ...manifest, versions: [...manifest.versions, version], updatedAt: clock().toISOString() }, { expectedHash: currentText === null ? null : store.hashText(currentText) });
    return version;
  }

  async function activate(id, versionId) {
    assertResourceId(versionId, 'versionId');
    const workflow = await get(id);
    if (!workflow.versions.some(version => version.id === versionId)) throw new NotFoundError(`Version introuvable : ${versionId}`);
    const manifest = await store.readJson(manifestPath(id));
    const currentText = await store.readText(manifestPath(id));
    await store.writeJson(manifestPath(id), { ...manifest, activeVersionId: versionId, activatedAt: clock().toISOString(), updatedAt: clock().toISOString() }, { expectedHash: store.hashText(currentText) });
    return get(id);
  }

  async function resolveActive(id) {
    const workflow = await get(id);
    if (!workflow.activeVersionId) throw new ConflictError(`Aucune version active pour le workflow : ${id}`);
    const version = workflow.versions.find(item => item.id === workflow.activeVersionId);
    const definition = validateWorkflowDefinition(await store.readJson(versionPath(id, workflow.activeVersionId)));
    return { definition, versionId: version.id, hash: version.hash };
  }

  async function openStepResource(id, { stepId, field, reference }) {
    if (!opener) throw new ValidationError('Ouverture Finder indisponible sur cette machine.');
    assertResourceId(stepId, 'stepId');
    if (!['inputRefs', 'outputRefs'].includes(field)) throw new ValidationError('Type de référence invalide.');
    const workflow = await get(id);
    const step = workflow.steps.find(item => item.id === stepId);
    if (!step) throw new NotFoundError(`Étape introuvable : ${stepId}`);
    if (!(step[field] ?? []).includes(reference)) throw new NotFoundError('Référence de workflow introuvable.');
    const sourceStep = field === 'inputRefs'
      ? workflow.steps.find(item => item.id === reference) ?? step
      : step;
    const target = implementationFiles[sourceStep.implementation] ?? store.resolveSafe(`config/workflows/${id}.json`);
    await opener(target, { reveal: true });
    return { opened: true, workflowId: id, stepId, field, reference };
  }

  async function ensure(definition) {
    const current = await store.readText(workflowPath(definition.id), null);
    if (current === null) await save(definition.id, definition, { expectedHash: null });
    await ensureIndexed(definition.id);
    const workflow = await get(definition.id);
    if (!workflow.activeVersionId) {
      const version = await createVersion(definition.id, { expectedDraftHash: workflow.hash });
      return activate(definition.id, version.id);
    }
    return workflow;
  }

  return { activate, createVersion, ensure, get, list, openStepResource, resolveActive, save };
}
