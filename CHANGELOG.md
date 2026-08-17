# Changelog

## 2.0.1

- Removed `@cloudflare/workers-types` from Worker devDependencies.
- Added `@types/node` because `nodejs_compat` is enabled.
- `npm run typecheck` now relies on `wrangler types` generated runtime/binding types.
- Updated `tsconfig.json` to include `worker-configuration.d.ts`.
- Fixed the Hono admin middleware to use `createMiddleware`, matching current `next(): Promise<void>` typing.
- Bumped Wrangler to the current 4.x line used by the CI logs.
