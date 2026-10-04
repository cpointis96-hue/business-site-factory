import { ConflictError, NotFoundError, ValidationError } from '../core/errors.mjs';
import { assertResourceId } from '../core/ids.mjs';
import { parsePromptMarkdown } from './frontmatter.mjs';

const INDEX_PATH = 'config/prompts/index.json';

function promptPath(id, suffix) {
  return `config/prompts/${id}/${suffix}`;
}

function versionStamp(date) {
  return date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

export function createPromptRegistry({ store, clock = () => new Date(), contractRegistry = null }) {
  async function readManifest(id) {
    const manifest = await store.readJson(promptPath(id, 'manifest.json'), null);
    if (!manifest) throw new NotFoundError(`Prompt introuvable : ${id}`);
    return manifest;
  }

  async function writeManifest(id, manifest) {
    const relativePath = promptPath(id, 'manifest.json');
    const current = await store.readText(relativePath, null);
    return store.writeJson(relativePath, manifest, {
      expectedHash: current === null ? null : store.hashText(current),
    });
  }

  async function ensureIndexed(id) {
    const index = await store.readJson(INDEX_PATH, []);
    if (index.includes(id)) return;
    const current = await store.readText(INDEX_PATH, null);
    await store.writeJson(INDEX_PATH, [...index, id].sort(), {
      expectedHash: current === null ? null : store.hashText(current),
    });
  }

  async function saveDraft(id, markdown, { expectedHash } = {}) {
    assertResourceId(id, 'promptId');
    const parsed = parsePromptMarkdown(markdown);
    if (parsed.metadata.id !== id) {
      throw new ValidationError('L’identifiant du frontmatter ne correspond pas au prompt.');
    }
    if (contractRegistry) await contractRegistry.get(parsed.metadata.outputContract);

    const result = await store.writeText(promptPath(id, 'draft.md'), markdown, { expectedHash });
    const existing = await store.readJson(promptPath(id, 'manifest.json'), null);
    const manifest = {
      id,
      name: parsed.metadata.name,
      ownerStep: parsed.metadata.ownerStep,
      outputContract: parsed.metadata.outputContract,
      draftHash: result.hash,
      activeVersionId: existing?.activeVersionId ?? null,
      versions: existing?.versions ?? [],
      updatedAt: clock().toISOString(),
    };
    await writeManifest(id, manifest);
    await ensureIndexed(id);
    return { hash: result.hash, prompt: manifest };
  }

  async function get(id) {
    assertResourceId(id, 'promptId');
    const manifest = await readManifest(id);
    const markdown = await store.readText(promptPath(id, 'draft.md'), null);
    if (markdown === null) throw new NotFoundError(`Brouillon introuvable : ${id}`);
    const draftHash = store.hashText(markdown);
    return { ...manifest, draftHash, markdown };
  }

  async function list() {
    const ids = await store.readJson(INDEX_PATH, []);
    const prompts = await Promise.all(ids.map(async id => {
      const { markdown: _markdown, ...prompt } = await get(id);
      return prompt;
    }));
    return prompts.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  async function createVersion(id, { expectedDraftHash }) {
    const prompt = await get(id);
    if (prompt.draftHash !== expectedDraftHash) {
      throw new ConflictError(undefined, { currentHash: prompt.draftHash });
    }

    parsePromptMarkdown(prompt.markdown);
    if (contractRegistry) {
      const contract = await contractRegistry.get(prompt.outputContract);
      if (!contract.activeVersionId) throw new ValidationError(`Aucune version active pour le contrat : ${prompt.outputContract}`);
    } else {
      const contract = await store.readText(`config/contracts/${prompt.outputContract}.schema.json`, null);
      if (contract === null) throw new ValidationError(`Contrat de sortie introuvable : ${prompt.outputContract}`);
    }
    const versionId = `v-${versionStamp(clock())}-${prompt.draftHash.slice(-8)}`;
    const existingVersion = prompt.versions.find(version => version.id === versionId);
    if (existingVersion) return existingVersion;
    await store.writeText(promptPath(id, `versions/${versionId}.md`), prompt.markdown, {
      immutable: true,
    });

    const version = {
      id: versionId,
      hash: prompt.draftHash,
      createdAt: clock().toISOString(),
    };
    const manifest = {
      ...prompt,
      markdown: undefined,
      versions: [...prompt.versions, version],
      updatedAt: clock().toISOString(),
    };
    delete manifest.markdown;
    await writeManifest(id, manifest);
    return version;
  }

  async function activate(id, versionId) {
    assertResourceId(versionId, 'versionId');
    const prompt = await get(id);
    if (!prompt.versions.some(version => version.id === versionId)) {
      throw new NotFoundError(`Version introuvable : ${versionId}`);
    }
    const manifest = {
      ...prompt,
      activeVersionId: versionId,
      activatedAt: clock().toISOString(),
      updatedAt: clock().toISOString(),
    };
    delete manifest.markdown;
    await writeManifest(id, manifest);
    return manifest;
  }

  async function resolveRevision(id, revision) {
    if (revision === 'draft') return (await get(id)).markdown;
    assertResourceId(revision, 'versionId');
    const prompt = await get(id);
    if (!prompt.versions.some(version => version.id === revision)) {
      throw new NotFoundError(`Version introuvable : ${revision}`);
    }
    return store.readText(promptPath(id, `versions/${revision}.md`));
  }

  async function diff(id, fromRevision, toRevision) {
    const [from, to] = await Promise.all([
      resolveRevision(id, fromRevision),
      resolveRevision(id, toRevision),
    ]);
    const fromLines = from.split('\n');
    const toLines = to.split('\n');
    return {
      changed: from !== to,
      removed: fromLines.filter(line => !toLines.includes(line)),
      added: toLines.filter(line => !fromLines.includes(line)),
    };
  }

  return { activate, createVersion, diff, get, list, saveDraft };
}
