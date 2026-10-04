import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSeoAudit } from '../../src/audit/seo-audit.mjs';
import { renderSeoAuditReport } from '../../src/audit/audit-report.mjs';
import { runSeoAudit } from '../../src/audit/seo-audit-service.mjs';

const observedAt = '2026-08-27T11:00:00.000Z';
const target = 'https://fixture.example.test/';
const page = ({ html, url = target, status = 200, crawlStatus = 'complete' }) => ({ html, url, status, crawlStatus, source: 'synthetic-fixture' });
const healthy = '<html lang="en"><head><title>Example</title><meta name="description" content="Example page"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://fixture.example.test/"><script type="application/ld+json">{}</script></head><body><h1>Example</h1></body></html>';

const fixtures = [
  { id: 'static', pages: [page({ html: healthy })], status: 'SUCCEEDED', codes: [] },
  { id: 'wordpress', pages: [page({ html: '<html lang="en"><head><title>WordPress restaurant</title><meta name="description" content="Menu"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://fixture.example.test/"></head><body><h1>WordPress restaurant</h1></body></html>' })], status: 'SUCCEEDED', codes: ['MISSING_STRUCTURED_DATA'] },
  { id: 'multilingual', pages: [page({ html: healthy }), page({ url: `${target}fr`, html: healthy.replace('Example', 'Exemple') })], status: 'SUCCEEDED', codes: [] },
  { id: 'javascript', pages: [page({ html: '<html lang="en"><head><title>JavaScript site</title><meta name="viewport" content="width=device-width"></head><body><div id="root"></div><script>document.querySelector("#root").innerHTML = "<h1>Rendered later</h1>";</script></body></html>' })], status: 'SUCCEEDED', codes: ['MISSING_META_DESCRIPTION', 'MISSING_CANONICAL', 'MISSING_STRUCTURED_DATA'] },
  { id: 'intentional-errors', pages: [page({ html: '<html><head><h1>One</h1><h1>Two</h1></head><body><img src="dish.jpg"></body></html>' })], status: 'SUCCEEDED', codes: ['MISSING_TITLE', 'MISSING_META_DESCRIPTION', 'MISSING_VIEWPORT', 'MISSING_CANONICAL', 'MISSING_HTML_LANG', 'MISSING_STRUCTURED_DATA', 'MULTIPLE_H1', 'MISSING_IMAGE_ALT'] },
  { id: 'crawl-blocked', pages: [page({ html: '', status: 403, crawlStatus: 'blocked' })], status: 'PARTIAL', codes: ['CRAWL_BLOCKED'] },
  { id: 'no-structured-data', pages: [page({ html: healthy.replace('<script type="application/ld+json">{}</script>', '') })], status: 'SUCCEEDED', codes: ['MISSING_STRUCTURED_DATA'] },
];

test('couvre les sept profils du pré-slice local sans accès réseau', () => {
  for (const fixture of fixtures) {
    const audit = analyzeSeoAudit({ target, pages: fixture.pages, observedAt });
    assert.equal(audit.status, fixture.status, fixture.id);
    assert.deepEqual(audit.findings.map(item => item.code), fixture.codes, fixture.id);
    assert.equal(audit.findings.every(item => item.evidence.sourceType === 'crawl'), true, fixture.id);
    assert.equal(audit.findings.every(item => item.evidence.observedAt === observedAt), true, fixture.id);
    assert.equal(renderSeoAuditReport(audit).includes('synthetic-fixture'), false, fixture.id);
  }
});

test('relie un crawl capturé à l’analyse sans exposer le HTML brut', async () => {
  const audit = await runSeoAudit({
    target,
    observedAt,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async url => ({ status: 200, url, headers: { get: () => 'text/html' }, text: async () => '<html lang="fr"><head><title>Fixture</title><meta name="description" content="Fixture"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://fixture.example.test/"></head><body><h1>Fixture</h1></body></html>' }),
    profile: { maxPages: 1, maxBytes: 10000, timeoutMs: 1000 },
  });

  assert.equal(audit.status, 'SUCCEEDED');
  assert.equal(audit.crawlSummary.pagesCompleted, 1);
  assert.equal(Object.hasOwn(audit, 'crawl'), false);
  assert.equal(audit.findings[0].evidence.observedAt, observedAt);
});
