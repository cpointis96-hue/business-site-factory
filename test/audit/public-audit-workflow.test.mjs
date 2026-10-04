import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createMemorySecretStore } from '../../src/providers/memory-secret-store.mjs';
import { createPublicAuditWorkflow } from '../../src/audit/public-audit-workflow.mjs';

function providerState() {
  return { async list() { return [{ id: 'dataforseo', kind: 'seo', configured: true, enabled: true, health: 'healthy' }]; } };
}
function adapters(calls) {
  const result = { tasks: [{ result: [{ items: [{ title: 'Maison Sillage', url: 'https://example.com/', keyword: 'restaurant pattaya', keyword_info: { search_volume: 100 } }] }] }] };
  const dataforseo = {};
  for (const name of ['serpMapsLiveAdvanced', 'serpOrganicLiveAdvanced', 'businessListings', 'onPageInstantPages', 'keywordIdeasLive', 'keywordOverview', 'serpCompetitors', 'serpLocalFinder']) dataforseo[name] = async input => { calls.push({ name, input }); return result; };
  return { dataforseo };
}

test('compose un audit public DataForSEO borné, sourcé, partiel et idempotent sans appel réel', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-')); const store = createAtomicStore(root); const calls = [];
  const secretStore = createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'user', password: 'password' }) });
  const workflow = createPublicAuditWorkflow({ store, providers: providerState(), adapters: adapters(calls), secretStore, idFactory: prefix => `${prefix}-fixed`, clock: () => new Date('2026-08-27T00:00:00.000Z'), fetchImpl: async url => ({ url, status: 200, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => '<html lang="fr"><head><title>Site</title><meta name="description" content="ok"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com/"><script type="application/ld+json">{}</script></head><body><h1>Site</h1></body></html>' }), lookup: async () => ['93.184.216.34'] });
  const input = { name: 'Maison Sillage', city: { id: 'city-1', label: 'Pattaya', country: 'TH' }, domain: 'https://example.com', identity: { source: 'google-places', placeId: 'place-1', address: '1 Beach Road, Pattaya', coordinates: { latitude: 12.9, longitude: 100.9 }, primaryType: 'restaurant' }, idempotencyKey: 'public-1' };
  const first = await workflow.create(input);
  const gmbReport = (await workflow.readReport(first.id, 'gmb')).value; const finalReport = (await workflow.readReport(first.id, 'final')).value; assert.equal(gmbReport.includes('SUCCEEDED'), true); assert.equal(gmbReport.includes('Site et SEO'), false); assert.equal(finalReport.includes('Site et SEO'), true); assert.equal(finalReport.includes('Recherche'), true); assert.equal(finalReport.includes('Concurrence observée'), true); assert.equal(finalReport.includes('<table>'), true); assert.equal(finalReport.includes('restaurant pattaya'), true); assert.equal(finalReport.includes('Recommandations'), true);
  assert.equal(first.status, 'SUCCEEDED'); assert.equal(first.stages.length, 6); assert.equal(first.evidence.length, 8); assert.deepEqual(first.reports.map(item => item.kind).sort(), ['final', 'gmb']); assert.equal((await workflow.readReport(first.id, 'gmb')).value.includes('RAPPORT GMB'), true); assert.equal((await workflow.readReport(first.id, 'final')).value.includes('RAPPORT FINAL SEO'), true); assert.equal(first.modules.seo.status, 'SUCCEEDED'); assert.equal(first.modules.seo.external.onPage, 'SUCCEEDED'); assert.equal(first.modules.keywords.ideas[0].keyword, 'restaurant pattaya'); assert.equal(first.input.profile.maxPages, 50); assert.equal(first.input.profile.maxBytes, 25 * 1024 * 1024); assert.equal(first.input.profile.timeoutMs, 180000); assert.equal(first.budget.hardLimit, 0.5); assert.equal(Math.round(first.budget.spent * 100) / 100, 0.1); assert.equal(calls.length, 8); assert.deepEqual(calls.find(item => item.name === 'businessListings').input.tasks[0], { title: 'Maison Sillage', location_coordinate: '12.9,100.9,200', limit: 10 }); assert.deepEqual(calls.find(item => item.name === 'serpCompetitors').input.tasks[0].keywords, ['restaurant pattaya']); assert.equal(first.stages.every(item => Number.isInteger(item.durationMs) && item.durationMs >= 0), true); assert.equal(Number.isInteger(first.durationMs), true);
  assert.equal(first.evidence.every(item => item.provider === 'dataforseo' && item.rawPayloadHash.startsWith('sha256:')), true);
  assert.equal(JSON.stringify(first).includes('password'), false);
  const replay = await workflow.create(input); assert.equal(replay.id, first.id); assert.equal(calls.length, 8);
});

