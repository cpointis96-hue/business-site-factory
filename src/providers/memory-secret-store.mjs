export function createMemorySecretStore(initial = {}) {
  const secrets = new Map(Object.entries(initial));
  return {
    async has(ref) { return secrets.has(ref); },
    async set(ref, value) { secrets.set(ref, String(value)); },
    async get(ref) { return secrets.get(ref) ?? null; },
    async delete(ref) { secrets.delete(ref); },
  };
}
