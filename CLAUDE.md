# CLAUDE.md

Guidance for Claude Code in this repository. Keep it short and true: update it in the same PR when a rule here changes.

## Layout

- `backend/` - Express 5 + TypeScript API (one process, modules split by domain): `src/routes` → `src/controllers` → `src/services` / `src/models`, MySQL via `mysql2`, Redis via `ioredis`.
- `frontend/` - Next.js 16 + React 19. Read `frontend/AGENTS.md` before frontend work: this Next.js version differs from training data; check `node_modules/next/dist/docs/`.
- `frontend/src/pages/api/[[...path]].ts` embeds the backend for Vercel (`backend/src/serverless.ts`); Docker and local dev run the backend separately.
- `docs/BACKUP_RESTORE.md` covers backups, the restore drill (`scripts/dev/backup-restore-drill.sh`) and keeping Preview on its own database (`ecommerce_preview`); Preview must never point at the production database.
- `scripts/dev/` helper scripts, `scripts/manual-tests/` curl checks, `docs/archive/` historical notes (do not update).

## Commands

Backend (`cd backend`):
- `npx tsc --noEmit` - type check (also run automatically by a hook after backend edits)
- `npm run test:coverage` - Jest with coverage floors (`jest.config.js`), run by CI; it only passes with MySQL/Redis, so locally use `./scripts/dev/integration-tests.sh --coverage`. Raise floors when coverage improves, never lower them
- `npm test` - Jest; MySQL/Redis integration suites skip unless `MYSQL_TEST_SOCKET` or `MYSQL_TEST_HOST` (+ `_PORT`, `_USER`, `_PASSWORD`) and `REDIS_TEST_URL` are set
- `npm run build` - compiles to `dist/` and generates the OpenAPI JSON
- `npm run migrate:dev`, `npm run sync-es:dev` - schema migrations and full Elasticsearch reindex. Every migration step is idempotent and verifies the existing structure (refusing incompatible schemas); add new steps to `runMigrations` in `database/migrate.ts`, which runs them inside the per-database lock from `database/migration-lock.ts`

Frontend (`cd frontend`): `npm test` (Vitest; `npm run test:coverage` adds the floors in `vitest.config.mts`), `npm run lint`, `npm run typecheck`, `npm run build`. Lint allows no warnings (`--max-warnings 0`). Fix a react-hooks warning only when effects keep firing exactly as before; otherwise keep the line with `// eslint-disable-next-line <rule> -- reason` (unused disables are errors). Do not wrap session/view guards in `useEffectEvent`: it reads the latest render and would accept a late reply for the previous session.

Slash commands: `/verify` (type checks, unit tests, lint), `/integration` (full suite against throwaway MySQL 8.0 + Redis 7 in Docker), `/pr` (branch, commit, push, prefilled PR link).

