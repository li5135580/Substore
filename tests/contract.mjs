const base = process.env.WORKER_TEST_URL || 'http://127.0.0.1:8787';

async function expectStatus(path, statuses = [200]) {
  const res = await fetch(`${base}${path}`);
  if (!statuses.includes(res.status)) {
    const text = await res.text();
    throw new Error(`${path}: expected ${statuses.join('/')} got ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

await expectStatus('/api/health');
await expectStatus('/health');
await expectStatus('/api/utils/env');
await expectStatus('/api/utils/testJSON');
await expectStatus('/api/utils/testText');
console.log(`Contract tests passed against ${base}`);
