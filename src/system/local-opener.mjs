import { spawn } from 'node:child_process';

export function createLocalOpener() {
  if (process.platform !== 'darwin') return null;
  return (target, { reveal = false } = {}) => new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', reveal ? ['-R', target] : [target], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
