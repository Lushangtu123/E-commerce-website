#!/usr/bin/env bash
# Release step: migrate the target database, then refuse to continue unless both schema checks report
# `ready`. Every migration is idempotent and backward compatible, so the running version keeps working.
# Connection settings come only from the environment (GitHub environment secrets); nothing is printed.
# SKIP_IF_UNCONFIGURED=true (preview only): with no database secrets at all, warn and skip instead of failing.
set -euo pipefail
if [ "${SKIP_IF_UNCONFIGURED:-}" = true ] && [ -z "${DB_HOST:-}${DB_USER:-}${DB_PASSWORD:-}${DB_NAME:-}" ]; then
  echo "::warning::预览库未配置（GitHub → Settings → Environments → preview），跳过迁移；配置方法见 docs/RELEASE.md"
  exit 0
fi
for name in DB_HOST DB_USER DB_PASSWORD DB_NAME; do
  if [ -z "${!name:-}" ]; then echo "::error::缺少环境密钥 $name（GitHub → Settings → Environments）"; exit 1; fi
done
cd "$(dirname "$0")/../../backend"
node dist/database/migrate.js
node dist/database/admin-migrate.js
node dist/database/check-account-schema.js
node dist/database/check-checkout-schema.js
