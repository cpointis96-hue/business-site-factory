import { validateJsonSchema } from '../core/json-schema.mjs';
import { parsePromptMarkdown } from '../config/frontmatter.mjs';
import { normalize } from './seo-qualification.mjs';

const MAX_QUERIES = 6;

function clean(value) { return String(value ?? '').trim(); }
function uniqueQueries(values) {
  const seen = new Set();
  return values.filter(item => item && !seen.has(normalize(item.query)) && seen.add(normalize(item.query)));
}
function includesText(value, expected) { return normalize(value).includes(normalize(expected)); }

export function createSeoResearchPlanner({ providers, adapters, prompts, workflows, contracts } = {}) {
  return async function plan({ name, cityLabel, country, categories = [] } = {}) {
    const fallback = {
      category: categories[0] ?? null,
      queries: categories[0] && cityLabel ? [
        { query: `${categories[0]} ${cityLabel}`, intent: 'discovery', basis: 'observed-category' },
        { query: `${categories[0]} ${cityLabel} menu`, intent: 'menu', basis: 'observed-category' },
        { query: `${name} ${cityLabel}`, intent: 'brand', basis: 'business-name' },
      ] : [],
    };
    if (!categories.length || !cityLabel) return { status: 'PARTIAL', cause: 'IDENTITY_CATEGORY_NOT_OBSERVED', execution: 'not-run', plan: fallback, source: 'deterministic-fallback' };
    try {
      const active = await workflows.resolveActive('local-seo-research');
      const step = active.definition.steps.find(item => item.id === 'research-plan');
      if (!step || !step.provider || !step.promptRef || !step.contractRef) return { status: 'PARTIAL', cause: 'SEO_RESEARCH_WORKFLOW_INVALID', execution: 'not-run', plan: fallback, source: 'deterministic-fallback' };
      const adapter = adapters?.[step.provider];
      if (typeof adapter?.generate !== 'function') return { status: 'PARTIAL', cause: 'AI_ADAPTER_UNAVAILABLE', execution: 'not-run', plan: fallback, source: 'deterministic-fallback' };
      const context = await providers.executionContext(step.provider);
      const prompt = await prompts.get(step.promptRef);
      if (!prompt.activeVersionId) return { status: 'PARTIAL', cause: 'AI_PROMPT_NOT_ACTIVE', execution: 'not-run', plan: fallback, source: 'deterministic-fallback' };
      const promptText = await prompts.resolveRevision(step.promptRef, prompt.activeVersionId);
      const contract = await contracts.getActiveVersion(step.contractRef);
      const generated = await adapter.generate({
        secret: context.secret,
        model: step.model,
        system: parsePromptMarkdown(promptText).body,
        input: { name, locality: cityLabel, country, allowedCategories: categories },
        maxOutputTokens: step.maxOutputTokens ?? 700,
      });
      const output = validateJsonSchema(contract.schema, generated.output);
      const category = categories.find(item => normalize(item) === normalize(output.category));
      if (!category) return { status: 'PARTIAL', cause: 'AI_CATEGORY_NOT_OBSERVED', execution: 'real-http-call', plan: fallback, source: 'deterministic-fallback' };
      const queries = uniqueQueries((output.queries ?? []).map(item => {
        const query = clean(item?.query);
        if (!query || query.length > 120 || !includesText(query, cityLabel)) return null;
        if (item.basis === 'business-name' && !includesText(query, name)) return null;
        if (item.basis === 'observed-category' && !includesText(query, category)) return null;
        return { query, intent: item.intent, basis: item.basis };
      })).slice(0, MAX_QUERIES);
      if (!queries.length) return { status: 'PARTIAL', cause: 'AI_QUERY_PLAN_REJECTED', execution: 'real-http-call', plan: fallback, source: 'deterministic-fallback' };
      return { status: 'SUCCEEDED', execution: 'real-http-call', plan: { category, queries }, source: { workflowVersionId: active.versionId, promptVersionId: prompt.activeVersionId, contractVersionId: contract.versionId, provider: step.provider, model: step.model, maxOutputTokens: step.maxOutputTokens ?? 700, configuredBudget: step.budget, usage: generated.usage ?? null } };
    } catch (error) {
      return { status: 'PARTIAL', cause: error.code ?? 'AI_RESEARCH_PLAN_FAILED', execution: 'not-run', plan: fallback, source: 'deterministic-fallback' };
    }
  };
}
