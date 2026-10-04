const DEFAULT_TIMEOUT_MS = 8000;

function timeoutSignal(timeoutMs) {
  return AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
}

async function requestJson(fetchImpl, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetchImpl(url, { ...options, signal: options.signal ?? timeoutSignal(timeoutMs) });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) {
    const providerCode = body?.error?.status ?? body?.error?.details?.find?.(item => item['@type']?.includes('ErrorInfo'))?.reason ?? null;
    throw Object.assign(new Error(`Provider returned ${response.status}`), { code: `HTTP_${response.status}`, providerCode });
  }
  return body;
}

function credential(secret) {
  if (typeof secret !== 'string' || !secret.trim()) throw Object.assign(new Error('Missing credential'), { code: 'MISSING_CREDENTIAL' });
  const value = secret.trim();
  if (value.startsWith('{')) {
    try { return JSON.parse(value); } catch { throw Object.assign(new Error('Invalid credential'), { code: 'INVALID_CREDENTIAL' }); }
  }
  return { key: value, token: value };
}

function dataForSeoCredential(secret) {
  if (typeof secret !== 'string' || !secret.trim()) throw Object.assign(new Error('Missing credential'), { code: 'MISSING_CREDENTIAL' });
  try {
    const value = JSON.parse(secret);
    if (typeof value.login !== 'string' || !value.login.trim() || typeof value.password !== 'string' || !value.password.trim()) throw new Error('invalid');
    return { login: value.login.trim(), password: value.password.trim() };
  } catch {
    throw Object.assign(new Error('DataForSEO credential must be JSON'), { code: 'INVALID_CREDENTIAL' });
  }
}

