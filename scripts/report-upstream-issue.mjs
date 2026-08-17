import fs from 'node:fs';

const owner = process.env.GITHUB_REPOSITORY?.split('/')[0];
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const token = process.env.GITHUB_TOKEN;
if (!owner || !repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
const compatibility = JSON.parse(fs.readFileSync('.upstream/compatibility.json', 'utf8'));
const title = '[upstream-incompatible] Official Sub-Store backend changed';
const headers = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  'user-agent': 'sub-store-cloudflare-upstream-sync',
};
const api = `https://api.github.com/repos/${owner}/${repo}`;
const list = await (await fetch(`${api}/issues?state=open&per_page=100`, { headers })).json();
const existing = Array.isArray(list) ? list.find((i) => i.title === title) : null;
const body = [
  '官方 Sub-Store backend 上游发生变化，但本仓库的 Cloudflare Workers compatibility gate 判定不安全，已阻止生产部署。',
  '',
  `官方 backend version: ${compatibility.officialBackendVersion}`,
  `检查时间: ${compatibility.checkedAt}`,
  '',
  '阻断原因：',
  ...compatibility.hardBlockReasons.map((x) => `- ${x}`),
  '',
  '这不是官方 Node.js backend 的自动移植失败；本项目会刻意阻止把 Node-only backend 直接部署到 Cloudflare Workers。请完成对应 Workers 适配后再解除门禁。',
].join('\n');

if (existing) {
  await fetch(`${api}/issues/${existing.number}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) });
  console.log(`Updated issue #${existing.number}`);
} else {
  const res = await fetch(`${api}/issues`, { method: 'POST', headers, body: JSON.stringify({ title, body }) });
  if (!res.ok) throw new Error(`Failed to create issue: ${res.status} ${await res.text()}`);
  const created = await res.json();
  console.log(`Created issue #${created.number}`);
}
