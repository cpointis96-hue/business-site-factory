const INTENT_RULES = [
  { name: 'menu', terms: ['menu', 'carte'] },
  { name: 'reservation', terms: ['reservation', 'reserver', 'book', 'booking'] },
  { name: 'delivery', terms: ['livraison', 'delivery', 'deliveroo', 'uber eats'] },
  { name: 'contact', terms: ['contact', 'telephone', 'adresse', 'horaires'] },
];

const GENERIC_CATEGORY_QUERIES = new Set([
  'restaurant',
  'restaurant menu',
  'menu restaurant',
  'menu de restaurant',
  'menu du restaurant',
  'carte de restaurant',
  'carte menu restaurant',
  'cuisine restaurant',
  'fait maison restaurant menu',
]);
const OFF_TOPIC_TERMS = ['cantine', 'scolaire', 'ikea', 'porte menu', 'guide michelin', 'pdf'];

function normalize(value) {
  return String(value ?? '')
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(value) { return normalize(value).split(' ').filter(Boolean); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function flattenItems(result) {
  return (result?.tasks ?? result?.data?.tasks ?? [])
    .flatMap(task => task?.result ?? [])
    .flatMap(item => Array.isArray(item?.items) ? item.items : [item])
    .filter(item => item && typeof item === 'object');
}

function significantWords(value) { return words(value).filter(word => word.length >= 3); }

function includesPhraseOrWords(haystack, phrase) {
  const normalizedHaystack = normalize(haystack);
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return false;
  if (normalizedHaystack.includes(normalizedPhrase)) return true;
  const wanted = significantWords(normalizedPhrase);
  return wanted.length > 0 && wanted.every(word => normalizedHaystack.split(' ').includes(word));
}

function categoryValues(identity = {}) {
  return [identity.primaryTypeDisplayName, identity.primaryType]
    .filter(value => typeof value === 'string' && value.trim());
}

function keywordValue(item) {
  return item?.keyword ?? item?.keyword_data?.keyword ?? item?.keyword_info?.keyword ?? null;
}

function keywordInfo(item) {
  return item?.keyword_info ?? item?.keyword_data?.keyword_info ?? {};
}

function keywordIntent(item, keyword) {
  const providerIntent = item?.search_intent_info?.main_intent ?? item?.keyword_data?.search_intent_info?.main_intent;
  if (typeof providerIntent === 'string' && providerIntent.trim()) return providerIntent.trim().toLowerCase();
  const normalized = normalize(keyword);
  return INTENT_RULES.find(rule => rule.terms.some(term => normalized.includes(normalize(term))))?.name ?? 'discovery';
}

function keywordMatchesName(keyword, name) {
  return Boolean(name) && includesPhraseOrWords(keyword, name);
}

function hasNamedNoise(keyword, plan) {
  const normalized = normalize(keyword);
  if (OFF_TOPIC_TERMS.some(term => normalized.includes(normalize(term)))) return true;
  if (String(keyword).includes("'") || String(keyword).includes('’')) return true;
  if (plan.locality && includesPhraseOrWords(keyword, plan.locality)) return false;
  if (plan.name && keywordMatchesName(keyword, plan.name)) return false;
  return !GENERIC_CATEGORY_QUERIES.has(normalized);
}

function domainOf(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`);
    return url.hostname.toLocaleLowerCase('en').replace(/^www\./, '') || null;
  } catch { return null; }
}

export function buildSeoResearchPlan({ name, cityLabel, country, identity = {}, planned = null } = {}) {
  const locality = String(cityLabel ?? '').trim();
  const anchors = unique(categoryValues(identity).map(normalize).filter(Boolean));
  const primaryAnchor = anchors[0] ?? null;
  const plannedQueries = Array.isArray(planned?.queries) ? planned.queries : [];
  const seeds = plannedQueries.length
    ? unique(plannedQueries.map(item => String(item?.query ?? '').trim()).filter(Boolean)).slice(0, 6)
    : primaryAnchor && locality
    ? unique([
      `${primaryAnchor} ${locality}`,
      `${primaryAnchor} ${locality} menu`,
      name ? `${name} ${locality}` : `${primaryAnchor} ${locality} reservation`,
    ])
    : [];
  return {
    locality,
    name: String(name ?? '').trim(),
    country: String(country ?? '').trim().toUpperCase() || null,
    anchors,
    category: planned?.category ?? primaryAnchor,
    seeds,
    scope: primaryAnchor ? 'local-business-category' : 'local-business-category-unknown',
    planner: plannedQueries.length ? 'configured-ai' : 'deterministic-fallback',
    reasons: primaryAnchor ? ['OBSERVED_PRIMARY_CATEGORY'] : ['IDENTITY_CATEGORY_NOT_OBSERVED'],
  };
}

function normalizedKeywordRow(item, plan) {
  const keyword = String(keywordValue(item) ?? '').trim();
  if (!keyword) return null;
  const info = keywordInfo(item);
  const localityMatch = includesPhraseOrWords(keyword, plan.locality);
  const businessMatch = plan.anchors.some(anchor => includesPhraseOrWords(keyword, anchor));
  const nameMatch = keywordMatchesName(keyword, plan.name);
  const intent = keywordIntent(item, keyword);
  const searchVolume = info.search_volume ?? null;
  const competition = info.competition ?? null;
  const cpc = info.cpc ?? null;
  const keywordDifficulty = info.keyword_difficulty ?? item?.keyword_data?.keyword_info?.keyword_difficulty ?? null;
  const priority = (localityMatch ? 50 : 0) + (businessMatch ? 35 : 0) + (intent !== 'discovery' ? 10 : 0) + (typeof searchVolume === 'number' && searchVolume > 0 ? 5 : 0) + (typeof keywordDifficulty === 'number' ? 5 : 0);
  return {
    keyword,
    canonicalKeyword: normalize(keyword),
    searchVolume,
    competition,
    cpc,
    keywordDifficulty,
    intent,
    source: item?.source ?? item?.keyword_data?.source ?? null,
    sourceSeed: item?.seed ?? item?.source_seed ?? item?.keyword_data?.seed ?? null,
    localityMatch,
    businessMatch,
    nameMatch,
    scope: localityMatch ? 'local-query' : 'market-query',
    evidence: localityMatch && businessMatch ? 'category-and-locality' : businessMatch ? 'observed-category' : 'unconfirmed',
    priority,
  };
}

export function qualifyKeywordResults(result, plan) {
  const selected = [];
  const rejected = [];
  const seen = new Set();
  for (const item of flattenItems(result)) {
    const row = normalizedKeywordRow(item, plan);
    if (!row) continue;
    if (seen.has(row.canonicalKeyword)) continue;
    seen.add(row.canonicalKeyword);
    const reason = !plan.anchors.length
      ? 'BUSINESS_CATEGORY_NOT_OBSERVED'
      : !row.businessMatch ? 'BUSINESS_ANCHOR_NOT_CONFIRMED'
        : hasNamedNoise(row.keyword, plan) ? 'QUERY_NOT_RELEVANT_TO_LOCAL_BUSINESS'
          : null;
    if (reason) rejected.push({ ...row, reason });
    else selected.push(row);
  }
  selected.sort((left, right) => right.priority - left.priority || (right.searchVolume ?? -1) - (left.searchVolume ?? -1) || left.canonicalKeyword.localeCompare(right.canonicalKeyword));
  const shortlist = selected.slice(0, 12);
  rejected.push(...selected.slice(12).map(item => ({ ...item, reason: 'SHORTLIST_LIMIT' })));
  return { selected: shortlist, rejected, sourceCount: shortlist.length + rejected.length };
}

export function mergeKeywordMetrics(rows, metrics) {
  const byKeyword = new Map(metrics.map(item => [item.canonicalKeyword, item]));
  return rows.map(row => {
    const enriched = byKeyword.get(row.canonicalKeyword);
    if (!enriched) return row;
    return {
      ...row,
      searchVolume: enriched.searchVolume ?? row.searchVolume,
      competition: enriched.competition ?? row.competition,
      cpc: enriched.cpc ?? row.cpc,
      keywordDifficulty: enriched.keywordDifficulty ?? row.keywordDifficulty,
      intent: enriched.intent ?? row.intent,
      metricSource: 'keyword-overview',
    };
  });
}

function competitorMetrics(item) {
  const data = item?.keyword_data ?? item?.metrics ?? item;
  return {
    keywordsCount: data?.keywords_count ?? data?.keyword_count ?? null,
    avgPosition: data?.avg_position ?? data?.average_position ?? null,
    medianPosition: data?.median_position ?? null,
    visibility: data?.visibility ?? null,
    trafficEstimate: data?.etv ?? data?.traffic_estimate ?? null,
  };
}

export function qualifyCompetitorResults(result, { targetDomain = null, selectedKeywords = [], locality = null } = {}) {
  const target = domainOf(targetDomain);
  const wanted = new Set(selectedKeywords.map(value => normalize(typeof value === 'string' ? value : value?.keyword)).filter(Boolean));
  const byDomain = new Map();
  for (const item of flattenItems(result)) {
    const domain = domainOf(item?.domain ?? item?.url ?? item?.target);
    if (!domain || domain === target) continue;
    const metrics = competitorMetrics(item);
    const rawKeywords = Array.isArray(item?.keywords) ? item.keywords : item?.keyword ? [item.keyword] : [];
    const matchedKeywords = rawKeywords.map(value => String(value).trim()).filter(value => wanted.has(normalize(value)));
    if (!matchedKeywords.length) continue;
    const existing = byDomain.get(domain);
    const row = {
      domain,
      title: item?.title ?? item?.name ?? null,
      scope: 'national-seo',
      locality: locality ?? null,
      classification: 'SEO_COMPETITOR_CANDIDATE',
      matchedKeywords,
      ...metrics,
      source: item?.source ?? 'dataforseo_labs_serp_competitors',
    };
    if (!existing) byDomain.set(domain, row);
    else byDomain.set(domain, {
      ...existing,
      matchedKeywords: unique([...existing.matchedKeywords, ...matchedKeywords]),
      keywordsCount: Math.max(existing.keywordsCount ?? 0, row.keywordsCount ?? 0) || null,
      visibility: Math.max(existing.visibility ?? 0, row.visibility ?? 0) || null,
    });
  }
  return [...byDomain.values()].sort((left, right) => (right.visibility ?? -1) - (left.visibility ?? -1) || (left.avgPosition ?? Infinity) - (right.avgPosition ?? Infinity) || left.domain.localeCompare(right.domain));
}

export { domainOf, normalize };
