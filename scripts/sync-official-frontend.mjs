import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checkout = resolve(root, 'frontend');
const output = resolve(root, 'frontend-dist');
const repo = process.env.FRONTEND_REPO || 'https://github.com/sub-store-org/Sub-Store-Front-End.git';
const ref = process.env.FRONTEND_REF || 'main';
const pnpmVersion = process.env.PNPM_VERSION || '11.0.9';

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env } });
}

rmSync(checkout, { recursive: true, force: true });
rmSync(output, { recursive: true, force: true });
run('git', ['clone', '--depth', '1', '--branch', ref, repo, checkout]);
run('corepack', ['enable']);
run('corepack', ['prepare', `pnpm@${pnpmVersion}`, '--activate']);
run('pnpm', ['install', '--frozen-lockfile'], checkout);
run('pnpm', ['build'], checkout);

const dist = resolve(checkout, 'dist');
if (!existsSync(dist)) throw new Error('Official frontend build did not produce dist/');
mkdirSync(output, { recursive: true });
cpSync(dist, output, { recursive: true });

let sha = '';
try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim(); } catch {}
writeFileSync(resolve(output, '.upstream-frontend-sha'), `${sha}\n`);
console.log(`Official frontend ${sha || ref} synced to ${output}`);
