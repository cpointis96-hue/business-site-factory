import { assertResourceId, createId } from '../core/ids.mjs';
import { ValidationError } from '../core/errors.mjs';

const EVENTS_PATH = runId => `runs/${runId}/cost-events.jsonl`;
const THRESHOLDS = [0.5, 0.8, 1];

function costError(message, code, details = null) {
  return Object.assign(new Error(message), { code, details, status: 409 });
}

function amount(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ValidationError(`${field} est invalide.`, { field });
  return value;
}

function requiredText(value, field, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ValidationError(`${field} est invalide.`, { field });
  return value.trim();
}

export function createCostLedger({ store, runId, envelope = {}, clock = () => new Date(), idFactory = prefix => createId(prefix, clock()) } = {}) {
  assertResourceId(runId, 'runId');
  const hardLimit = amount(envelope.hardLimit, 'envelope.hardLimit');
  const currency = requiredText(envelope.currency ?? 'USD', 'envelope.currency', 8).toUpperCase();
  const allowUnknown = envelope.allowUnknown === true;
  let spent = 0;
  let reserved = 0;
  const reservations = new Map();
  const firedThresholds = new Set();

  async function append(event) {
    return store.appendJsonLine(EVENTS_PATH(runId), { eventId: idFactory('cost-event'), occurredAt: clock().toISOString(), runId, currency, ...event });
  }

  function state() {
    const normalizedReserved = Math.max(0, reserved);
    return { hardLimit, currency, spent, reserved: normalizedReserved, available: Math.max(0, hardLimit - spent - normalizedReserved), utilization: hardLimit === 0 ? (spent > 0 ? 1 : 0) : spent / hardLimit };
  }

  async function authorize({ stepId, provider, unit, quantity = 1, estimatedCost, essential = false } = {}) {
    const fields = { stepId: requiredText(stepId, 'stepId'), provider: requiredText(provider, 'provider'), unit: requiredText(unit, 'unit') };
    amount(quantity, 'quantity');
    if (estimatedCost === null || estimatedCost === undefined) {
      if (!allowUnknown) throw costError('Coût estimé obligatoire avant consommation.', 'COST_UNKNOWN');
    } else amount(estimatedCost, 'estimatedCost');
    const estimate = estimatedCost ?? 0;
    if (spent + reserved + estimate > hardLimit) throw costError('Plafond budgétaire dépassé avant appel.', 'BUDGET_EXCEEDED', { ...state(), estimate });
    const authorizationId = idFactory('cost-auth');
    reservations.set(authorizationId, { authorizationId, ...fields, quantity, estimate, essential });
    reserved += estimate;
    await append({ type: 'COST_AUTHORIZED', phase: 'before', authorizationId, ...fields, quantity, estimatedCost: estimatedCost ?? null, essential, state: state() });
    return { authorizationId, state: state() };
  }

  async function settle({ authorizationId, actualCost } = {}) {
    const reservation = reservations.get(authorizationId);
    if (!reservation) throw new ValidationError('Autorisation de coût introuvable.', { field: 'authorizationId' });
    amount(actualCost, 'actualCost');
    reserved -= reservation.estimate;
    spent += actualCost;
    reservations.delete(authorizationId);
    const overLimit = spent > hardLimit;
    await append({ type: 'COST_SETTLED', phase: 'after', authorizationId, stepId: reservation.stepId, provider: reservation.provider, unit: reservation.unit, quantity: reservation.quantity, estimatedCost: reservation.estimate, actualCost, essential: reservation.essential, overLimit, state: state() });
    await emitThresholds();
    return { overLimit, state: state() };
  }

  async function cancel({ authorizationId, reason = 'CALL_FAILED' } = {}) {
    const reservation = reservations.get(authorizationId);
    if (!reservation) throw new ValidationError('Autorisation de coût introuvable.', { field: 'authorizationId' });
    reserved -= reservation.estimate;
    reservations.delete(authorizationId);
    await append({ type: 'COST_RELEASED', phase: 'after', authorizationId, stepId: reservation.stepId, provider: reservation.provider, unit: reservation.unit, quantity: reservation.quantity, estimatedCost: reservation.estimate, reason: requiredText(reason, 'reason'), state: state() });
    return { state: state() };
  }

  async function emitThresholds() {
    for (const threshold of THRESHOLDS) {
      if (firedThresholds.has(threshold) || (hardLimit === 0 ? spent === 0 : spent / hardLimit < threshold)) continue;
      firedThresholds.add(threshold);
      await append({ type: 'BUDGET_THRESHOLD', phase: 'after', threshold, state: state() });
    }
  }

  return { authorize, cancel, settle, snapshot: state };
}
