import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSeoAudit } from '../../src/audit/seo-audit.mjs';
import { renderSeoAuditReport } from '../../src/audit/audit-report.mjs';

const observedAt = '2026-08-27T10:00:00.000Z';
const target = 'https://restaurant.example.test/';

const healthyPage = `<!doctype html><html lang="fr"><head>
  <title>Restaurant Exemple</title>
  <meta name="description" content="Cuisine locale et horaires du restaurant Exemple.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://restaurant.example.test/">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Restaurant"}</script>
</head><body><h1>Restaurant Exemple</h1><img src="dish.jpg" alt="Plat signature"></body></html>`;

test('analyse une page saine avec une preuve datée', () => {
  const audit = analyzeSeoAudit({ target, pages: [{ url: target, status: 200, html: healthyPage }], observedAt });

  assert.equal(audit.status, 'SUCCEEDED');
  assert.equal(audit.ruleVersion, 'seo-rules-v1');
  assert.equal(audit.pages[0].findingsCount, 0);
  assert.equal(audit.findings.length, 0);
  assert.equal(audit.observedAt, observedAt);
  assert.equal(audit.pages[0].url, target);
});

test('détecte les signaux SEO déterministes sans inventer de conclusion', () => {
  const audit = analyzeSeoAudit({
    target,
    observedAt,
    pages: [{
      url: target,
      status: 200,
      html: '<html><head><h1>Un</h1><h1>Deux</h1></head><body><img src="dish.jpg"></body></html>',
    }],
  });

  assert.equal(audit.status, 'SUCCEEDED');
  assert.deepEqual(audit.findings.map(finding => finding.code), [
    'MISSING_TITLE',
    'MISSING_META_DESCRIPTION',
    'MISSING_VIEWPORT',
    'MISSING_CANONICAL',
    'MISSING_HTML_LANG',
    'MISSING_STRUCTURED_DATA',
    'MULTIPLE_H1',
    'MISSING_IMAGE_ALT',
  ]);
  assert.equal(audit.findings.every(finding => finding.classification === 'CALCULATED'), true);
  assert.equal(audit.findings.every(finding => finding.evidence.url === target), true);
  assert.equal(audit.findings.every(finding => finding.evidence.canonicalUrl === target), true);
  assert.equal(audit.findings.every(finding => /^sha256:[a-f0-9]{64}$/.test(finding.evidence.rawPayloadHash)), true);
  assert.equal(audit.findings.every(finding => /^evidence-[a-f0-9]{24}$/.test(finding.evidence.id)), true);
  assert.equal(audit.findings.every(finding => Object.hasOwn(finding.evidence, 'requestParameters') && Object.hasOwn(finding.evidence, 'retentionClass')), true);
  assert.equal(JSON.stringify(audit).includes('classement'), false);
});

test('marque un crawl bloqué comme PARTIAL et respecte la borne de pages', () => {
  const audit = analyzeSeoAudit({
    target,
    observedAt,
    maxPages: 1,
    pages: [
      { url: target, status: 403, crawlStatus: 'blocked', html: '' },
      { url: `${target}menu`, status: 200, html: healthyPage },
    ],
  });

  assert.equal(audit.status, 'PARTIAL');
  assert.equal(audit.summary.pagesAnalyzed, 1);
  assert.equal(audit.summary.pagesSkipped, 1);
  assert.deepEqual(audit.findings.map(finding => finding.code), ['CRAWL_BLOCKED', 'PAGE_LIMIT_REACHED']);
});

test('rend un rapport échappé avec ses preuves sans script', () => {
  const unsafeTarget = 'https://restaurant.example.test/<script>alert(1)</script>';
  const audit = analyzeSeoAudit({
    target: unsafeTarget,
    observedAt,
    pages: [{ url: target, status: 200, html: '<html><body><h1><script>alert(1)</script></h1></body></html>' }],
  });
  const report = renderSeoAuditReport(audit);

  assert.match(report, /Rapport d’audit SEO/);
  assert.match(report, /MISSING_TITLE/);
  assert.match(report, /2026-08-27T10:00:00\.000Z/);
  assert.match(report, /seo-rules-v1/);
  assert.match(report, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(report, /<script/);
  assert.doesNotMatch(report, /promesse de classement/);
});
