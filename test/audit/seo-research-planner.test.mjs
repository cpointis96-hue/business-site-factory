import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeoResearchPlanner } from '../../src/audit/seo-research-planner.mjs';

const prompt = `---
id: local-seo-research-planner
name: Plan de recherche SEO locale
ownerStep: research-plan
outputContract: seo-research-plan
---
Retourne du JSON.`;

const schema = {
  type: 'object', required: ['category', 'queries'], additionalProperties: false,
  properties: {
    category: { type: 'string' },
    queries: { type: 'array', items: { type: 'object', required: ['query', 'intent', 'basis'], additionalProperties: false, properties: { query: { type: 'string' }, intent: { type: 'string' }, basis: { type: 'string' } } } },
  },
};

function dependencies(output) {
  return {
    providers: { async executionContext() { return { secret: 'test-secret' }; } },
    adapters: { openai: { async generate(input) { return { output, usage: { total_tokens: 12 }, input }; } } },
    prompts: { async get() { return { activeVersionId: 'prompt-v1' }; }, async resolveRevision() { return prompt; } },
    contracts: { async getActiveVersion() { return { versionId: 'contract-v1', schema }; } },
    workflows: { async resolveActive() { return { versionId: 'workflow-v1', definition: { steps: [{ id: 'research-plan', provider: 'openai', model: 'gpt-5.4-mini', promptRef: 'local-seo-research-planner', contractRef: 'seo-research-plan', maxOutputTokens: 700, budget: 0.05 }] } }; } },
  };
}

test('exécute le plan IA configuré et borne sa sortie', async () => {
  const output = { category: 'restaurant', queries: [{ query: 'restaurant Assas', intent: 'discovery', basis: 'observed-category' }] };
  const planner = createSeoResearchPlanner(dependencies(output));
  const result = await planner({ name: 'La Mameta', cityLabel: 'Assas', country: 'FR', categories: ['restaurant'] });
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.plan.queries[0].query, 'restaurant Assas');
  assert.equal(result.source.maxOutputTokens, 700);
});

test('retombe sur un plan déterministe lorsque l’IA invente une catégorie', async () => {
  const output = { category: 'cantine', queries: [{ query: 'cantine Assas', intent: 'discovery', basis: 'observed-category' }] };
  const planner = createSeoResearchPlanner(dependencies(output));
  const result = await planner({ name: 'La Mameta', cityLabel: 'Assas', country: 'FR', categories: ['restaurant'] });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.cause, 'AI_CATEGORY_NOT_OBSERVED');
  assert.equal(result.plan.category, 'restaurant');
});
