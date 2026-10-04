import { analyzeSeoAudit } from './seo-audit.mjs';
import { crawlSite } from './site-crawler.mjs';

export async function runSeoAudit({ target, observedAt, fetchImpl, lookup, profile = {} } = {}) {
  const crawl = await crawlSite({ target, fetchImpl, lookup, maxPages: profile.maxPages, maxBytes: profile.maxBytes, timeoutMs: profile.timeoutMs });
  const audit = analyzeSeoAudit({ target: crawl.target, pages: crawl.pages, observedAt, maxPages: profile.maxPages, limitReached: crawl.summary.limitReached });
  return { ...audit, crawlSummary: crawl.summary };
}
