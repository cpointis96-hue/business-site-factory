import { NotFoundError } from '../core/errors.mjs';

const KINDS = {
  site: { stepId: 'site-build', contentType: 'text/html; charset=utf-8' },
  'gmb-report': { stepId: 'gmb-audit-report', contentType: 'text/html; charset=utf-8' },
  'seo-report': { stepId: 'seo-competition-report', contentType: 'text/html; charset=utf-8' },
};

export function createArtifactRegistry({ store, runs }) {
  async function descriptor(runId, kind) {
    const definition = KINDS[kind];
    if (!definition) throw new NotFoundError('Artefact introuvable.');
    await runs.get(runId);
    const checkpoint = await store.readJson(`runs/${runId}/steps/${definition.stepId}/step-run.json`, null);
    const artifactPath = checkpoint?.output?.artifactPath;
    if (!artifactPath) throw new NotFoundError('Artefact introuvable.');
    return { kind, contentType: definition.contentType, artifactPath, hash: checkpoint.output.artifactHash };
  }

  async function list(runId) {
    const entries = await Promise.all(Object.keys(KINDS).map(kind => descriptor(runId, kind).catch(() => null)));
    return entries.filter(Boolean).map(({ artifactPath: _artifactPath, contentType: _contentType, ...item }) => ({ ...item, href: `/api/runs/${runId}/artifacts/${item.kind}` }));
  }

  async function read(runId, kind) {
    const item = await descriptor(runId, kind);
    const value = await store.readText(item.artifactPath, null);
    if (value === null) throw new NotFoundError('Artefact introuvable.');
    return { ...item, value };
  }

  return { list, read };
}
