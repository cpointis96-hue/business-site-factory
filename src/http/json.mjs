import { ValidationError } from '../core/errors.mjs';

export async function readJsonBody(request, maxBytes = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > maxBytes) throw Object.assign(new ValidationError('Corps trop volumineux.'), { status: 413, code: 'PAYLOAD_TOO_LARGE' }); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ValidationError('JSON invalide.'); }
}

export function sendJson(response, status, value, headers = {}) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); response.end(JSON.stringify(value)); }

export function sendContent(response, status, value, contentType, headers = {}) {
  response.writeHead(status, { 'Content-Type': contentType, ...headers });
  response.end(value);
}