test('bloque avant tout appel provider sans enveloppe de coût connue', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-blocked-')); const calls = [];
  const secretStore = createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'user', password: 'password' }) });
  const workflow = createPublicAuditWorkflow({ store: createAtomicStore(root), providers: providerState(), adapters: adapters(calls), secretStore });
  const result = await workflow.create({ name: 'Maison Sillage', city: { id: 'city-1', label: 'Pattaya', country: 'TH' }, budget: { hardLimit: 0 } });
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.stages.every(item => item.status === 'BLOCKED'), true); assert.equal(calls.length, 0);
});

test('bloque la découverte essentielle sans provider DataForSEO prêt, sans fallback inventé', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-not-ready-')); const calls = [];
  const workflow = createPublicAuditWorkflow({
    store: createAtomicStore(root),
    providers: { async list() { return [{ id: 'dataforseo', kind: 'seo', configured: true, enabled: false, health: 'unhealthy' }]; } },
    adapters: adapters(calls),
    secretStore: createMemorySecretStore(),
  });
  const result = await workflow.create({ name: 'Maison Sillage', city: { id: 'city-1', label: 'Pattaya', country: 'TH' } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.stages[0].cause, 'DATAFORSEO_UNHEALTHY');
  assert.equal(result.provider.readiness, 'unhealthy');
  assert.deepEqual(result.modules.establishment.candidates, []);
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(result).includes('example.com'), false);
});

