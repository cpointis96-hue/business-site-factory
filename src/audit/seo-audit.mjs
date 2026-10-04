import { ValidationError } from '../core/errors.mjs';
import { createEvidenceSnapshot } from './evidence.mjs';

export const SEO_RULE_VERSION = 'seo-rules-v1';
const DEFAULT_MAX_PAGES = 50;

function requiredUrl(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} est requis.`, { field });
  let parsed;
  try { parsed = new URL(value); } catch { throw new ValidationError(`${field} est invalide.`, { field }); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new ValidationError(`${field} est invalide.`, { field });
  return value;
}

function textFromTag(html, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(html);
  return match?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)) result[match[1].toLowerCase()] = match[2].trim();
  return result;
}

function hasMeta(html, name) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].some(match => attributes(match[0]).name?.toLowerCase() === name);
}

function hasLink(html, rel) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].some(match => attributes(match[0]).rel?.toLowerCase().split(/\s+/).includes(rel));
}

function finding(code, severity, url, observedAt, detail, rawPayload = '') {
  return {
    code,
    severity,
    classification: 'CALCULATED',
    detail,
    evidence: createEvidenceSnapshot({ canonicalUrl: url, observedAt, rawPayload, ruleVersion: SEO_RULE_VERSION }),
  };
}

function analyzePage(page, observedAt) {
  const url = requiredUrl(page.url, 'page.url');
  if (page.crawlStatus === 'blocked') {
    return {
      page: { url, status: page.status ?? null, crawlStatus: 'blocked', findingsCount: 1 },
      findings: [finding('CRAWL_BLOCKED', 'WARN', url, observedAt, 'La page n’a pas pu être analysée.', '')],
    };
  }
  if (typeof page.html !== 'string') throw new ValidationError('page.html est invalide.', { field: 'page.html' });
  const html = page.html;
  const title = textFromTag(html, 'title');
  const h1Count = [...html.matchAll(/<h1\b[^>]*>/gi)].length;
  const missingImageAlt = [...html.matchAll(/<img\b[^>]*>/gi)].filter(match => {
    const alt = attributes(match[0]).alt;
    return alt === undefined || !alt;
  }).length;
  const findings = [];
  if (!title) findings.push(finding('MISSING_TITLE', 'WARN', url, observedAt, 'La page ne contient pas de title exploitable.', html));
  if (!hasMeta(html, 'description')) findings.push(finding('MISSING_META_DESCRIPTION', 'WARN', url, observedAt, 'La page ne contient pas de meta description.', html));
  if (!hasMeta(html, 'viewport')) findings.push(finding('MISSING_VIEWPORT', 'WARN', url, observedAt, 'La page ne contient pas de viewport.', html));
  if (!hasLink(html, 'canonical')) findings.push(finding('MISSING_CANONICAL', 'WARN', url, observedAt, 'La page ne contient pas de canonical.', html));
  if (!/<html\b[^>]*\blang\s*=/i.test(html)) findings.push(finding('MISSING_HTML_LANG', 'WARN', url, observedAt, 'La langue du document n’est pas déclarée.', html));
  if (!/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["']/i.test(html)) findings.push(finding('MISSING_STRUCTURED_DATA', 'WARN', url, observedAt, 'Aucune donnée structurée JSON-LD observée.', html));
  if (h1Count > 1) findings.push(finding('MULTIPLE_H1', 'WARN', url, observedAt, `${h1Count} balises h1 observées.`, html));
  if (missingImageAlt > 0) findings.push(finding('MISSING_IMAGE_ALT', 'WARN', url, observedAt, `${missingImageAlt} image(s) sans attribut alt exploitable.`, html));
  return { page: { url, status: page.status ?? 200, crawlStatus: 'complete', findingsCount: findings.length }, findings };
}

export function analyzeSeoAudit({ target, pages, observedAt, maxPages = DEFAULT_MAX_PAGES, limitReached = false } = {}) {
  const normalizedTarget = requiredUrl(target, 'target');
  if (!Array.isArray(pages)) throw new ValidationError('pages est invalide.', { field: 'pages' });
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > DEFAULT_MAX_PAGES) throw new ValidationError('maxPages est invalide.', { field: 'maxPages' });
  if (typeof observedAt !== 'string' || !observedAt.trim() || Number.isNaN(Date.parse(observedAt))) throw new ValidationError('observedAt est invalide.', { field: 'observedAt' });
  const analyzed = pages.slice(0, maxPages).map(page => analyzePage(page, observedAt));
  const findings = analyzed.flatMap(item => item.findings);
  const skipped = Math.max(0, pages.length - analyzed.length);
  if (skipped || limitReached) findings.push(finding('PAGE_LIMIT_REACHED', 'WARN', normalizedTarget, observedAt, `${Math.max(skipped, 1)} page(s) ignorée(s) après la limite du profil.`));
  if (!pages.length) findings.push(finding('NO_PAGES_CAPTURED', 'WARN', normalizedTarget, observedAt, 'Aucune page n’a été capturée.'));
  const counts = findings.reduce((result, item) => ({ ...result, [item.code]: (result[item.code] ?? 0) + 1 }), {});
  return {
    schemaVersion: 1,
    ruleVersion: SEO_RULE_VERSION,
    target: normalizedTarget,
    observedAt,
    status: findings.some(item => ['CRAWL_BLOCKED', 'PAGE_LIMIT_REACHED', 'NO_PAGES_CAPTURED'].includes(item.code)) ? 'PARTIAL' : 'SUCCEEDED',
    summary: { pagesReceived: pages.length, pagesAnalyzed: analyzed.length, pagesSkipped: skipped, counts },
    pages: analyzed.map(item => item.page),
    findings,
  };
}
