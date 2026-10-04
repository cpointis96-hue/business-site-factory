import { assertResourceId } from '../core/ids.mjs';
import { ValidationError } from '../core/errors.mjs';

const REQUIRED_FIELDS = ['id', 'name', 'ownerStep', 'outputContract'];
const ALLOWED_FIELDS = new Set(REQUIRED_FIELDS);

export function parsePromptMarkdown(markdown) {
  if (typeof markdown !== 'string' || markdown.length > 200_000) {
    throw new ValidationError('Le prompt doit être un texte de moins de 200 Ko.');
  }
  if (!markdown.startsWith('---\n')) {
    throw new ValidationError('Le prompt doit commencer par un frontmatter.');
  }

  const closingIndex = markdown.indexOf('\n---\n', 4);
  if (closingIndex < 0) {
    throw new ValidationError('Le frontmatter du prompt n’est pas fermé.');
  }

  const metadata = {};
  const lines = markdown.slice(4, closingIndex).split('\n');
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new ValidationError(`Ligne de frontmatter invalide : ${line}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!ALLOWED_FIELDS.has(key)) {
      throw new ValidationError(`Champ de frontmatter inconnu : ${key}`);
    }
    if (!value || Object.hasOwn(metadata, key)) {
      throw new ValidationError(`Valeur de frontmatter invalide : ${key}`);
    }
    metadata[key] = value;
  }

  for (const field of REQUIRED_FIELDS) {
    if (!metadata[field]) throw new ValidationError(`Champ de frontmatter manquant : ${field}`);
  }

  assertResourceId(metadata.id, 'id');
  assertResourceId(metadata.outputContract, 'outputContract');
  if (!/^(?:S(?:[0-9]|10)|[a-z0-9][a-z0-9-]{0,63})$/.test(metadata.ownerStep)) {
    throw new ValidationError('ownerStep invalide.');
  }
  if (metadata.name.length > 80) throw new ValidationError('Le nom du prompt est trop long.');

  const body = markdown.slice(closingIndex + 5).trim();
  if (!body) throw new ValidationError('Le corps du prompt est vide.');

  return { body, metadata };
}
