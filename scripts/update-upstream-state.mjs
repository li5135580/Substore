import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const statePath = resolve(root, '.upstream/state.json');
const result = JSON.parse(readFileSync(resolve(root, '.upstream/check-result.json'), 'utf8'));
const compatibilityPath = resolve(root, '.upstream/compatibility.json');
let compatibility = null;
try { compatibility = JSON.parse(readFileSync(compatibilityPath, 'utf8')); } catch {}

if (result.backendChanged && compatibility && !compatibility.compatible) {
  console.error('Refusing to update backend state after an incompatible upstream change.');
  process.exit(11);
}

const state = {
  frontend: { repo: 'sub-store-org/Sub-Store-Front-End', branch: result.frontendBranch || 'master', sha: result.frontendSha },
  backend: { repo: 'sub-store-org/Sub-Store', branch: result.backendBranch || 'master', sha: result.backendSha, version: result.backendVersion },
  updatedAt: result.checkedAt,
};
writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
