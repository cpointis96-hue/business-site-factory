export const defaultImplementations = {
  'collect-query': async ({ input }) => ({ query: input.query ?? '' }),
  'domain-candidates': async ({ input }) => ({ candidates: [{ domain: `${String(input.query).toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`, source: 'local-candidate-generator', availability: 'unknown' }] }),
};

export function createProviderChatImplementation({ providers, adapters }) {
  return async ({ input, run, step }) => {
    const providerId = step.provider;
    if (!providerId) throw Object.assign(new Error('Provider IA absent.'), { code: 'AI_PROVIDER_REQUIRED' });
    const adapter = adapters[providerId];
    if (typeof adapter?.generate !== 'function') throw Object.assign(new Error('Génération IA non configurée.'), { code: 'AI_ADAPTER_UNAVAILABLE' });
    const context = await providers.executionContext(providerId);
    const snapshotStep = run.snapshot.steps.find(item => item.id === step.id);
    const generated = await adapter.generate({ secret: context.secret, model: snapshotStep?.model ?? step.model, system: snapshotStep?.promptText ?? '', input });
    return { __output: generated.output, __execution: { provider: providerId, model: snapshotStep?.model ?? step.model, usage: generated.usage } };
  };
}
