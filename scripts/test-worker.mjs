import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const worker = spawn('npx', ['wrangler', 'dev', '--local', '--port', '8787'], {
  cwd: resolve(fileURLToPath(new URL('..', import.meta.url)), 'worker'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const stop = (code = 0) => { try { worker.kill('SIGTERM'); } finally { process.exit(code); } };
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

let ready = false;
for (let i = 0; i < 45; i++) {
  await new Promise(r => setTimeout(r, 1000));
  try {
    const res = await fetch('http://127.0.0.1:8787/api/health');
    if (res.ok) { ready = true; break; }
  } catch {}
}
if (!ready) throw new Error('Worker did not become ready within 45 seconds');
const result = await import('../tests/contract.mjs');
void result;
stop(0);
