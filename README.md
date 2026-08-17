# Sub-Store + Cloudflare Workers

这是一个 GitHub 可部署的 Cloudflare Workers 版本仓库模板：

- 前端：构建时自动拉取官方 `sub-store-org/Sub-Store-Front-End`，不 fork、不修改官方 UI 源码。
- 后端：Cloudflare Workers + Hono。
- 数据库：Cloudflare D1。
- 缓存：Cloudflare KV。
- 对象存储：Cloudflare R2（可选）。
- 定时任务：Workers Cron。
- 部署：GitHub Actions + Wrangler。

## 重要兼容性说明

官方 Sub-Store 后端目前是 Node.js/Express，并包含 Node 专用依赖；本项目不是把官方 Node backend 强行运行在 Workers 中，而是实现一个 Workers 原生兼容层。

因此，本仓库当前直接实现的是：健康检查、环境信息、持久化存储、订阅 CRUD、远程订阅抓取、基础节点 URI/Clash YAML 解析、通用 `/download/:name` 输出以及文件接口基础能力。复杂的官方转换器、代理链、Node 专用脚本运行时和全部历史 API 尚未宣称 100% 兼容。

官方文档确认前端可以通过 `?api=...` 指定后端，例如本地前端可用 `?api=http://127.0.0.1:3001/123`；因此本项目把 API 做在同一个 Worker 域名下，以便后续兼容扩展。官方后端也具有 CORS allowlist 与 `/api/storage` 等接口。参考：

- https://github.com/sub-store-org/Sub-Store
- https://github.com/sub-store-org/Sub-Store-Front-End
- https://github.com/sub-store-org/Sub-Store/wiki/链接参数说明

## 仓库结构

```text
sub-store-cloudflare/
├── .github/workflows/deploy.yml
├── scripts/sync-official-frontend.mjs
├── worker/
│   ├── migrations/0001_init.sql
│   ├── src/index.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── wrangler.toml
├── .gitignore
└── README.md
```

## 第一次部署

### 1. 创建 Cloudflare 资源

```bash
npx wrangler login
npx wrangler d1 create sub-store-db
npx wrangler kv namespace create SUB_STORE_CACHE
npx wrangler r2 bucket create sub-store-assets
```

把命令返回的 D1 database_id 和 KV id 填入 `worker/wrangler.toml`。

R2 是可选的；若暂时不用，可以删除 R2 binding。

### 2. 本地安装

```bash
cd worker
npm install
npx wrangler d1 migrations apply sub-store-db --remote
npm run deploy
```

### 3. GitHub Actions

在 GitHub 仓库 Settings → Secrets and variables → Actions 中创建：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Cloudflare API Token 至少需要 Workers Scripts/Edit、Workers Routes/Edit（使用自定义域名时）以及 D1 Edit/KV Edit/R2 Edit（取决于你的部署方式）。

然后推送到 `main`，GitHub Actions 会：

1. 拉取官方 Sub-Store Front-End；
2. 构建官方前端；
3. 复制到 Worker 静态资源目录；
4. 执行 D1 migration；
5. 部署 Worker。

## 自定义域名

推荐在 Cloudflare Dashboard 中把：

```text
sub.example.com
```

绑定为 Worker Custom Domain。这样最终：

```text
https://sub.example.com/
https://sub.example.com/api/health
https://sub.example.com/download/demo
```

根路径首次访问会自动补上官方前端支持的 `?api=<当前 Worker origin>` 参数，因此前端与 Worker API 使用同一域名。官方文档明确展示了 `?api=...` 的后端指定方式。

都由同一个 Worker 提供。

## 订阅接口示例

创建订阅：

```bash
curl -X POST "https://sub.example.com/api/subscriptions" \
  -H "content-type: application/json" \
  -d '{
    "name":"demo",
    "url":"https://example.com/sub.txt",
    "target":"raw",
    "userAgent":"ClashMeta"
  }'
```

访问：

```text
https://sub.example.com/download/demo
```

指定目标：

```text
https://sub.example.com/download/demo?target=clash
```

按照官方 Wiki，Sub-Store 下载链接支持 `target`、`url`、`content`、`ua` 等运行时参数；本仓库逐步兼容这些参数。详见官方 Wiki。

## 安全建议

不要把 Cloudflare API Token、D1 数据库密钥或管理密钥写入 Git。

生产环境建议把管理接口增加 `ADMIN_TOKEN`，并限制 CORS 到你的前端域名。

如果公开分享 `/download/*`，任何知道链接的人都可以读取对应订阅内容；敏感订阅建议使用随机名称/Token。