test('signale le provider non configuré avant la résolution des contrats', async () => {
  const calls = [];
  const configuredAdapters = adapters(calls);
  configuredAdapters.dataforseo.serpLocations = async () => { calls.push({ name: 'serpLocations' }); return { tasks: [] }; };
  configuredAdapters.dataforseo.serpLanguages = async () => { calls.push({ name: 'serpLanguages' }); return { tasks: [] }; };
  const workflow = createPublicAuditWorkflow({
    store: createAtomicStore(await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-not-configured-'))),
    providers: { async list() { return [{ id: 'dataforseo', kind: 'seo', configured: false, enabled: false, health: 'unknown' }]; } },
    adapters: configuredAdapters,
    secretStore: createMemorySecretStore(),
  });
  const result = await workflow.create({ name: 'Le Midi-Teyranais', city: { id: 'city-1', label: 'Teyran', country: 'FR' }, budget: { hardLimit: 0.5 } });
  assert.equal(result.stages[0].cause, 'DATAFORSEO_NOT_CONFIGURED');
  assert.equal(result.stages[0].execution, 'not-run');
  assert.equal(calls.length, 0);
  assert.equal(result.budget.spent, 0);
});

test('sépare les états provider et distingue un adapter de test sans réseau', async () => {
  const cases = [
    ['absent', null, 'DATAFORSEO_ABSENT'],
    ['not-configured', { id: 'dataforseo', kind: 'seo', configured: false, enabled: false, health: 'unknown' }, 'DATAFORSEO_NOT_CONFIGURED'],
    ['unhealthy', { id: 'dataforseo', kind: 'seo', configured: true, enabled: false, health: 'unhealthy' }, 'DATAFORSEO_UNHEALTHY'],
    ['disabled', { id: 'dataforseo', kind: 'seo', configured: true, enabled: false, health: 'healthy' }, 'DATAFORSEO_DISABLED'],
  ];
  for (const [state, provider, cause] of cases) {
    const calls = [];
    const workflow = createPublicAuditWorkflow({
      store: createAtomicStore(await mkdtemp(path.join(tmpdir(), `ancrage-public-audit-${state}-`))),
      providers: { async list() { return provider ? [provider] : []; } },
      adapters: adapters(calls),
      secretStore: createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'user', password: 'password' }) }),
    });
    const result = await workflow.create({ name: 'Maison Sillage', city: { id: 'city-1', label: 'Pattaya', country: 'TH' } });
    assert.equal(result.provider.readiness, state);
    assert.equal(result.stages[0].cause, cause);
    assert.equal(result.stages[0].execution, 'not-run');
    assert.equal(calls.length, 0);
  }

  const calls = [];
  const workflow = createPublicAuditWorkflow({ store: createAtomicStore(await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-adapter-'))), providers: providerState(), adapters: adapters(calls), secretStore: createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'user', password: 'password' }) }) });
  const result = await workflow.create({ name: 'Maison Sillage', city: { id: 'city-1', label: 'Pattaya', country: 'TH' }, domain: 'https://example.com', identity: { source: 'google-places', placeId: 'place-1', address: '1 Beach Road, Pattaya', primaryType: 'restaurant' } });
  assert.equal(result.provider.adapter, 'adapter');
  assert.equal(result.stages[0].execution, 'adapter-call-no-network');
  assert.equal(result.modules.keywords.execution.ideas, 'adapter-call-no-network');
});

test('bloque le crawl local et OnPage sans domaine confirmé sans inventer de site', async () => {
  const calls = [];
  const workflow = createPublicAuditWorkflow({
    store: createAtomicStore(await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-no-domain-'))),
    providers: providerState(),
    adapters: adapters(calls),
    secretStore: createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'user', password: 'password' }) }),
    fetchImpl: async () => { throw new Error('Le crawl local ne doit pas démarrer.'); },
  });
  const result = await workflow.create({ name: 'Maison Sillage', city: { id: 'city-1', label: 'Pattaya', country: 'TH' } });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.modules.site.confirmation.status, 'NOT_CONFIRMED');
  assert.equal(result.modules.seo.execution, 'not-run');
  assert.equal(result.modules.seo.external.crawl, 'BLOCKED');
  assert.equal(result.modules.seo.external.onPage, 'BLOCKED');
  assert.equal(result.stages.find(item => item.id === 'seo-audit').status, 'BLOCKED');
  assert.equal(calls.some(item => item.name === 'onPageInstantPages'), false);
  assert.doesNotMatch((await workflow.readReport(result.id, 'final')).value, /https:\/\/example\.com/);
  assert.equal(result.modules.gmb.confirmation.cause, 'GOOGLE_PLACES_COORDINATES_REQUIRED');
  assert.equal(calls.some(item => item.name === 'businessListings'), false);
});

test('résout les contrats SERP et Labs avant les appels payants', async () => {
  const calls = [];
  const configuredAdapters = adapters(calls);
  configuredAdapters.dataforseo.serpLocations = async () => ({ tasks: [{ result: [{ location_code: 2250, location_name: 'France', country_iso_code: 'FR' }] }] });
  configuredAdapters.dataforseo.serpLanguages = async () => ({ tasks: [{ result: [{ language_code: 'fr' }] }] });
  configuredAdapters.dataforseo.businessListingsLocations = async () => ({ tasks: [{ result: [{ location_name: 'France', country_iso_code: 'FR' }] }] });
  configuredAdapters.dataforseo.labsLocationsAndLanguages = async () => ({ tasks: [{ result: [{ location_code: 2250, country_iso_code: 'FR', available_languages: [{ language_code: 'fr', available_sources: ['google'] }] }] }] });
  const workflow = createPublicAuditWorkflow({
    store: createAtomicStore(await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-resolved-'))), providers: providerState(), adapters: configuredAdapters,
    secretStore: createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'user', password: 'password' }) }),
  });
  const result = await workflow.create({ name: 'Le Midi Teyranais', city: { id: 'city-1', label: 'Teyran', country: 'FR' }, identity: { source: 'google-places', placeId: 'place-1', address: '1 rue de la mairie', coordinates: { latitude: 43.68, longitude: 3.93 }, primaryType: 'restaurant' } });
  assert.deepEqual(calls.find(item => item.name === 'serpMapsLiveAdvanced').input.tasks[0], { keyword: 'Le Midi Teyranais Teyran', location_code: 2250, language_code: 'fr' });
  assert.deepEqual(calls.find(item => item.name === 'keywordIdeasLive').input.tasks[0], { keywords: ['restaurant Teyran', 'restaurant Teyran menu', 'Le Midi Teyranais Teyran'], location_code: 2250, language_code: 'fr', limit: 50, include_serp_info: false, include_clickstream_data: false });
  assert.equal(result.status, 'PARTIAL');
});

