import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CACHE: KVNamespace;
  R2?: R2Bucket;
  SUB_STORE_CORS_ALLOWED_ORIGINS: string;
  CACHE_TTL_SECONDS: string;
  ADMIN_TOKEN?: string;
}

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

function allowedOrigins(raw: string): string[] | '*' {
  if (!raw || raw.trim() === '*') return '*';
  return raw.split(',').map(v => v.trim()).filter(Boolean);
}

app.use('*', async (c, next) => {
  const origins = allowedOrigins(c.env.SUB_STORE_CORS_ALLOWED_ORIGINS);
  const middleware = cors({
    origin: origin => {
      if (origins === '*') return origin || '*';
      return origins.includes(origin) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposeHeaders: ['Content-Disposition', 'Content-Type', 'X-Sub-Store-Cache'],
  });
  return middleware(c, next);
});

function now() {
  return Date.now();
}

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function requireName(name: string | undefined) {
  if (!name || !/^[A-Za-z0-9._~\-\u4e00-\u9fff]{1,120}$/.test(name)) {
    throw new HTTPException(400, { message: 'Invalid subscription name' });
  }
  return name;
}

function decodeBase64(input: string): Uint8Array {
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function parseYamlSimple(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function parseNodeUris(content: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const line of content.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    try {
      const u = new URL(s);
      const name = decodeURIComponent(u.hash.slice(1)) || `${u.protocol.replace(':', '')}-${u.hostname}`;
      const protocol = u.protocol.replace(':', '').toLowerCase();
      if (protocol === 'vmess') {
        const payload = decodeBase64(u.pathname.replace(/^\//, '').replace(/=+$/g, ''));
        const obj = JSON.parse(new TextDecoder().decode(payload));
        nodes.push({ ...obj, name: obj.ps || name, type: 'vmess' });
      } else {
        nodes.push({
          name,
          type: protocol,
          server: u.hostname,
          port: Number(u.port || 443),
          username: u.username ? decodeURIComponent(u.username) : undefined,
          password: u.password ? decodeURIComponent(u.password) : undefined,
        });
      }
    } catch {
      // Ignore malformed lines in the basic parser.
    }
  }
  return nodes;
}

function toMihomo(nodes: Record<string, unknown>[]) {
  const proxies = nodes.map(n => {
    const p: Record<string, unknown> = {
      name: n.name,
      type: n.type,
      server: n.server,
      port: n.port,
    };
    for (const key of ['username', 'password', 'uuid', 'cipher', 'tls', 'sni', 'network', 'ws-opts', 'grpc-opts', 'udp', 'skip-cert-verify']) {
      if (n[key] !== undefined) p[key] = n[key];
    }
    return p;
  });
  return { proxies };
}

function targetOutput(target: string, source: string): { body: string; contentType: string } {
  const normalized = target.toLowerCase();
  if (normalized === 'raw' || normalized === 'base64') {
    return { body: source, contentType: 'text/plain; charset=utf-8' };
  }

  const nodes = parseNodeUris(source);
  if (normalized === 'clash' || normalized === 'mihomo' || normalized === 'clashmeta') {
    // Deliberately conservative YAML emitter: quote every scalar.
    const lines = ['proxies:'];
    for (const node of toMihomo(nodes).proxies as Record<string, unknown>[]) {
      lines.push(`  - name: ${JSON.stringify(String(node.name ?? ''))}`);
      lines.push(`    type: ${JSON.stringify(String(node.type ?? ''))}`);
      lines.push(`    server: ${JSON.stringify(String(node.server ?? ''))}`);
      lines.push(`    port: ${Number(node.port ?? 443)}`);
      for (const key of ['username', 'password', 'uuid', 'cipher', 'tls', 'sni', 'network']) {
        if (node[key] !== undefined) lines.push(`    ${key}: ${JSON.stringify(node[key])}`);
      }
    }
    return { body: lines.join('\n') + '\n', contentType: 'text/yaml; charset=utf-8' };
  }

  if (normalized === 'json') {
    return { body: JSON.stringify({ proxies: nodes }, null, 2), contentType: 'application/json; charset=utf-8' };
  }

  return { body: source, contentType: 'text/plain; charset=utf-8' };
}

async function auth(c: any, next: any) {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return next();
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token !== expected) throw new HTTPException(401, { message: 'Unauthorized' });
  return next();
}

app.get('/api/health', c => c.json({ ok: true, service: 'sub-store-cloudflare', timestamp: now() }));
app.get('/health', c => c.json({ ok: true, service: 'sub-store-cloudflare', timestamp: now() }));

app.get('/api/utils/env', c => c.json({
  backend: 'CloudflareWorkers',
  version: '0.1.0',
  feature: {
    d1: true,
    kv: true,
    r2: Boolean(c.env.R2),
    cron: true,
    basicSubscription: true,
  },
  meta: { runtime: 'cloudflare-workers' },
}));

app.get('/api/utils/testJSON', c => c.json({ ok: true }));
app.get('/api/utils/testText', c => c.text('ok'));

app.get('/api/storage', auth, async c => {
  const rows = await c.env.DB.prepare('SELECT * FROM subscriptions ORDER BY name').all<SubscriptionRow>();
  const payload = { settings: {}, subscriptions: rows.results ?? [] };
  return jsonResponse(payload, {
    headers: {
      'content-disposition': `attachment; filename="sub-store_data_${new Date().toISOString().slice(0,10)}.json"`,
    },
  });
});

app.post('/api/storage', auth, async c => {
  const body = await c.req.parseBody();
  const raw = String(body.content ?? '');
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new HTTPException(400, { message: 'Invalid backup JSON' });
  }
  const subscriptions = Array.isArray(payload.subscriptions) ? payload.subscriptions : [];
  const stmt = c.env.DB.prepare('DELETE FROM subscriptions');
  await stmt.run();
  for (const s of subscriptions) {
    await saveSubscription(c.env, s);
  }
  return c.json({ ok: true, count: subscriptions.length });
});

app.get('/api/subscriptions', auth, async c => {
  const rows = await c.env.DB.prepare('SELECT * FROM subscriptions ORDER BY name').all<SubscriptionRow>();
  return c.json({ subscriptions: rows.results ?? [] });
});

async function saveSubscription(env: Env, input: SubscriptionInput) {
  const name = requireName(input.name);
  const timestamp = now();
  const config = JSON.stringify(input.config ?? {});
  await env.DB.prepare(`
    INSERT INTO subscriptions (name,url,content,target,user_agent,config_json,enabled,created_at,updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      url=excluded.url,
      content=excluded.content,
      target=excluded.target,
      user_agent=excluded.user_agent,
      config_json=excluded.config_json,
      enabled=excluded.enabled,
      updated_at=excluded.updated_at
  `).bind(
    name,
    input.url ?? null,
    input.content ?? null,
    input.target ?? 'raw',
    input.userAgent ?? null,
    config,
    input.enabled === false ? 0 : 1,
    timestamp,
    timestamp,
  ).run();
  return name;
}

app.post('/api/subscriptions', auth, async c => {
  const input = await c.req.json<SubscriptionInput>();
  const name = await saveSubscription(c.env, input);
  await c.env.CACHE.delete(`sub:${name}`);
  return c.json({ ok: true, name });
});

app.put('/api/subscriptions/:name', auth, async c => {
  const input = await c.req.json<SubscriptionInput>();
  input.name = c.req.param('name');
  const name = await saveSubscription(c.env, input);
  await c.env.CACHE.delete(`sub:${name}`);
  return c.json({ ok: true, name });
});

app.delete('/api/subscriptions/:name', auth, async c => {
  const name = requireName(c.req.param('name'));
  await c.env.DB.prepare('DELETE FROM subscriptions WHERE name=?').bind(name).run();
  await c.env.CACHE.delete(`sub:${name}`);
  return c.json({ ok: true });
});

async function resolveSubscription(env: Env, name: string, requestUrl: URL, userAgent: string) {
  const cacheKey = `sub:${name}:${requestUrl.search}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) return { body: cached, hit: true };

  const row = await env.DB.prepare('SELECT * FROM subscriptions WHERE name=? AND enabled=1').bind(name).first<SubscriptionRow>();
  if (!row) throw new HTTPException(404, { message: 'Subscription not found' });

  const runtimeUrl = requestUrl.searchParams.get('url');
  const runtimeContent = requestUrl.searchParams.get('content');
  const ua = requestUrl.searchParams.get('ua') || row.user_agent || userAgent;
  let source = runtimeContent || row.content || '';

  if (runtimeUrl || row.url) {
    const sourceUrl = runtimeUrl || row.url!;
    const response = await fetch(sourceUrl, { headers: { 'User-Agent': ua } });
    if (!response.ok) throw new HTTPException(502, { message: `Upstream subscription HTTP ${response.status}` });
    source = await response.text();
  }

  if (!source) throw new HTTPException(400, { message: 'Subscription has no url or content' });

  const target = requestUrl.searchParams.get('target') || row.target || 'raw';
  const result = targetOutput(target, source);
  const ttl = Math.max(30, Number(env.CACHE_TTL_SECONDS || 300));
  await env.CACHE.put(cacheKey, result.body, { expirationTtl: ttl });
  return { ...result, hit: false };
}

app.all('/download/:name', async c => {
  const name = requireName(c.req.param('name'));
  const requestUrl = new URL(c.req.url);
  const ua = c.req.header('User-Agent') || '';
  const result = await resolveSubscription(c.env, name, requestUrl, ua);
  return new Response(result.body, {
    headers: {
      'content-type': result.contentType || 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'x-sub-store-cache': result.hit ? 'HIT' : 'MISS',
    },
  });
});

app.get('/api/file/:name', async c => {
  const name = requireName(c.req.param('name'));
  const requestUrl = new URL(c.req.url);
  const result = await resolveSubscription(c.env, name, requestUrl, c.req.header('User-Agent') || '');
  return new Response(result.body, {
    headers: {
      'content-type': result.contentType || 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
});

app.get('/api/file/:name/metadata', async c => {
  const name = requireName(c.req.param('name'));
  const row = await c.env.DB.prepare('SELECT name,target,url,enabled,updated_at FROM subscriptions WHERE name=?').bind(name).first();
  if (!row) throw new HTTPException(404, { message: 'File/subscription not found' });
  return c.json(row);
});

app.get('/', async c => {
  const url = new URL(c.req.url);
  if (!url.searchParams.has('api')) {
    url.searchParams.set('api', url.origin);
    return c.redirect(url.toString(), 302);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.all('/api/*', c => c.json({
  ok: false,
  error: 'Not implemented in the Workers compatibility layer',
  path: new URL(c.req.url).pathname,
}, 501));

app.notFound(async c => {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  return asset.status === 404 ? c.text('Not Found', 404) : asset;
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ ok: false, error: err.message || 'Internal Server Error' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refreshEnabledSubscriptions(env));
  },
};

async function refreshEnabledSubscriptions(env: Env) {
  const rows = await env.DB.prepare('SELECT * FROM subscriptions WHERE enabled=1 AND url IS NOT NULL').all<SubscriptionRow>();
  for (const row of rows.results ?? []) {
    try {
      const url = new URL(`https://worker.internal/download/${encodeURIComponent(row.name)}`);
      const result = await resolveSubscription(env, row.name, url, row.user_agent || 'Sub-Store-Cloudflare-Cron');
      console.log(`refreshed ${row.name}: ${result.body.length} bytes`);
    } catch (error) {
      console.error(`refresh failed: ${row.name}`, error);
    }
  }
}
