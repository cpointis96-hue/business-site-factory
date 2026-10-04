import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProviderAdapters } from '../../src/providers/http-adapters.mjs';

function fakeFetch(calls) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: { domains: [] }, results: [], SearchResponse: { SearchResults: [] }, reply: { available: [] } }) };
  };
}

test('utilise le schéma d’authentification officiel de chaque provider', async () => {
  const calls = [];
  const adapters = createDefaultProviderAdapters({ fetchImpl: fakeFetch(calls), env: { CLOUDFLARE_ACCOUNT_ID: 'account', NAMECOM_USERNAME: 'user' } });
  await adapters.openai({ secret: 'openai-key' });
  await adapters.anthropic({ secret: 'anthropic-key' });
  await adapters.googleGemini({ secret: 'gemini-key' });
  await adapters.openrouter({ secret: 'router-key' });
  await adapters.cloudflare({ secret: 'cloudflare-key' });
  await adapters.dynadot({ secret: 'dynadot-key' });
  await adapters.namesilo({ secret: 'namesilo-key' });
  await adapters.nameCom({ secret: 'name-key' });
  assert.equal(calls[0].options.headers.authorization, 'Bearer openai-key');
  assert.equal(calls[1].options.headers['x-api-key'], 'anthropic-key');
  assert.equal(calls[2].options.headers['x-goog-api-key'], 'gemini-key');
  assert.equal(calls[3].options.headers.authorization, 'Bearer router-key');
  assert.equal(calls[4].options.headers.authorization, 'Bearer cloudflare-key');
  assert.match(calls[5].url, /key=dynadot-key/);
  assert.match(calls[6].url, /key=namesilo-key/);
  assert.match(calls[7].options.headers.authorization, /^Basic /);
});

test('accepte les credentials structurés nécessaires aux APIs composites', async () => {
  const calls = [];
  const adapters = createDefaultProviderAdapters({ fetchImpl: fakeFetch(calls), env: {} });
  await adapters.cloudflare({ secret: JSON.stringify({ token: 'token', accountId: 'account' }) });
  await adapters.nameCom({ secret: JSON.stringify({ token: 'token', username: 'user' }) });
  assert.equal(calls[0].options.headers.authorization, 'Bearer token');
  assert.match(calls[1].options.headers.authorization, /^Basic /);
});

test('recherche un établissement et demande uniquement ses détails d’adresse', async () => {
  const calls = [];
  const adapters = createDefaultProviderAdapters({ fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const body = String(url).includes('/places:autocomplete') ? { suggestions: [] } : { id: 'places/ChIJtest', displayName: { text: 'Chez Test' }, addressComponents: [], location: { latitude: 43.6, longitude: 1.44 } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  } });
  await adapters.googlePlaces.autocomplete({ secret: 'places-key', input: 'Chez Test', mode: 'establishment' });
  await adapters.googlePlaces.details({ secret: 'places-key', placeId: 'ChIJtest' });
  assert.deepEqual(JSON.parse(calls[0].options.body), { input: 'Chez Test', includedPrimaryTypes: ['establishment'] });
  assert.match(calls[1].url, /places\/ChIJtest$/);
  assert.equal(calls[1].options.headers['x-goog-fieldmask'], 'id,displayName,formattedAddress,addressComponents,websiteUri,location,primaryType,primaryTypeDisplayName,types,businessStatus');
});

test('génère du JSON avec les adapters IA autorisés', async () => {
  const calls = [];
  const adapters = createDefaultProviderAdapters({ fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const body = String(url).includes('anthropic') ? { content: [{ type: 'text', text: '{"sections":[]}' }], usage: { input_tokens: 2 } } : String(url).includes('generativelanguage') ? { candidates: [{ content: { parts: [{ text: '{"sections":[]}' }] } }] } : { choices: [{ message: { content: '{"sections":[]}' } }], usage: { total_tokens: 3 } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  } });
  const outputs = [];
  for (const [id, adapter] of [['openai', adapters.openai], ['anthropic', adapters.anthropic], ['google-gemini', adapters['google-gemini']], ['openrouter', adapters.openrouter]]) {
    const result = await adapter.generate({ secret: `${id}-key`, model: 'model-test', system: 'Retourne JSON.', input: { value: 1 } });
    assert.deepEqual(result.output, { sections: [] });
    outputs.push(result);
  }
  assert.equal(calls.length, 4);
  assert.equal(JSON.stringify(calls).includes('model-test'), true);
  assert.equal(calls.some(call => call.url.includes('gemini-key')), false);
  assert.equal(JSON.stringify(outputs).includes('-key'), false);
});

