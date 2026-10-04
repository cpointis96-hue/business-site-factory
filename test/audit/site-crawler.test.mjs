import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlSite } from '../../src/audit/site-crawler.mjs';

function response(body, { url, status = 200, contentType = 'text/html; charset=utf-8' } = {}) {
  return {
    ok: status >= 200 && status < 400,
    status,
    url,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
    text: async () => body,
  };
}

const lookupPublic = async hostname => [{ address: hostname === 'fixture.example.test' ? '93.184.216.34' : '93.184.216.35', family: 4 }];

test('crawl HTML uniquement sur le même origin et respecte la borne de pages', async () => {
  const calls = [];
  const pages = {
    'https://fixture.example.test/': '<html><body><a href="/menu">Menu</a><a href="https://other.example/">Externe</a></body></html>',
    'https://fixture.example.test/menu': '<html><body><h1>Menu</h1></body></html>',
  };
  const result = await crawlSite({
    target: 'https://fixture.example.test/',
    lookup: lookupPublic,
    maxPages: 2,
    fetchImpl: async url => { calls.push(url); return response(pages[url], { url }); },
  });

  assert.deepEqual(calls, ['https://fixture.example.test/', 'https://fixture.example.test/menu']);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages.every(page => page.crawlStatus === 'complete'), true);
  assert.equal(result.summary.pagesSkipped, 0);
});

test('refuse les cibles privées et les credentials URL', async () => {
  await assert.rejects(
    () => crawlSite({ target: 'http://127.0.0.1/', lookup: lookupPublic, fetchImpl: async () => response('', { url: 'http://127.0.0.1/' }) }),
    error => error.code === 'TARGET_NOT_PUBLIC',
  );
  await assert.rejects(
    () => crawlSite({ target: 'https://user:password@fixture.example.test/', lookup: lookupPublic, fetchImpl: async () => response('') }),
    error => error.code === 'INVALID_TARGET',
  );
});

test('bloque une redirection privée et un payload trop volumineux sans conserver le HTML', async () => {
  const redirected = await crawlSite({
    target: 'https://fixture.example.test/',
    lookup: lookupPublic,
    fetchImpl: async url => response('<html>private</html>', { url: 'http://127.0.0.1/private' }),
  });
  assert.equal(redirected.pages[0].crawlStatus, 'blocked');
  assert.equal(redirected.pages[0].html, '');
  assert.equal(redirected.pages[0].errorCode, 'TARGET_NOT_PUBLIC');

  const oversized = await crawlSite({
    target: 'https://fixture.example.test/',
    lookup: lookupPublic,
    maxBytes: 10,
    fetchImpl: async url => response('<html>too long</html>', { url }),
  });
  assert.equal(oversized.pages[0].crawlStatus, 'blocked');
  assert.equal(oversized.pages[0].html, '');
  assert.equal(oversized.pages[0].errorCode, 'PAYLOAD_TOO_LARGE');
});

test('borne le profil octets et durée même si la requête demande davantage', async () => {
  await assert.rejects(() => crawlSite({ target: 'https://example.com', lookup: async () => ['93.184.216.34'], fetchImpl: async () => ({ url: 'https://example.com/', status: 200, headers: { get: () => 'text/html' }, text: async () => '<html></html>' }), maxBytes: 26 * 1024 * 1024 }), /maxBytes est invalide/);
  await assert.rejects(() => crawlSite({ target: 'https://example.com', lookup: async () => ['93.184.216.34'], fetchImpl: async () => ({ url: 'https://example.com/', status: 200, headers: { get: () => 'text/html' }, text: async () => '<html></html>' }), timeoutMs: 180001 }), /timeoutMs est invalide/);
});
