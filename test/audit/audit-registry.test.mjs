import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createSeoAuditRegistry } from '../../src/audit/audit-registry.mjs';

const result = { schemaVersion: 1, ruleVersion: 'seo-rules-v1', target: 'https://example.com/', observedAt: '2026-08-27T00:00:00.000Z', status: 'SUCCEEDED', summary: { pagesAnalyzed: 1, pagesSkipped: 0 }, pages: [{ url: 'https://example.com/', status: 200, crawlStatus: 'complete', findingsCount: 0 }], findings: [] };

test('persiste séparément le JSON d’audit et le rapport, sans écrasement', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-audit-registry-'));
  const registry = createSeoAuditRegistry({ store: createAtomicStore(root), runner: async () => result, renderer: audit => `<html><body>${audit.id}</body></html>`, idFactory: () => 'audit-fixed', clock: () => new Date('2026-08-27T00:00:00.000Z') });
  const created = await registry.create({ target: result.target, observedAt: result.observedAt });
  assert.equal(created.id, 'audit-fixed');
  assert.equal((await registry.get(created.id)).pages[0].html, undefined);
  assert.match((await registry.readReport(created.id)).value, /audit-fixed/);
  await assert.rejects(() => registry.create({ target: result.target, observedAt: result.observedAt }), error => error.code === 'CONFLICT');
});

test('rend la création rejouable avec une clé d’idempotence et bloque les divergences', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-audit-idempotency-'));
  let runs = 0;
  const registry = createSeoAuditRegistry({ store: createAtomicStore(root), runner: async () => { runs += 1; return result; }, renderer: audit => `<html><body>${audit.id}</body></html>`, idFactory: prefix => `${prefix}-fixed`, clock: () => new Date('2026-08-27T00:00:00.000Z') });
  const first = await registry.create({ target: result.target, observedAt: result.observedAt, idempotencyKey: 'request-1' });
  const replay = await registry.create({ target: result.target, observedAt: result.observedAt, idempotencyKey: 'request-1' });
  assert.equal(replay.id, first.id);
  assert.equal(runs, 1);
  await assert.rejects(() => registry.create({ target: 'https://other.example/', observedAt: result.observedAt, idempotencyKey: 'request-1' }), error => error.code === 'CONFLICT');
});
