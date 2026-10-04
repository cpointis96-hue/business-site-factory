import { createHash, randomBytes } from 'node:crypto';
import {
  access,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

import { ConflictError, PathViolationError } from './errors.mjs';

const SHA256_PREFIX = 'sha256:';

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function createAtomicStore(rootDir) {
  const root = path.resolve(rootDir);

  function resolveSafe(relativePath) {
    if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
      throw new PathViolationError();
    }

    const segments = relativePath.split('/');
    if (
      segments.length === 0 ||
      segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'))
    ) {
      throw new PathViolationError();
    }

    const candidate = path.resolve(root, ...segments);
    if (!isInside(root, candidate) || candidate === root) {
      throw new PathViolationError();
    }
    return candidate;
  }

  async function ensureSafeParent(filePath) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const parent = path.dirname(filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const [realRoot, realParent] = await Promise.all([realpath(root), realpath(parent)]);
    if (!isInside(realRoot, realParent)) throw new PathViolationError();
  }

  async function assertSafeExisting(filePath) {
    const realRoot = await realpath(root).catch(error => {
      if (error.code === 'ENOENT') return root;
      throw error;
    });
    const realFile = await realpath(filePath);
    if (!isInside(realRoot, realFile)) throw new PathViolationError();
  }

  function hashText(value) {
    return `${SHA256_PREFIX}${createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
  }

  async function readText(relativePath, fallback = null) {
    const filePath = resolveSafe(relativePath);
    try {
      await assertSafeExisting(filePath);
      return await readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw error;
    }
  }

  async function readBuffer(relativePath, fallback = null) {
    const filePath = resolveSafe(relativePath);
    try {
      await assertSafeExisting(filePath);
      return await readFile(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw error;
    }
  }

  async function checkWritePrecondition(relativePath, nextValue, options) {
    const current = await readText(relativePath, null);
    if (options.immutable && current !== null) {
      throw new ConflictError('Cette version immuable existe déjà.');
    }
    if (options.expectedHash === null && current !== null) {
      throw new ConflictError('La ressource existe déjà.', { currentHash: hashText(current) });
    }
    if (typeof options.expectedHash === 'string') {
      const currentHash = current === null ? null : hashText(current);
      if (currentHash !== options.expectedHash) {
        throw new ConflictError(undefined, { currentHash });
      }
    }
    return { current, hash: hashText(nextValue) };
  }

  async function writeText(relativePath, value, options = {}) {
    const text = String(value);
    const filePath = resolveSafe(relativePath);
    await ensureSafeParent(filePath);
    const precondition = await checkWritePrecondition(relativePath, text, options);
    const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    const handle = await open(tempPath, 'wx', 0o600);

    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(tempPath, filePath);
    const directoryHandle = await open(path.dirname(filePath), 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }

    return {
      hash: precondition.hash,
      previousHash: precondition.current === null ? null : hashText(precondition.current),
      path: relativePath,
    };
  }

  async function writeBuffer(relativePath, value, options = {}) {
    if (!Buffer.isBuffer(value)) throw new TypeError('value must be a Buffer');
    const filePath = resolveSafe(relativePath);
    await ensureSafeParent(filePath);
    const current = await readBuffer(relativePath, null);
    const hash = `${SHA256_PREFIX}${createHash('sha256').update(value).digest('hex')}`;
    const currentHash = current === null ? null : `${SHA256_PREFIX}${createHash('sha256').update(current).digest('hex')}`;
    if (options.immutable && current !== null) throw new ConflictError('Cette version immuable existe déjà.');
    if (options.expectedHash === null && current !== null) throw new ConflictError('La ressource existe déjà.', { currentHash });
    if (typeof options.expectedHash === 'string' && currentHash !== options.expectedHash) throw new ConflictError(undefined, { currentHash });
    const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(value);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
    const directoryHandle = await open(path.dirname(filePath), 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
    return { hash, previousHash: currentHash, path: relativePath };
  }

  async function readJson(relativePath, fallback = null) {
    const text = await readText(relativePath, null);
    return text === null ? fallback : JSON.parse(text);
  }

  async function writeJson(relativePath, value, options = {}) {
    return writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`, options);
  }

  async function appendJsonLine(relativePath, value) {
    const filePath = resolveSafe(relativePath);
    await ensureSafeParent(filePath);
    const handle = await open(filePath, 'a', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    const info = await stat(filePath);
    return { path: relativePath, size: info.size };
  }

  return {
    appendJsonLine,
    hashText,
    readBuffer,
    readJson,
    readText,
    resolveSafe,
    root,
    writeJson,
    writeBuffer,
    writeText,
  };
}