test('borne la réponse OpenAI configurée sans exposer le credential', async () => {
  const calls = [];
  const adapters = createDefaultProviderAdapters({ fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{}' } }] }) };
  } });
  await adapters.openai.generate({ secret: 'openai-secret', model: 'model-test', system: 'JSON', input: {}, maxOutputTokens: 700 });
  assert.equal(JSON.parse(calls[0].options.body).max_completion_tokens, 700);
  assert.equal(JSON.stringify(calls).includes('openai-secret'), true);
});

test('découvre les modèles IA sans exposer le credential', async () => {
  const calls = [];
  const adapters = createDefaultProviderAdapters({ fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const body = String(url).includes('anthropic') ? { data: [{ id: 'claude-test', display_name: 'Claude test' }] } : String(url).includes('generativelanguage') ? { models: [{ name: 'models/gemini-test', displayName: 'Gemini test' }] } : { data: [{ id: 'model-test', owned_by: 'provider' }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  } });
  const results = await Promise.all([
    adapters.openai.models({ secret: 'openai-secret' }),
    adapters.anthropic.models({ secret: 'anthropic-secret' }),
    adapters['google-gemini'].models({ secret: 'gemini-secret' }),
    adapters.openrouter.models({ secret: 'openrouter-secret' }),
  ]);
  assert.deepEqual(results.map(models => models[0].id), ['model-test', 'claude-test', 'gemini-test', 'model-test']);
  assert.deepEqual(results.map(models => models[0].name), ['model-test', 'Claude test', 'Gemini test', 'model-test']);
  assert.equal(JSON.stringify(results).includes('secret'), false);
  assert.equal(calls.length, 4);
});

test('utilise un seul credential DataForSEO pour les capacités SEO', async () => {
  const calls = [];
  const adapters = createDefaultProviderAdapters({ fetchImpl: fakeFetch(calls) });
  const secret = JSON.stringify({ login: 'user@example.com', password: 'api-password' });
  await adapters.dataforseo({ secret });
  await adapters.dataforseo.serp({ secret, tasks: [{ keyword: 'restaurant', location_name: 'Pattaya', language_code: 'en' }] });
  await adapters.dataforseo.serpMaps({ secret, tasks: [{ keyword: 'restaurant', location_name: 'Pattaya', language_code: 'en' }] });
  await adapters.dataforseo.serpMapsLiveAdvanced({ secret, tasks: [{ keyword: 'restaurant', location_name: 'Pattaya', language_code: 'en' }] });
  await adapters.dataforseo.serpLocalFinder({ secret, tasks: [{ keyword: 'restaurant', location_name: 'Pattaya', language_code: 'en' }] });
  await adapters.dataforseo.serpOrganicLiveAdvanced({ secret, tasks: [{ keyword: 'restaurant', location_name: 'Pattaya', language_code: 'en' }] });
  await adapters.dataforseo.businessListings({ secret, tasks: [{ categories: ['restaurant'], location_coordinate: { latitude: 12.9, longitude: 100.9, radius: 5 } }] });
  await adapters.dataforseo.businessListingsCategories({ secret, tasks: [{ location_name: 'Pattaya' }] });
  await adapters.dataforseo.keywordSearchVolume({ secret, tasks: [{ keywords: ['restaurant'] }] });
  await adapters.dataforseo.keywordIdeasLive({ secret, tasks: [{ keywords: ['restaurant'], location_name: 'Pattaya', language_code: 'en' }] });
  await adapters.dataforseo.keywordOverview({ secret, tasks: [{ keywords: ['restaurant'], location_code: 2410, language_code: 'en' }] });
  await adapters.dataforseo.rankedKeywords({ secret, tasks: [{ target: 'example.com', location_code: 2410, language_code: 'en' }] });
  await adapters.dataforseo.keywordsForSite({ secret, tasks: [{ target: 'example.com', location_code: 2410, language_code: 'en' }] });
  await adapters.dataforseo.serpCompetitors({ secret, tasks: [{ keywords: ['restaurant'], location_code: 2410, language_code: 'en' }] });
  await adapters.dataforseo.domainIntersection({ secret, tasks: [{ target1: 'example.com', target2: 'competitor.com', location_code: 2410, language_code: 'en' }] });
  await adapters.dataforseo.onPage({ secret, tasks: [{ target: 'example.com', max_crawl_pages: 1 }] });
  await adapters.dataforseo.onPageInstantPages({ secret, tasks: [{ url: 'https://example.com/' }] });
  assert.equal(calls.length, 17);
  assert.equal(calls.every(call => /^Basic /.test(call.options.headers.authorization)), true);
  assert.equal(calls.every(call => !JSON.stringify(call).includes('api-password')), true);
  assert.match(calls[1].url, /api\.dataforseo\.com\/v3\/serp\/google\/organic\/task_post/);
  for (const path of [
    '/serp/google/maps/task_post',
    '/serp/google/maps/live/advanced',
    '/serp/google/local_finder/live/advanced',
    '/serp/google/organic/live/advanced',
    '/business_data/business_listings/search/live',
    '/business_data/business_listings/categories_aggregation/live',
    '/dataforseo_labs/google/keyword_overview/live',
    '/dataforseo_labs/google/keyword_ideas/live',
    '/dataforseo_labs/google/ranked_keywords/live',
    '/dataforseo_labs/google/keywords_for_site/live',
    '/dataforseo_labs/google/serp_competitors/live',
    '/dataforseo_labs/google/domain_intersection/live',
    '/on_page/task_post',
    '/on_page/instant_pages',
  ]) assert.equal(calls.some(call => call.url.includes(`/v3${path}`)), true, path);
});

test('normalise le credential DataForSEO et refuse une erreur API dans une réponse HTTP 200', async () => {
  const calls = [];
  const adapters = createDefaultProviderAdapters({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return { ok: true, status: 200, text: async () => JSON.stringify({ status_code: 40100, status_message: 'Unauthorized' }) };
    },
  });
  await assert.rejects(
    () => adapters.dataforseo({ secret: JSON.stringify({ login: ' user@example.com ', password: ' api-password\n' }) }),
    error => error.code === 'DATAFORSEO_40100',
  );
  assert.equal(Buffer.from('user@example.com:api-password').toString('base64'), calls[0].options.headers.authorization.slice(6));
});

