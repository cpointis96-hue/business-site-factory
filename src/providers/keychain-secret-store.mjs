import { execFile } from 'node:child_process';

const SERVICE = 'com.ancrage.provider';

function runSecurity(args) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/security', args, { encoding: 'utf8' }, (error, stdout = '', stderr = '') => {
      if (!error) return resolve(stdout);
      reject(Object.assign(new Error('Keychain operation failed'), { code: error.code, stderrCode: stderr.includes('could not be found') ? 'NOT_FOUND' : 'KEYCHAIN_ERROR' }));
    });
  });
}

export function createKeychainSecretStore() {
  const account = ref => String(ref).replace(/[^a-zA-Z0-9._-]/g, '-');
  return {
    async has(ref) { try { await runSecurity(['find-generic-password', '-s', SERVICE, '-a', account(ref)]); return true; } catch { return false; } },
    async get(ref) { try { return (await runSecurity(['find-generic-password', '-s', SERVICE, '-a', account(ref), '-w'])).trim(); } catch (error) { if (error.stderrCode === 'NOT_FOUND') return null; throw error; } },
    async set(ref, value) { await runSecurity(['add-generic-password', '-U', '-s', SERVICE, '-a', account(ref), '-w', String(value)]); },
    async delete(ref) { try { await runSecurity(['delete-generic-password', '-s', SERVICE, '-a', account(ref)]); } catch (error) { if (error.stderrCode !== 'NOT_FOUND') throw error; } },
  };
}
