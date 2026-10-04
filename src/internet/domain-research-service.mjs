import { ValidationError } from '../core/errors.mjs';

export function createDomainResearchService({ runs, store }) {
  return async ({ query }) => {
    if (typeof query !== 'string' || !query.trim()) throw new ValidationError('Nom de domaine requis.', { field: 'query' });
    const run = await runs.start('domain-research', { query: query.trim() });
    const checkpoint = await store.readJson(`runs/${run.id}/steps/domain-candidates/step-run.json`, null);
    return {
      runId: run.id,
      status: run.status,
      candidates: checkpoint?.output?.candidates ?? [],
    };
  };
}

export function createDomainCandidatesImplementation({ providers, adapters, secretStore, fallback }) {
  return async ({ input }) => {
    const query = String(input.query ?? '').trim();
    const configured = (await providers.list()).filter(provider => provider.kind === 'domain' && provider.enabled && provider.health === 'healthy');
    const results = [];
    for (const provider of configured) {
      const search = adapters[provider.id]?.search;
      if (!search) continue;
      try {
        const candidates = await search({ query, provider, secret: await secretStore.get(`provider:${provider.id}`) });
        results.push(...candidates.map(candidate => ({ ...candidate, source: provider.id })));
      } catch {
        // A registrar failure must not hide results from other configured registrars.
      }
    }
    return { candidates: results.length ? results : [fallback(query)] };
  };
}