CI (`.github/workflows/ci.yml`) runs on pull requests to `main` and pushes to `main`, without a duplicate feature-branch push run. New commits cancel older runs for the same PR; main pushes remain independent. It checks backend build + tests on Node 24 and MySQL 8.0, a Playwright browser checkout flow against a production frontend build, frontend tests, lint and a separate embedded-API build. Browser fixtures use only a loopback API and an isolated MySQL database. `scripts/ci/services.sh` starts throwaway MySQL 8.0 / Redis 7 with bounded ECR → Docker Hub pulls, loopback-only random ports and readiness checks; CI always removes those containers and their volumes. Workflows run with read-only `contents` permission and actions pinned to commit SHAs; `.github/dependabot.yml` opens weekly update PRs (grouped minor/patch per directory, majors one by one, never TypeScript or Elasticsearch-client majors, `@types/node` stays on the Node 24 runtime major, and ESLint stays on 9 until eslint-config-next's plugins accept 10).

## Conventions

- Validate request input with Joi or the existing `normalize*` helpers; reject unknown fields and answer 400, never 500, for bad input.
- Domain errors use the existing classes (`OrderError`, `SKUError`, `AddressError`, ...) whose `statusCode` defaults to 400; controllers map them with `res.status(error.statusCode)`.
- Money is handled in integer cents (`couponMoneyToCents`, `calculateDiscountCents`); order, stock and coupon changes happen in one MySQL transaction with row locks taken in a fixed order (user → address → products → SKUs → coupons).
- Adding, removing or renaming a route means updating the API lists in both `README.md` and `README_ZH.md` in the same PR; `__tests__/docs/readme-routes.test.ts` fails otherwise.
- User-facing API messages are Chinese. Every new message the UI can show needs an English entry in `frontend/src/lib/error-translations.ts`.
- Critical admin product, SKU, coupon and user-status writes save their audit on the same transaction connection. `afterProductWrite` only refreshes cache/search after commit; login logging remains best effort.
- Server code logs through `utils/logger` (pino); `console` is only for the CLI output of `src/database` scripts. Inside a request every line gets `requestId` from `utils/request-context.ts`, matching the `X-Request-Id` response header.
- CodeQL (`.github/workflows/codeql.yml`, `security-extended`) scans TypeScript and workflows on PRs, `main` and weekly: fix new alerts, or dismiss one in GitHub only with a written reason.
- Route params are always strings; follow the existing `req.params.id as string` / `positiveId()` idiom.
- Tests live in `backend/src/__tests__` and `frontend/tests`. Write the failing test first for bug fixes, and keep MySQL/Redis integration tests self-contained (own database name, skip without env vars).

## Pitfalls already paid for

- `src/load-env.ts` must stay the first import of `app.ts`, `index.ts` and `serverless.ts`: modules read env vars at load time. Read `JWT_SECRET` only through `jwtSecret()` (`utils/jwt-secret.ts`), shared by customer and admin tokens.
- Express 5 leaves `req.body` undefined without a parsed body; `app.ts` defaults it to `{}` so Joi does not pass `undefined` through. `req.query` is read-only.
- Account deletion (`services/account-deletion.service.ts`) anonymizes the `users` row in place (`deleted_at`) and keeps orders, after-sales and used coupons as transaction records; usernames starting `deleted_` and emails at `@deleted.invalid` are reserved. A new table that holds a customer's personal data must be added to its `PERSONAL_TABLES` and to the export in `services/personal-data.service.ts`.
- Sentry is optional (`SENTRY_DSN`) and reports only through `utils/error-reporting.ts`: the logger hook (error/fatal, sanitized by `log-safety`) and uncaught exceptions (`scrubEvent`). Keep `dataCollection` off and the integration allow-list narrow; never send request data, users or local variables. In the browser, `frontend/src/lib/error-reporting.ts` loads `lib/sentry-browser.ts` on demand (never import it statically); `scrubBrowserEvent` rebuilds each event from an allowlist, and the backend `request_id` tag is its only addition.
- RabbitMQ and Elasticsearch are optional: without `RABBITMQ_URL` timed-out orders are cancelled by the 5-minute poller (or `POST /api/internal/order-timeouts` with `CRON_SECRET`), and without `ELASTICSEARCH_URL` search uses MySQL. `/health` returns 503 only for MySQL or Redis.
- The Elasticsearch client is 9.x and only talks to Elasticsearch 9 servers. ES only decides matches and order; price, stock and status always come from MySQL. Product/SKU writes call `syncProductsToSearchIndex` through `afterProductWrite`.
- ioredis 6 is pinned to `protocol: 2` (Upstash compatibility). express-rate-limit 8 keys IPv4-mapped addresses as plain IPv4.
- Admin sessions carry `admins.auth_version`; logout bumps it. Failed logout retains a purpose-only `admin_logout_retry` httpOnly cookie at `/api/admin` for 24 hours, without extending it on retries; login settles pending exact-version revocations before issuing a new session. Keep this retention at least as long as the maximum admin token lifetime. Customer password changes bump `users.auth_version`.
- Both Dockerfiles are multi-stage, run as the non-root `node` user over a read-only `/app`, and start `node` directly as PID 1 so SIGTERM reaches the graceful shutdown. The backend image holds only `dist` and production dependencies: run `node dist/...` / `npm run migrate` in it, never `npm run build`.
- TypeScript stays on 5.9: TypeScript 7 drops the compiler API that ts-jest and ts-node need.
- `validateEnv()` (`utils/validate-env.ts`) checks the format of every configured variable at startup: production refuses to start on a bad value, development warns. A new variable goes into `ENV_FORMAT` there and into `backend/.env.example`.
- Never read or print `.env` files; use the `.env.example` files for variable names.

## Workflow

1. Work on a branch, never on `main`; keep one concern per PR.
2. Run `/verify` before committing, and `/integration` when SQL, transactions, Redis, migrations or startup code change.
3. Open the PR with `/pr` (`gh pr create`). Merge only with `./scripts/dev/merge-pr.sh <number>`: it refuses unless the PR is open, mergeable and every CI check (including both CI jobs) has passed, then merges with a merge commit pinned to the checked head. Direct `gh pr merge`, `gh api`, force-pushes and pushes to `main` are denied in `.claude/settings.json`. If checks are still running, report that and check again later; never merge around a failing check.
4. After a merge: GitHub deletes the remote branch automatically; delete the local branch and fast-forward local `main`.
