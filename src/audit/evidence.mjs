import { createHash } from 'node:crypto';
import { ValidationError } from '../core/errors.mjs';

const DEFAULT_RETENTION_CLASS = 'audit-local';

function requiredText(value, field, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ValidationError(`${field} est invalide.`, { field });
  return value.trim();
}

function hash(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function createEvidenceSnapshot({
  sourceType = 'crawl',
  provider = null,
  canonicalUrl,
  observedAt,
  requestParameters = {},
  rawPayload = '',
  ruleVersion,
  licenseOrTermsRef = null,
  retentionClass = DEFAULT_RETENTION_CLASS,
  expiresAt = null,
} = {}) {
  const url = requiredText(canonicalUrl, 'canonicalUrl', 2048);
  requiredText(observedAt, 'observedAt');
  const rules = requiredText(ruleVersion, 'ruleVersion');
  if (!requestParameters || typeof requestParameters !== 'object' || Array.isArray(requestParameters)) throw new ValidationError('requestParameters est invalide.', { field: 'requestParameters' });
  if (typeof rawPayload !== 'string' && !Buffer.isBuffer(rawPayload)) throw new ValidationError('rawPayload est invalide.', { field: 'rawPayload' });
  const payload = Buffer.isBuffer(rawPayload) ? rawPayload.toString('utf8') : rawPayload;
  const rawPayloadHash = hash(payload);
  const identity = JSON.stringify({ sourceType, provider, url, observedAt, requestParameters, rawPayloadHash, rules, licenseOrTermsRef, retentionClass, expiresAt });
  return {
    id: `evidence-${hash(identity).slice(7, 31)}`,
    sourceType,
    provider,
    canonicalUrl: url,
    url,
    observedAt,
    requestParameters,
    rawPayloadHash,
    ruleVersion: rules,
    licenseOrTermsRef,
    retentionClass,
    expiresAt,
  };
}
