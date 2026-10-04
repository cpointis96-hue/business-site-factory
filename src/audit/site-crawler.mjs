import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ValidationError } from '../core/errors.mjs';

const DEFAULT_MAX_PAGES = 50;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_TIMEOUT_MS = 3 * 60 * 1000;

function crawlerError(message, code) { return Object.assign(new Error(message), { code }); }

function privateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 88 || b === 168))
    || (a === 198 && b >= 18 && b <= 51) || (a === 203 && b === 0) || a >= 224;
}

function privateAddress(address) {
  const normalized = String(address).toLowerCase().split('%')[0];
  if (isIP(normalized) === 4) return privateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('2001:db8')) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return Boolean(mapped && privateIpv4(mapped[1]));
}

function parseTarget(value, field = 'target') {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} est requis.`, { field });
  let url;
  try { url = new URL(value); } catch { throw crawlerError(`${field} est invalide.`, 'INVALID_TARGET'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw crawlerError(`${field} est invalide.`, 'INVALID_TARGET');
  return url;
}

async function assertPublic(url, lookup) {
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw crawlerError('Cible réseau privée.', 'TARGET_NOT_PUBLIC');
  if (isIP(hostname)) {
    if (privateAddress(hostname)) throw crawlerError('Cible réseau privée.', 'TARGET_NOT_PUBLIC');
    return;
  }
  let records;
  try { records = await lookup(hostname); } catch { throw crawlerError('Résolution DNS impossible.', 'TARGET_NOT_PUBLIC'); }
  const addresses = (Array.isArray(records) ? records : [records]).map(record => typeof record === 'string' ? record : record?.address).filter(Boolean);
  if (!addresses.length || addresses.some(privateAddress)) throw crawlerError('La cible ne se résout pas vers une adresse publique.', 'TARGET_NOT_PUBLIC');
}

export async function validatePublicTarget(value, { lookup = hostname => dnsLookup(hostname, { all: true, verbatim: true }) } = {}) {
  const url = parseTarget(value);
  await assertPublic(url, lookup);
  return url;
}

function header(response, name) {
  if (response.headers?.get) return response.headers.get(name);
  const value = response.headers?.[name] ?? response.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value ?? null;
}

function links(html, base, origin) {
  const result = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1], base);
      url.hash = '';
      if (['http:', 'https:'].includes(url.protocol) && url.origin === origin) result.push(url.href);
    } catch { /* malformed links are findings for a later rule, not crawl targets */ }
  }
  return result;
}

export async function crawlSite({ target, fetchImpl = globalThis.fetch, lookup = hostname => dnsLookup(hostname, { all: true, verbatim: true }), maxPages = DEFAULT_MAX_PAGES, maxBytes = DEFAULT_MAX_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new ValidationError('fetchImpl est requis.');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > DEFAULT_MAX_PAGES) throw new ValidationError('maxPages est invalide.', { field: 'maxPages' });
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw new ValidationError('maxBytes est invalide.', { field: 'maxBytes' });
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) throw new ValidationError('timeoutMs est invalide.', { field: 'timeoutMs' });
  const root = await validatePublicTarget(target, { lookup });
  const queue = [root.href]; const visited = new Set(); const pages = [];
  while (queue.length && pages.length < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      const finalUrl = parseTarget(response.url || url, 'response.url');
      await assertPublic(finalUrl, lookup);
      if (finalUrl.origin !== root.origin) throw crawlerError('Redirection hors origin.', 'REDIRECT_OUT_OF_ORIGIN');
      const status = Number(response.status ?? 200);
      if (status >= 400) throw crawlerError(`Réponse HTTP ${status}.`, `HTTP_${status}`);
      const contentType = header(response, 'content-type');
      if (contentType && !contentType.toLowerCase().includes('text/html')) throw crawlerError('Ressource non HTML.', 'NOT_HTML');
      const contentLength = Number(header(response, 'content-length'));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) throw crawlerError('Payload trop volumineux.', 'PAYLOAD_TOO_LARGE');
      const html = await response.text();
      if (Buffer.byteLength(html, 'utf8') > maxBytes) throw crawlerError('Payload trop volumineux.', 'PAYLOAD_TOO_LARGE');
      pages.push({ url: finalUrl.href, status, crawlStatus: 'complete', html });
      for (const link of links(html, finalUrl.href, root.origin)) if (!visited.has(link) && !queue.includes(link)) queue.push(link);
    } catch (error) {
      pages.push({ url, status: null, crawlStatus: 'blocked', html: '', errorCode: error.code ?? 'FETCH_FAILED' });
    }
  }
  return {
    target: root.href,
    pages,
    summary: { pagesCaptured: pages.length, pagesCompleted: pages.filter(page => page.crawlStatus === 'complete').length, pagesBlocked: pages.filter(page => page.crawlStatus === 'blocked').length, pagesSkipped: queue.length, limitReached: queue.length > 0 },
  };
}
