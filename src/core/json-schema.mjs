import { ValidationError } from './errors.mjs';

function matchesType(value, type) {
  return type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value)
      : type === 'string' ? typeof value === 'string'
        : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
          : type === 'integer' ? Number.isInteger(value)
            : type === 'boolean' ? typeof value === 'boolean'
              : type === 'null' ? value === null : true;
}

function findError(schema, value, path = '$') {
  if (schema?.type && !matchesType(value, schema.type)) return `${path} doit être de type ${schema.type}`;
  if (schema?.enum && !schema.enum.some(item => Object.is(item, value))) return `${path} a une valeur interdite`;
  if (schema?.type === 'object') {
    for (const key of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(value, key)) return `${path}.${key} est requis`;
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!schema.properties?.[key]) return `${path}.${key} est interdit`;
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.prototype.hasOwnProperty.call(value, key)) {
      const error = findError(child, value[key], `${path}.${key}`); if (error) return error;
    }
  }
  if (schema?.type === 'array') {
    for (const [index, item] of value.entries()) { const error = findError(schema.items, item, `${path}[${index}]`); if (error) return error; }
  }
  return null;
}

export function validateJsonSchema(schema, value) {
  const error = findError(schema, value);
  if (error) throw new ValidationError(`Sortie incompatible avec le JSON Schema : ${error}`);
  return value;
}