test('expose les résolutions gratuites propres à chaque famille DataForSEO', async () => {
  const calls = [];
  const adapters = createDefaultProviderAdapters({ fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ status_code: 20000, tasks: [{ result: [] }] }) };
  } });
  const secret = JSON.stringify({ login: 'user', password: 'password' });
  await adapters.dataforseo.serpLocations({ secret, country: 'FR' });
  await adapters.dataforseo.serpLanguages({ secret });
  await adapters.dataforseo.businessListingsLocations({ secret, country: 'FR' });
  await adapters.dataforseo.labsLocationsAndLanguages({ secret });
  assert.deepEqual(calls.map(call => call.url), [
    'https://api.dataforseo.com/v3/serp/google/locations/fr',
    'https://api.dataforseo.com/v3/serp/google/languages',
    'https://api.dataforseo.com/v3/business_data/business_listings/locations',
    'https://api.dataforseo.com/v3/dataforseo_labs/locations_and_languages',
  ]);
  assert.equal(calls.every(call => /^Basic /.test(call.options.headers.authorization)), true);
});

test('recherche avec les adapters registrar sans divulguer la clé dans le résultat', async () => {
  const calls = [];
  const adapters = createDefaultProviderAdapters({ fetchImpl: fakeFetch(calls), env: { CLOUDFLARE_ACCOUNT_ID: 'account', NAMECOM_USERNAME: 'user' } });
  const results = await Promise.all([
    adapters.cloudflare.search({ secret: 'secret', query: 'Maison Sillage' }),
    adapters.dynadot.search({ secret: 'secret', query: 'Maison Sillage' }),
    adapters.namesilo.search({ secret: 'secret', query: 'Maison Sillage' }),
    adapters.nameCom.search({ secret: 'secret', query: 'Maison Sillage' }),
  ]);
  assert.equal(calls.length, 4);
  assert.equal(JSON.stringify(results).includes('secret'), false);
});
