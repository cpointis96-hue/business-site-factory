import { randomBytes } from 'node:crypto';

import { ValidationError } from './errors.mjs';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function assertResourceId(value, label = 'identifiant') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new ValidationError(`${label} invalide.`, { field: label });
  }
  return value;
}

export function createId(prefix, now = new Date(), entropy = randomBytes(4).toString('hex')) {
  assertResourceId(prefix, 'préfixe');
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${prefix}-${stamp}-${entropy}`;
}
