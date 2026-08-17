import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const statePath = resolve(root, '.upstream/state.json');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const token = process.env.GITHUB_TOKEN || '';
const headers = { 'accept': 'application/vnd.github+json', 'user-agent': 'sub-store-cloudflare-upstream-sync' };
if (token) headers.authorization = `Bearer ${token}`;

async function getJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

const feRepo = await getJson('https://api.github.com/repos/sub-store-org/Sub-Store-Front-End');
const beRepo = await getJson('https://api.github.com/repos/sub-store-org/Sub-Store');
const feBranch = feRepo.default_branch;
const beBranch = beRepo.default_branch;
const fe = await getJson(`https://api.github.com/repos/sub-store-org/Sub-Store-Front-End/commits/${encodeURIComponent(feBranch)}`);
const be = await getJson(`https://api.github.com/repos/sub-store-org/Sub-Store/commits/${encodeURIComponent(beBranch)}`);
const bePkgRes = await fetch(`https://raw.githubusercontent.com/sub-store-org/Sub-Store/${encodeURIComponent(beBranch)}/backend/package.json`, { headers: { 'user-agent': headers['user-agent'] } });
if (!bePkgRes.ok) throw new Error(`backend/package.json HTTP ${bePkgRes.status}`);
const bePkg = JSON.parse(await bePkgRes.text());

let changed = [];
if (state.backend.sha && state.backend.sha !== be.sha) {
  const compare = await getJson(`https://api.github.com/repos/sub-store-org/Sub-Store/compare/${state.backend.sha}...${be.sha}`);
  changed = (compare.files || []).map((x) => ({ filename: x.filename, status: x.status, additions: x.additions, deletions: x.deletions }));
}

const result = {
  frontendChanged: Boolean(state.frontend.sha && state.frontend.sha !== fe.sha),
  backendChanged: Boolean(state.backend.sha && state.backend.sha !== be.sha),
  frontendFirstRun: !state.frontend.sha,
  backendFirstRun: !state.backend.sha,
  frontendSha: fe.sha,
  backendSha: be.sha,
  frontendBranch: feBranch,
  backendBranch: beBranch,
  backendVersion: bePkg.version || '',
  changed,
  checkedAt: new Date().toISOString(),
};
writeFileSync(resolve(root, '.upstream/check-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
const out = process.env.GITHUB_OUTPUT;
if (out) {
  const fs = await import('node:fs');
  fs.appendFileSync(out, `frontend_changed=${result.frontendChanged}\nbackend_changed=${result.backendChanged}\nfrontend_first_run=${result.frontendFirstRun}\nbackend_first_run=${result.backendFirstRun}\n`);
}