test('conserve la sélection Google Places même si la source GMB ne la corrobore pas', async () => {
  const calls = [];
  const configuredAdapters = adapters(calls);
  configuredAdapters.dataforseo.businessListings = async input => {
    calls.push({ name: 'businessListings', input });
    return { tasks: [{ result: [{ items: [{ title: 'Un autre établissement' }] }] }] };
  };
  const workflow = createPublicAuditWorkflow({
    store: createAtomicStore(await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-selection-'))), providers: providerState(), adapters: configuredAdapters,
    secretStore: createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'user', password: 'password' }) }),
    fetchImpl: async url => ({ url, status: 200, headers: { get: () => 'text/html' }, text: async () => '<title>Site</title><h1>Site</h1>' }), lookup: async () => ['93.184.216.34'],
  });
  const result = await workflow.create({ name: 'La Guinguette du Massillan', city: { id: 'city-1', label: 'Le Crès', country: 'FR' }, domain: 'https://www.schproutz.com', domainSource: 'google-places', identity: { source: 'google-places', placeId: 'place-1', address: 'D67, 34920 Le Crès, France' } });
  assert.equal(result.modules.establishment.selected.placeId, 'place-1');
  assert.equal(result.modules.site.confirmation.source, 'google-places');
  assert.equal(result.modules.gmb.confirmation.status, 'NOT_CONFIRMED');
  assert.match((await workflow.readReport(result.id, 'final')).value, /Établissement sélectionné/);
  assert.match((await workflow.readReport(result.id, 'gmb')).value, /Aucun établissement n’a été suffisamment corroboré/);
});

test('l’aperçu local sans GMB conserve l’adresse et n’appelle aucune source GMB', async () => {
  const calls = [];
  const workflow = createPublicAuditWorkflow({
    store: createAtomicStore(await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-local-'))), providers: providerState(), adapters: adapters(calls),
    secretStore: createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'user', password: 'password' }) }),
  });
  const result = await workflow.create({ name: 'Maison Sillage', city: { id: 'city-1', label: 'Pattaya', country: 'TH' }, address: '1 rue du Port, Pattaya' }, { mode: 'LOCAL_PREVIEW_WITHOUT_GMB' });
  assert.equal(result.input.address, '1 rue du Port, Pattaya');
  assert.equal(result.modules.gmb.confirmation.cause, 'LOCAL_PREVIEW_WITHOUT_GMB');
  assert.equal(result.reports.some(report => report.kind === 'gmb'), false);
  assert.equal(calls.some(item => item.name === 'serpMapsLiveAdvanced' || item.name === 'businessListings'), false);
});

test('signale une erreur de tâche provider au lieu de la compter comme un succès', async () => {
  const calls = [];
  const configuredAdapters = adapters(calls);
  configuredAdapters.dataforseo.keywordIdeasLive = async input => {
    calls.push({ name: 'keywordIdeasLive', input });
    return { tasks: [{ result: [{ items: [{ keyword: 'restaurant Le Crès', keyword_info: { search_volume: 20 } }] }] }] };
  };
  configuredAdapters.dataforseo.keywordOverview = async input => {
    calls.push({ name: 'keywordOverview', input });
    return { cost: 0, tasks_error: 1, tasks: [{ status_code: 40501, status_message: "Invalid Field: 'location_name'.", result: [] }] };
  };
  const workflow = createPublicAuditWorkflow({
    store: createAtomicStore(await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-task-failure-'))), providers: providerState(), adapters: configuredAdapters,
    secretStore: createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'user', password: 'password' }) }),
  });
  const result = await workflow.create({ name: 'Maison Sillage', city: { id: 'city-1', label: 'Le Crès', country: 'FR' }, identity: { source: 'google-places', placeId: 'place-1', address: '1 rue du Port, Le Crès', primaryType: 'restaurant' } });
  assert.equal(result.modules.keywords.overview.status, 'PARTIAL');
  assert.equal(result.modules.keywords.overview.cause, 'PROVIDER_TASK_FAILED');
  assert.equal('data' in result.modules.keywords.overview, false);
  assert.equal(calls.find(item => item.name === 'keywordOverview').input.tasks[0].location_name, 'France');
});

