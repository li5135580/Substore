import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const checkout = resolve(root, 'frontend');
const output = resolve(root, 'frontend-dist');
const repo = 'https://github.com/sub-store-org/Sub-Store-Front-End.git';

rmSync(checkout, { recursive: true, force: true });
rmSync(output, { recursive: true, force: true });

execFileSync('git', ['clone', '--depth', '1', repo, checkout], { stdio: 'inherit' });
execFileSync('corepack', ['enable'], { stdio: 'inherit' });
execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: checkout, stdio: 'inherit' });
execFileSync('pnpm', ['build'], { cwd: checkout, stdio: 'inherit' });

const dist = resolve(checkout, 'dist');
if (!existsSync(dist)) throw new Error('Official frontend build did not produce dist/');
mkdirSync(output, { recursive: true });
cpSync(dist, output, { recursive: true });
console.log(`Official frontend synced to ${output}`);
