import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const result = JSON.parse(readFileSync(resolve(root, '.upstream/check-result.json'), 'utf8'));
const packageUrl = 'https://raw.githubusercontent.com/sub-store-org/Sub-Store/master/backend/package.json';
const pkg = JSON.parse(await (await fetch(packageUrl)).text());

const knownNodeOnly = new Set([
  'express', 'cron', 'fetch-socks', 'http-proxy-middleware', 'undici', 'body-parser', 'connect-history-api-fallback', 'nodemon'
]);
const deps = Object.keys(pkg.dependencies || {});
const nodeOnlyDeps = deps.filter((x) => knownNodeOnly.has(x));
const changedBackendFiles = (result.changed || []).filter((x) => x.filename.startsWith('backend/'));
const riskyPathPatterns = [/backend\/src\/.*(?:proxy|server|cron|filesystem|dns|network)/i, /backend\/package\.json$/i];
const riskyPaths = changedBackendFiles.filter((x) => riskyPathPatterns.some((r) => r.test(x.filename)));

// This is a safety gate, not an automatic source-code port. The official backend is Node.js.
const hardBlockReasons = [];
if (riskyPaths.length) hardBlockReasons.push(`risky backend paths changed: ${riskyPaths.map((x) => x.filename).join(', ')}`);
if (result.backendChanged && changedBackendFiles.some((x) => x.filename === 'backend/package.json')) {
  hardBlockReasons.push(`backend/package.json changed; review dependency/runtime compatibility (current Node-only deps: ${nodeOnlyDeps.join(', ') || 'none detected'})`);
}

const output = {
  compatible: hardBlockReasons.length === 0,
  officialBackendVersion: pkg.version || result.backendVersion,
  changedBackendFiles,
  riskyPaths,
  nodeOnlyDeps,
  hardBlockReasons,
  checkedAt: new Date().toISOString(),
};
writeFileSync(resolve(root, '.upstream/compatibility.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
if (!output.compatible) process.exit(10);