test('écarte les idées hors périmètre et n’hydrate pas une shortlist vide', async () => {
  const calls = [];
  const configuredAdapters = adapters(calls);
  configuredAdapters.dataforseo.keywordIdeasLive = async input => {
    calls.push({ name: 'keywordIdeasLive', input });
    return { tasks: [{ result: [{ items: [
      { keyword: 'menu cantine à Lyon', keyword_info: { search_volume: 800 } },
      { keyword: 'menu cantine monde', keyword_info: { search_volume: 500 } },
    ] }] }] };
  };
  const workflow = createPublicAuditWorkflow({
    store: createAtomicStore(await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-relevance-'))),
    providers: providerState(),
    adapters: configuredAdapters,
    secretStore: createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'user', password: 'password' }) }),
  });
  const result = await workflow.create({ name: 'Le Midi Teyranais', city: { id: 'city-1', label: 'Teyran', country: 'FR' }, identity: { source: 'google-places', placeId: 'place-1', address: '1 rue de la mairie, Teyran', primaryType: 'restaurant', coordinates: { latitude: 43.68, longitude: 3.93 } } });
  const report = (await workflow.readReport(result.id, 'final')).value;
  assert.deepEqual(result.modules.keywords.ideas, []);
  assert.equal(result.modules.keywords.overview.execution, 'not-run');
  assert.equal(result.modules.keywords.competitors.length, 0);
  assert.equal(calls.some(item => item.name === 'keywordOverview' || item.name === 'serpCompetitors'), false);
  assert.equal(report.includes('menu cantine'), false);
  assert.equal(result.status, 'PARTIAL');
});

test('ne dépasse jamais le plafond public de 0,50 USD demandé par le workflow', async () => {
  const calls = [];
  const workflow = createPublicAuditWorkflow({
    store: createAtomicStore(await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-cap-'))),
    providers: providerState(),
    adapters: adapters(calls),
    secretStore: createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'fixture-user', password: 'fixture-pass' }) }),
  });
  const result = await workflow.create({ name: 'Maison Sillage', city: { id: 'city-1', label: 'Pattaya', country: 'TH' }, budget: { hardLimit: 2 } });
  assert.equal(result.budget.hardLimit, 0.5);
});

test('ne présente pas l’établissement audité comme concurrent local', async () => {
  const calls = [];
  const configuredAdapters = adapters(calls);
  configuredAdapters.dataforseo.serpLocalFinder = async input => {
    calls.push({ name: 'serpLocalFinder', input });
    return { tasks: [{ result: [{ items: [
      { title: 'Le Midi-Teyranais', domain: 'restaurant-midi-teyranais.fr' },
      { title: 'Restaurant voisin', domain: 'voisin.example' },
    ] }] }] };
  };
  const workflow = createPublicAuditWorkflow({
    store: createAtomicStore(await mkdtemp(path.join(tmpdir(), 'ancrage-public-audit-self-'))),
    providers: providerState(),
    adapters: configuredAdapters,
    secretStore: createMemorySecretStore({ 'provider:dataforseo': JSON.stringify({ login: 'fixture-user', password: 'fixture-pass' }) }),
  });
  const result = await workflow.create({ name: 'Le Midi-Teyranais', city: { id: 'city-1', label: 'Teyran', country: 'FR' }, domain: 'https://restaurant-midi-teyranais.fr', identity: { source: 'google-places', placeId: 'place-1', address: '1 rue de la mairie, Teyran', coordinates: { latitude: 43.68, longitude: 3.93 }, primaryType: 'restaurant' } });
  assert.equal(result.modules.keywords.localCompetitors.some(item => item.title === 'Le Midi-Teyranais'), false);
  assert.equal(result.modules.keywords.localCompetitors.some(item => item.title === 'Restaurant voisin'), true);
});
