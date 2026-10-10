# CLAUDE.md

Guidance for Claude Code in this repository. Keep it short and true: update it in the same PR when a rule here changes.

## Layout

- `backend/` - Express 5 + TypeScript API (one process, modules split by domain): `src/routes` → `src/controllers` → `src/services` / `src/models`, MySQL via `mysql2`, Redis via `ioredis`.
- `frontend/` - Next.js 16 + React 19. Read `frontend/AGENTS.md` before frontend work: this Next.js version differs from training data; check `node_modules/next/dist/docs/`.
- `frontend/src/pages/api/[[...path]].ts` embeds the backend for Vercel (`backend/src/serverless.ts`); Docker and local dev run the backend separately.
- `scripts/dev/` helper scripts, `scripts/manual-tests/` curl checks, `docs/archive/` historical notes (do not update).

## Commands

Backend (`cd backend`):
- `npx tsc --noEmit` - type check (also run automatically by a hook after backend edits)
- `npm test` - Jest; MySQL/Redis integration suites skip unless `MYSQL_TEST_SOCKET` or `MYSQL_TEST_HOST` (+ `_PORT`, `_USER`, `_PASSWORD`) and `REDIS_TEST_URL` are set
- `npm run build` - compiles to `dist/` and generates the OpenAPI JSON
- `npm run migrate:dev`, `npm run sync-es:dev` - schema migrations and full Elasticsearch reindex

Frontend (`cd frontend`): `npm test` (Vitest), `npm run lint`, `npm run typecheck`, `npm run build`.

Slash commands: `/verify` (type checks, unit tests, lint), `/integration` (full suite against throwaway MySQL 8.0 + Redis 7 in Docker), `/pr` (branch, commit, push, prefilled PR link).

CI (`.github/workflows/ci.yml`) runs on pull requests to `main`: backend build + tests on Node 24 and MySQL 8.0, a Playwright browser checkout flow, frontend tests, lint and an embedded-API build.

## Conventions

- Validate request input with Joi or the existing `normalize*` helpers; reject unknown fields and answer 400, never 500, for bad input.
- Domain errors use the existing classes (`OrderError`, `SKUError`, `AddressError`, ...) whose `statusCode` defaults to 400; controllers map them with `res.status(error.statusCode)`.
- Money is handled in integer cents (`couponMoneyToCents`, `calculateDiscountCents`); order, stock and coupon changes happen in one MySQL transaction with row locks taken in a fixed order (user → address → products → SKUs → coupons).
- User-facing API messages are Chinese. Every new message the UI can show needs an English entry in `frontend/src/lib/error-translations.ts`.
- Critical admin product, SKU, coupon and user-status writes save their audit on the same transaction connection. `afterProductWrite` only refreshes cache/search after commit; login logging remains best effort.
- Route params are always strings; follow the existing `req.params.id as string` / `positiveId()` idiom.
- Tests live in `backend/src/__tests__` and `frontend/tests`. Write the failing test first for bug fixes, and keep MySQL/Redis integration tests self-contained (own database name, skip without env vars).

## Pitfalls already paid for

- `src/load-env.ts` must stay the first import of `app.ts`, `index.ts` and `serverless.ts`: modules read env vars at load time. Read `JWT_SECRET` only through `jwtSecret()` (`utils/jwt-secret.ts`), shared by customer and admin tokens.
- Express 5 leaves `req.body` undefined without a parsed body; `app.ts` defaults it to `{}` so Joi does not pass `undefined` through. `req.query` is read-only.
- RabbitMQ and Elasticsearch are optional: without `RABBITMQ_URL` timed-out orders are cancelled by the 5-minute poller (or `POST /api/internal/order-timeouts` with `CRON_SECRET`), and without `ELASTICSEARCH_URL` search uses MySQL. `/health` returns 503 only for MySQL or Redis.
- The Elasticsearch client is 9.x and only talks to Elasticsearch 9 servers. ES only decides matches and order; price, stock and status always come from MySQL. Product/SKU writes call `syncProductsToSearchIndex` through `afterProductWrite`.
- ioredis 6 is pinned to `protocol: 2` (Upstash compatibility). express-rate-limit 8 keys IPv4-mapped addresses as plain IPv4.
- Admin sessions carry `admins.auth_version`; logout bumps it. Failed logout retains a purpose-only `admin_logout_retry` httpOnly cookie at `/api/admin` for 24 hours, without extending it on retries; login settles pending exact-version revocations before issuing a new session. Keep this retention at least as long as the maximum admin token lifetime. Customer password changes bump `users.auth_version`.
- TypeScript stays on 5.9: TypeScript 7 drops the compiler API that ts-jest and ts-node need.
- Never read or print `.env` files; use the `.env.example` files for variable names.

## Workflow

1. Work on a branch, never on `main`; keep one concern per PR.
2. Run `/verify` before committing, and `/integration` when SQL, transactions, Redis, migrations or startup code change.
3. Open the PR with `/pr`. Claude merges it with a merge commit once every CI check has passed, never with a failing or pending check, and does not force-push or push to `main`.
4. After a merge: delete the branch (remote and local) and fast-forward local `main`.
