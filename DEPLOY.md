# Cloudflare / GitHub 部署步骤

## Cloudflare CLI

```bash
npx wrangler login
npx wrangler d1 create sub-store-db
npx wrangler kv namespace create SUB_STORE_CACHE
npx wrangler r2 bucket create sub-store-assets
```

把返回值填写到 `worker/wrangler.toml`：

- `database_id`
- `kv_namespaces.id`

## D1 初始化

```bash
cd worker
npm install
npx wrangler d1 migrations apply sub-store-db --remote
```

## 管理 Token

```bash
npx wrangler secret put ADMIN_TOKEN
```

## GitHub Actions

仓库 Settings → Secrets and variables → Actions：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

## API Token 权限

使用 Cloudflare API Token，而不是 Global API Key。按照你实际部署资源授予必要权限：Workers Scripts、D1、KV、R2；绑定自定义域名时还需要对应 Workers Routes/Zone 权限。

## 自定义域名

Cloudflare Dashboard → Workers & Pages → `sub-store-cloudflare` → Domains & Routes → Add Custom Domain。

例如：

```text
sub.example.com
```

## 首次测试

```text
https://sub.example.com/api/health
```

应该返回：

```json
{"ok":true,"service":"sub-store-cloudflare","timestamp":...}
```

然后访问根域名，应该显示官方 Sub-Store 前端。
