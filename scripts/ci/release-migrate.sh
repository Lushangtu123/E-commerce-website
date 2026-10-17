#!/usr/bin/env bash
# Release step: migrate the target database, then refuse to continue unless both schema checks report
# `ready`. Every migration is idempotent and backward compatible, so the running version keeps working.
# Connection settings come only from the environment (GitHub environment secrets); nothing is printed.
set -euo pipefail
for name in DB_HOST DB_USER DB_PASSWORD DB_NAME; do
  if [ -z "${!name:-}" ]; then echo "::error::缺少环境密钥 $name（GitHub → Settings → Environments）"; exit 1; fi
done
cd "$(dirname "$0")/../../backend"
node dist/database/migrate.js
node dist/database/admin-migrate.js
node dist/database/check-account-schema.js
node dist/database/check-checkout-schema.js
