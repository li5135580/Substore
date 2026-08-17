import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = resolve(root, 'worker');
const assetsDir = resolve(root, 'frontend-dist');

if (!existsSync(assetsDir)) {
  throw new Error(
    [
      '',
      'Frontend assets are missing.',
      `Expected directory: ${assetsDir}`,
      '',
      'Run:',
      '  node scripts/sync-official-frontend.mjs',
      '',
      'before starting Wrangler dev.',
      '',
    ].join('\n')
  );
}

const worker = spawn(
  'npx',
  [
    'wrangler',
    'dev',
    '--local',
    '--port',
    '8787',
  ],
  {
    cwd: workerDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
    },
  }
);

let shuttingDown = false;

function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    worker.kill('SIGTERM');
  } catch {
    // Worker may already have exited.
  }

  process.exit(code);
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

worker.on('exit', (code) => {
  if (!shuttingDown && code !== null && code !== 0) {
    process.exit(code);
  }
});

let ready = false;

for (let i = 0; i < 60; i++) {
  await new Promise((resolvePromise) =>
    setTimeout(resolvePromise, 1000)
  );

  try {
    const response = await fetch(
      'http://127.0.0.1:8787/api/health'
    );

    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // Wrangler is still starting.
  }
}

if (!ready) {
  stop(1);
  throw new Error(
    'Worker did not become ready within 60 seconds.'
  );
}

console.log('Worker is ready.');

try {
  await import('../tests/contract.mjs');
  console.log('Worker contract tests passed.');
} catch (error) {
  console.error('Worker contract tests failed.');
  stop(1);
  throw error;
}

stop(0);
