import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

type Env = Cloudflare.Env & {
  ADMIN_TOKEN?: string;
  CACHE: KVNamespace;
  DB: D1Database;
  R2?: R2Bucket; // Optional binding
  SUB_STORE_CORS_ALLOWED_ORIGINS?: string;
  CACHE_TTL_SECONDS?: string;
};

type SubscriptionRow = {
  id: number;
  name: string;
  url: string | null;
  content: string | null;
  target: string;
  user_agent: string | null;
  config_json: string;
  enabled: number;
  created_at: number;
  updated_at: number;
};

type SubscriptionInput = {
  name: string;
  url?: string;
  content?: string;
  target?: string;
  userAgent?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
};

const app = new Hono<{ Bindings: Env }>();

const originList = (raw: string) => {
  if (!raw || raw.trim() === '*') return '*';
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
};

app.use('*', async (c, next) => {
  const origins = originList(c.env.SUB_STORE_CORS_ALLOWED_ORIGINS || '*');
  return cors({
    origin: (origin) => origins === '*' ? (origin || '*') : (origin && origins.includes(origin) ? origin : ''),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposeHeaders: ['Content-Disposition', 'Content-Type', 'X-Sub-Store-Cache'],
  })(c, next);
});

function now() { return Date.now(); }

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function validName(name?: string) {
  if (!name || !/^[\w.\-\u4e00-\u9fff]{1,120}$/u.test(name)) throw new HTTPException(400, { message: 'Invalid subscription name' });
  return name;
}

function safeUrl(value?: string) {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('unsupported protocol');
    return u.toString();
  } catch {
    throw new HTTPException(400, { message: 'Invalid subscription URL' });
  }
}

function b64decode(value: string) {
  const bin = atob(value);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function b64encode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  return btoa(out);
}

function parseUriNodes(source: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      const u = new URL(line);
      const type = u.protocol.slice(0, -1).toLowerCase();
      const name = decodeURIComponent(u.hash.replace(/^#/, '')) || `${type}-${u.hostname}`;
      
      if (type === 'vmess') {
        const payload = u.pathname.replace(/^\//, '').replace(/=+$/g, '');
        const obj = JSON.parse(b64decode(payload));
        nodes.push({ ...obj, name: obj.ps || name, type: 'vmess' });
        continue;
      }
      
      const item: Record<string, unknown> = { name, type, server: u.hostname, port: Number(u.port || 443) };
      if (u.username) item.username = decodeURIComponent(u.username);
      if (u.password) item.password = decodeURIComponent(u.password);
      if (type === 'trojan') item.password = decodeURIComponent(u.username || u.password || '');
      if (u.searchParams.get('sni')) item.sni = u.searchParams.get('sni');
      if (u.searchParams.get('security')) item.tls = u.searchParams.get('security') !== 'none';
      nodes.push(item);
    } catch {
      // Keep parser conservative: malformed lines are ignored.
    }
  }
  return nodes;
}

function toMihomo(nodes: Record<string, unknown>[]) {
  const proxies = nodes.map((n) => {
    const p: Record<string, unknown> = { name: n.name, type: n.type, server: n.server, port: n.port };
    for (const key of ['username', 'password', 'uuid', 'cipher', 'tls', 'sni', 'network', 'ws-opts', 'grpc-opts', 'udp', 'skip-cert-verify']) {
      if (n[key] !== undefined) p[key] = n[key];
    }
    return p;
  });
  return { proxies };
}

function renderTarget(target: string, source: string) {
  const t = (target || 'raw').toLowerCase();
  if (['raw', 'base64', 'uri', 'v2ray'].includes(t)) return { body: source, contentType: 'text/plain; charset=utf-8' };
  
  const trimmed = source.trim();
  if (['clash', 'mihomo', 'clashmeta', 'yaml'].includes(t)) {
    try {
      const parsed = parseYaml(trimmed);
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).proxies)) {
        return { body: stringifyYaml(parsed), contentType: 'text/yaml; charset=utf-8' };
      }
    } catch {}
    return { body: stringifyYaml(toMihomo(parseUriNodes(source))), contentType: 'text/yaml; charset=utf-8' };
  }
  
  if (t === 'json') return { body: JSON.stringify({ proxies: parseUriNodes(source) }, null, 2), contentType: 'application/json; charset=utf-8' };
  if (t === 'base64-json') return { body: b64encode(JSON.stringify(parseUriNodes(source))), contentType: 'text/plain; charset=utf-8' };
  
  return { body: source, contentType: 'text/plain; charset=utf-8' };
}

const admin = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (!c.env.ADMIN_TOKEN) {
    await next();
    return;
  }
  const auth = c.req.header('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== c.env.ADMIN_TOKEN) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  await next();
});

