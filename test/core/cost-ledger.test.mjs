import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAtomicStore } from '../../src/core/atomic-store.mjs';
import { createCostLedger } from '../../src/runs/cost-ledger.mjs';

test('autorise, règle et trace les coûts avec seuils 50/80/100', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-cost-'));
  const store = createAtomicStore(root);
  const ledger = createCostLedger({ store, runId: 'run-cost', envelope: { hardLimit: 10, currency: 'usd' }, idFactory: prefix => `${prefix}-test` });
  const authorization = await ledger.authorize({ stepId: 'serp', provider: 'dataforseo', unit: 'task', estimatedCost: 10 });
  assert.equal(ledger.snapshot().reserved, 10);
  const settled = await ledger.settle({ authorizationId: authorization.authorizationId, actualCost: 10 });
  assert.equal(settled.state.spent, 10);
  assert.equal(settled.state.available, 0);
  const events = (await readFile(path.join(root, 'runs/run-cost/cost-events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(event => event.type), ['COST_AUTHORIZED', 'COST_SETTLED', 'BUDGET_THRESHOLD', 'BUDGET_THRESHOLD', 'BUDGET_THRESHOLD']);
  assert.equal(JSON.stringify(events).includes('secret'), false);
});

test('bloque le coût inconnu et le dépassement avant appel', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-cost-'));
  const ledger = createCostLedger({ store: createAtomicStore(root), runId: 'run-budget', envelope: { hardLimit: 5 } });
  await assert.rejects(() => ledger.authorize({ stepId: 'maps', provider: 'dataforseo', unit: 'task' }), error => error.code === 'COST_UNKNOWN');
  await assert.rejects(() => ledger.authorize({ stepId: 'maps', provider: 'dataforseo', unit: 'task', estimatedCost: 6 }), error => error.code === 'BUDGET_EXCEEDED');
  assert.deepEqual(ledger.snapshot(), { hardLimit: 5, currency: 'USD', spent: 0, reserved: 0, available: 5, utilization: 0 });
});

test('libère une réservation lorsque l’appel échoue', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ancrage-cost-'));
  const ledger = createCostLedger({ store: createAtomicStore(root), runId: 'run-release', envelope: { hardLimit: 5 } });
  const authorization = await ledger.authorize({ stepId: 'onpage', provider: 'dataforseo', unit: 'task', estimatedCost: 3 });
  const released = await ledger.cancel({ authorizationId: authorization.authorizationId });
  assert.equal(released.state.reserved, 0);
  assert.equal(released.state.spent, 0);
});