function dataForSeoRequest(fetchImpl, secret, path, { method = 'GET', body = undefined } = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { login, password } = dataForSeoCredential(secret);
  const headers = { authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return requestJson(fetchImpl, `https://api.dataforseo.com/v3/${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, timeoutMs).then(result => {
    if (result?.status_code !== undefined && result.status_code !== 20000) {
      throw Object.assign(new Error('DataForSEO rejected the request'), { code: `DATAFORSEO_${result.status_code}` });
    }
    return result;
  });
}

function bearer(url, { fetchImpl, token, timeoutMs }) {
  return requestJson(fetchImpl, url, { headers: { authorization: `Bearer ${token}` } }, timeoutMs);
}

function jsonHeaders(headers = {}) { return { ...headers, 'content-type': 'application/json' }; }

function parseGeneratedJson(body, provider) {
  const text = body?.choices?.[0]?.message?.content
    ?? body?.content?.find(item => item.type === 'text')?.text
    ?? body?.candidates?.[0]?.content?.parts?.find(item => typeof item.text === 'string')?.text;
  if (typeof text !== 'string') throw Object.assign(new Error(`${provider} returned no text`), { code: 'AI_EMPTY_OUTPUT' });
  try { return { output: JSON.parse(text), usage: body?.usage ?? null }; } catch { throw Object.assign(new Error(`${provider} returned invalid JSON`), { code: 'AI_INVALID_JSON' }); }
}

function chatAdapter({ fetchImpl, provider, endpoint, headers, body }) {
  return requestJson(fetchImpl, endpoint, { method: 'POST', headers: jsonHeaders(headers), body: JSON.stringify(body) }).then(result => parseGeneratedJson(result, provider));
}

function candidates(query) {
  const label = String(query).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 63);
  if (!label) throw Object.assign(new Error('Invalid domain query'), { code: 'INVALID_QUERY' });
  return [`${label}.com`, `${label}.net`, `${label}.org`];
}

function adapter(test, search = null) {
  const fn = async context => test(context);
  fn.search = search;
  return fn;
}

function normalizeModels(body) {
  const items = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return items.map(item => {
    const id = String(item?.id ?? item?.name ?? '').replace(/^models\//, '').trim();
    const name = String(item?.display_name ?? item?.displayName ?? item?.name ?? id).replace(/^models\//, '').trim();
    return id ? { id, name: name || id } : null;
  }).filter(Boolean);
}

export function createDefaultProviderAdapters({ fetchImpl = globalThis.fetch, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required');
  const openai = adapter(({ secret }) => bearer('https://api.openai.com/v1/models', { fetchImpl, token: credential(secret).key, timeoutMs }));
  openai.models = async ({ secret }) => normalizeModels(await bearer('https://api.openai.com/v1/models', { fetchImpl, token: credential(secret).key, timeoutMs }));
  openai.generate = ({ secret, model, system, input, maxOutputTokens = 700 }) => chatAdapter({ fetchImpl, provider: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', headers: { authorization: `Bearer ${credential(secret).key}` }, body: { model, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }], response_format: { type: 'json_object' }, max_completion_tokens: maxOutputTokens } });
  const anthropic = adapter(({ secret }) => requestJson(fetchImpl, 'https://api.anthropic.com/v1/models', { headers: { 'x-api-key': credential(secret).key, 'anthropic-version': '2023-06-01' } }, timeoutMs));
  anthropic.models = async ({ secret }) => normalizeModels(await requestJson(fetchImpl, 'https://api.anthropic.com/v1/models', { headers: { 'x-api-key': credential(secret).key, 'anthropic-version': '2023-06-01' } }, timeoutMs));
  anthropic.generate = ({ secret, model, system, input }) => chatAdapter({ fetchImpl, provider: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': credential(secret).key, 'anthropic-version': '2023-06-01' }, body: { model, max_tokens: 4096, system, messages: [{ role: 'user', content: JSON.stringify(input) }] } });
  const googleGemini = adapter(({ secret }) => requestJson(fetchImpl, 'https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': credential(secret).key } }, timeoutMs));
  googleGemini.models = async ({ secret }) => normalizeModels(await requestJson(fetchImpl, 'https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': credential(secret).key } }, timeoutMs));
  googleGemini.generate = ({ secret, model, system, input }) => chatAdapter({ fetchImpl, provider: 'google-gemini', endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, headers: { 'x-goog-api-key': credential(secret).key }, body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }], generationConfig: { responseMimeType: 'application/json' } } });
  const openrouter = adapter(({ secret }) => bearer('https://openrouter.ai/api/v1/models', { fetchImpl, token: credential(secret).key, timeoutMs }));
  openrouter.models = async ({ secret }) => normalizeModels(await bearer('https://openrouter.ai/api/v1/models', { fetchImpl, token: credential(secret).key, timeoutMs }));
  openrouter.generate = ({ secret, model, system, input }) => chatAdapter({ fetchImpl, provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', headers: { authorization: `Bearer ${credential(secret).key}` }, body: { model, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }], response_format: { type: 'json_object' } } });
  const dataforseo = adapter(({ secret }) => dataForSeoRequest(fetchImpl, secret, 'appendix/user_data', {}, timeoutMs));
  dataforseo.executionType = 'http';
  dataforseo.serp = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'serp/google/organic/task_post', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.serpMaps = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'serp/google/maps/task_post', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.serpMapsLiveAdvanced = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'serp/google/maps/live/advanced', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.serpLocalFinder = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'serp/google/local_finder/live/advanced', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.serpOrganicLiveAdvanced = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'serp/google/organic/live/advanced', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.serpLocations = ({ secret, country }) => dataForSeoRequest(fetchImpl, secret, `serp/google/locations${country ? `/${encodeURIComponent(String(country).toLowerCase())}` : ''}`, {}, timeoutMs);
  dataforseo.serpLanguages = ({ secret }) => dataForSeoRequest(fetchImpl, secret, 'serp/google/languages', {}, timeoutMs);
  dataforseo.businessListingsLocations = ({ secret }) => dataForSeoRequest(fetchImpl, secret, 'business_data/business_listings/locations', {}, timeoutMs);
  dataforseo.labsLocationsAndLanguages = ({ secret }) => dataForSeoRequest(fetchImpl, secret, 'dataforseo_labs/locations_and_languages', {}, timeoutMs);
  dataforseo.businessListings = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'business_data/business_listings/search/live', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.businessListingsCategories = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'business_data/business_listings/categories_aggregation/live', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.keywordSearchVolume = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'keywords_data/google/search_volume/task_post', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.keywordIdeas = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'keywords_data/google/keywords_for_keywords/task_post', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.keywordIdeasLive = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'dataforseo_labs/google/keyword_ideas/live', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.keywordOverview = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'dataforseo_labs/google/keyword_overview/live', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.rankedKeywords = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'dataforseo_labs/google/ranked_keywords/live', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.keywordsForSite = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'dataforseo_labs/google/keywords_for_site/live', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.serpCompetitors = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'dataforseo_labs/google/serp_competitors/live', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.domainIntersection = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'dataforseo_labs/google/domain_intersection/live', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.onPage = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'on_page/task_post', { method: 'POST', body: tasks }, timeoutMs);
  dataforseo.onPageInstantPages = ({ secret, tasks }) => dataForSeoRequest(fetchImpl, secret, 'on_page/instant_pages', { method: 'POST', body: tasks }, timeoutMs);

  const googlePlacesRequest = ({ secret, body }) => requestJson(fetchImpl, 'https://places.googleapis.com/v1/places:autocomplete', { method: 'POST', headers: { 'x-goog-api-key': credential(secret).key, 'content-type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs);
  const googlePlacesDetailsRequest = ({ secret, placeId }) => { const resource = String(placeId).startsWith('places/') ? String(placeId) : `places/${placeId}`; return requestJson(fetchImpl, `https://places.googleapis.com/v1/${resource}`, { headers: { 'x-goog-api-key': credential(secret).key, 'x-goog-fieldmask': 'id,displayName,formattedAddress,addressComponents,websiteUri,location,primaryType,primaryTypeDisplayName,types,businessStatus' } }, timeoutMs); };
  const googlePlaces = adapter(({ secret }) => googlePlacesRequest({ secret, body: { input: 'Paris', includedPrimaryTypes: ['(cities)'], includedRegionCodes: ['fr'] } }));
  googlePlaces.autocomplete = ({ secret, input, countryCode, mode = 'city' }) => googlePlacesRequest({ secret, body: { input, ...(mode === 'establishment' ? { includedPrimaryTypes: ['establishment'] } : { includedPrimaryTypes: ['(cities)'] }), ...(countryCode ? { includedRegionCodes: [countryCode.toLowerCase()] } : {}) } });
  googlePlaces.details = ({ secret, placeId }) => googlePlacesDetailsRequest({ secret, placeId });

  const cloudflare = adapter(({ secret }) => {
    const value = credential(secret);
    const accountId = value.accountId ?? env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) throw Object.assign(new Error('Cloudflare account id required'), { code: 'MISSING_ACCOUNT_ID' });
    return bearer(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/registrar/extensions`, { fetchImpl, token: value.token, timeoutMs });
  }, async ({ secret, query }) => {
    const value = credential(secret);
    const accountId = value.accountId ?? env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) throw Object.assign(new Error('Cloudflare account id required'), { code: 'MISSING_ACCOUNT_ID' });
    const body = await bearer(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/registrar/domain-search?q=${encodeURIComponent(query)}&limit=10`, { fetchImpl, token: value.token, timeoutMs });
    return body?.result?.domains ?? [];
  });

  const dynadot = adapter(async ({ secret }) => {
    const value = credential(secret);
    await requestJson(fetchImpl, `https://api.dynadot.com/api3.json?key=${encodeURIComponent(value.key)}&command=search&domain0=example.com`, {}, timeoutMs);
  }, async ({ secret, query }) => {
    const domains = candidates(query);
    const params = new URLSearchParams({ key: credential(secret).key, command: 'search', show_price: '1', currency: 'USD' });
    domains.forEach((domain, index) => params.set(`domain${index}`, domain));
    const body = await requestJson(fetchImpl, `https://api.dynadot.com/api3.json?${params}`, {}, timeoutMs);
    return body?.SearchResponse?.SearchResults ?? [];
  });

  const namesilo = adapter(({ secret }) => requestJson(fetchImpl, `https://www.namesilo.com/api/getAccountInfo?version=1&type=json&key=${encodeURIComponent(credential(secret).key)}`, {}, timeoutMs), async ({ secret, query }) => {
    const domains = candidates(query).join(',');
    const body = await requestJson(fetchImpl, `https://www.namesilo.com/api/checkRegisterAvailability?version=1&type=json&key=${encodeURIComponent(credential(secret).key)}&domains=${encodeURIComponent(domains)}`, {}, timeoutMs);
    return body?.reply?.available ?? body?.reply?.domains ?? [];
  });

  const nameCom = adapter(async ({ secret }) => {
    const value = credential(secret);
    const username = value.username ?? env.NAMECOM_USERNAME;
    if (!username) throw Object.assign(new Error('Name.com username required'), { code: 'MISSING_USERNAME' });
    await requestJson(fetchImpl, `${env.NAMECOM_API_BASE_URL ?? 'https://api.name.com/core/v1'}/domains:checkAvailability`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${username}:${value.token}`).toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify({ domainNames: ['example.com'], purchaseType: 'registration' }) }, timeoutMs);
  }, async ({ secret, query }) => {
    const value = credential(secret);
    const username = value.username ?? env.NAMECOM_USERNAME;
    if (!username) throw Object.assign(new Error('Name.com username required'), { code: 'MISSING_USERNAME' });
    const body = await requestJson(fetchImpl, `${env.NAMECOM_API_BASE_URL ?? 'https://api.name.com/core/v1'}/domains:checkAvailability`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${username}:${value.token}`).toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify({ domainNames: candidates(query), purchaseType: 'registration' }) }, timeoutMs);
    return body?.results ?? [];
  });

  return { anthropic, cloudflare, dataforseo, dynadot, googleGemini, 'google-gemini': googleGemini, googlePlaces, 'google-places': googlePlaces, nameCom, namesilo, openai, openrouter };
}