async function fetchSource(env: Env, row: SubscriptionRow) {
  if (row.content) return row.content;
  if (!row.url) return '';
  
  const cacheKey = `sub:${row.id}:${row.updated_at}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return cached;
  
  const res = await fetch(row.url, {
    headers: { 'user-agent': row.user_agent || 'Sub-Store-Cloudflare/2.0' },
  });
  
  if (!res.ok) throw new HTTPException(502, { message: `Upstream returned ${res.status}` });
  const text = await res.text();
  await env.CACHE.put(cacheKey, text, { expirationTtl: Number(env.CACHE_TTL_SECONDS || 900) });
  return text;
}

async function saveSubscription(env: Env, input: SubscriptionInput) {
  const name = validName(input.name);
  const url = safeUrl(input.url);
  const content = input.content || null;
  
  if (!url && !content) throw new HTTPException(400, { message: 'url or content is required' });
  
  const timestamp = now();
  const existing = await env.DB.prepare('SELECT id FROM subscriptions WHERE name = ?').bind(name).first<{ id: number }>();
  
  const commonParams = [
    url || null, 
    content, 
    input.target || 'raw', 
    input.userAgent || null, 
    JSON.stringify(input.config || {}), 
    input.enabled === false ? 0 : 1, 
    timestamp
  ];

  if (existing) {
    await env.DB.prepare(`UPDATE subscriptions SET url=?, content=?, target=?, user_agent=?, config_json=?, enabled=?, updated_at=? WHERE name=?`)
      .bind(...commonParams, name).run();
  } else {
    await env.DB.prepare(`INSERT INTO subscriptions(name,url,content,target,user_agent,config_json,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(name, ...commonParams, timestamp).run();
  }
  
  return await env.DB.prepare('SELECT * FROM subscriptions WHERE name = ?').bind(name).first<SubscriptionRow>();
}

// --- Routes ---

app.get('/api/health', (c) => c.json({ ok: true, service: 'sub-store-cloudflare', runtime: 'cloudflare-workers', version: '2.0.0', timestamp: now() }));
app.get('/health', (c) => c.json({ ok: true, service: 'sub-store-cloudflare', timestamp: now() }));

// 【关键修复】兼容官方前端的 /api/utils/env 接口
app.get('/api/utils/env', (c) => {
  return c.json({
    status: 'success',
    data: {
      backend: 'CloudflareWorkers',
      version: '2.1.0',
      feature: {
        d1: true,
        kv: true,
        r2: true,
        cron: true,
        basicSubscription: true,
      },
      meta: {
        runtime: 'cloudflare-workers',
        officialFrontendRepo: 'https://github.com/sub-store-org/Sub-Store-Front-End',
        officialBackendRepo: 'https://github.com/sub-store-org/Sub-Store',
      },
    },
  });
});

app.get('/api/utils/testJSON', (c) => c.json({ ok: true }));
app.get('/api/utils/testText', (c) => c.text('ok'));

// Backup & Restore
app.get('/api/storage', admin, async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM subscriptions ORDER BY name').all<SubscriptionRow>();
  return json({ settings: {}, subscriptions: rows.results || [] }, { 
    headers: { 'content-disposition': `attachment; filename="sub-store_data_${new Date().toISOString().slice(0,10)}.json"` } 
  });
});

app.post('/api/storage', admin, async (c) => {
  const body = await c.req.text();
  let payload: any;
  try { payload = JSON.parse(body); } catch { throw new HTTPException(400, { message: 'Invalid backup JSON' }); }
  
  await c.env.DB.prepare('DELETE FROM subscriptions').run();
  const subscriptions = Array.isArray(payload.subscriptions) ? payload.subscriptions : [];
  for (const item of subscriptions) await saveSubscription(c.env, item);
  
  return c.json({ ok: true, count: subscriptions.length });
});

// Subscription Management
app.get('/api/subscriptions', admin, async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM subscriptions ORDER BY name').all<SubscriptionRow>();
  return c.json({ subscriptions: rows.results || [] });
});

app.post('/api/subscriptions', admin, async (c) => {
  const body = await c.req.json<SubscriptionInput>();
  const row = await saveSubscription(c.env, body);
  return c.json({ subscription: row });
});

app.get('/api/subscriptions/:name', admin, async (c) => {
  const name = c.req.param('name');
  const row = await c.env.DB.prepare('SELECT * FROM subscriptions WHERE name = ?').bind(name).first<SubscriptionRow>();
  if (!row) throw new HTTPException(404, { message: 'Subscription not found' });
  return c.json({ subscription: row });
});

app.put('/api/subscriptions/:name', admin, async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json<SubscriptionInput>();
  // Ensure we are updating the correct name if body.name differs, but usually name is the key
  const updateData = { ...body, name: name }; 
  const row = await saveSubscription(c.env, updateData);
  return c.json({ subscription: row });
});

app.delete('/api/subscriptions/:name', admin, async (c) => {
  const name = c.req.param('name');
  await c.env.DB.prepare('DELETE FROM subscriptions WHERE name = ?').bind(name).run();
  return c.json({ ok: true });
});

// Subscription Output / Conversion
app.get('/download/:name', async (c) => {
  const name = c.req.param('name');
  const target = c.req.query('target') || 'raw';
  
  const row = await c.env.DB.prepare('SELECT * FROM subscriptions WHERE name = ? AND enabled = 1').bind(name).first<SubscriptionRow>();
  if (!row) throw new HTTPException(404, { message: 'Subscription not found or disabled' });
  
  const source = await fetchSource(c.env, row);
  const { body, contentType } = renderTarget(target, source);
  
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'cache-control': 'no-cache',
    },
  });
});

export default app;
