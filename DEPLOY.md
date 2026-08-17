# Deployment

## 1. Create GitHub repository

Upload the entire repository, including `.github/`, `worker/`, `scripts/`, `tests/` and `.upstream/`.

## 2. Configure GitHub secrets

Settings → Secrets and variables → Actions → New repository secret:

`CLOUDFLARE_API_TOKEN`

`CLOUDFLARE_ACCOUNT_ID`

Recommended token scope: Workers Scripts edit, D1 edit, KV edit and R2 edit for the target account. Use the narrowest account-scoped permissions that work for your deployment model.

Optional application secret:

`SUB_STORE_ADMIN_TOKEN`

If configured, the GitHub Actions deployment automatically writes it to the Worker as the `ADMIN_TOKEN` secret.

## 3. Push main

```bash
git add .
git commit -m "feat: initial deployment"
git push origin main
```

GitHub Actions will:

1. Download the official Sub-Store Front-End.
2. Build it using pnpm 11.0.9.
3. Install and typecheck the Worker.
4. Run Worker contract tests locally.
5. Run D1 migrations using the `DB` binding.
6. Let Wrangler automatically provision missing D1/KV/R2 resources.
7. Deploy Worker and frontend assets.

Cloudflare documents automatic provisioning for D1/KV/R2 and notes that GitHub-based deployments can create resources without committing account-specific IDs back to the repository.

## 4. Automatic upstream tracking

`upstream-sync.yml` runs every 30 minutes and can also be started manually.

- Frontend update: automatically rebuild and deploy.
- Backend update: fetch the new upstream package metadata and changed-file list; run a compatibility gate; safe changes continue to deploy the current Worker compatibility layer; unsafe Node-specific changes stop production deployment and open/update an issue.

The design intentionally does not copy the official Node.js backend into Workers.

## 5. Custom domain

After the first successful deployment, bind a custom domain in Cloudflare. The Worker can serve both the official frontend and API from the same host.

## 6. Resource provisioning

Do not run these commands manually for this repository:

```bash
wrangler d1 create ...
wrangler kv namespace create ...
wrangler r2 bucket create ...
```

The Wrangler configuration intentionally omits account-specific D1/KV IDs and relies on automatic provisioning.


## TypeScript runtime types

The Worker now follows Cloudflare's recommended `wrangler types` flow. Do not add `@cloudflare/workers-types` back to `worker/package.json`; `npm run typecheck` generates `worker/worker-configuration.d.ts` from `wrangler.toml` before running `tsc`.
