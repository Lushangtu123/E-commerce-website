#!/bin/bash
# Backup and restore drill: take a consistent logical backup (mysqldump --single-transaction) of the
# configured database, restore it into a throwaway local MySQL 8.0 container, then compare every table's
# row count with the source and run the backend's schema checks against the restored copy.
#
# Connection settings come only from the environment (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME and,
# for TLS, DB_SSL_CA_BASE64), exactly as the backend reads them; no .env file is read and no credential is
# printed. The dump holds personal data: it lives in a private temporary directory and is deleted on exit,
# together with the container. The source database is only read.
#
# Usage: DB_HOST=... DB_PORT=... DB_USER=... DB_PASSWORD=... DB_NAME=... [DB_SSL_CA_BASE64=...] \
#          ./scripts/dev/backup-restore-drill.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
for name in DB_HOST DB_USER DB_PASSWORD DB_NAME; do
  if [ -z "${!name:-}" ]; then echo "Set $name in the environment (see backend/.env.example)." >&2; exit 2; fi
done
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and try again." >&2
  exit 1
fi

port="${DB_PORT:-3306}"
# A database on this machine is reached from the dump container through Docker Desktop's host alias.
host="$DB_HOST"
case "$host" in localhost|127.0.0.1|::1) host=host.docker.internal ;; esac

workdir=$(mktemp -d)
chmod 700 "$workdir"
restore_name="ecommerce-drill-$$-$(date +%s)"
restore_password="drill-$(openssl rand -hex 12)"
cleanup() {
  local status=$?
  docker rm -fv "$restore_name" >/dev/null 2>&1 || true
  rm -rf "$workdir"
  # Keep the failure status: the macOS bash 3.2 would otherwise report the trap's last command.
  exit "$status"
}
trap cleanup EXIT

ssl_args=()
if [ -n "${DB_SSL_CA_BASE64:-}" ]; then
  printf '%s' "$DB_SSL_CA_BASE64" | base64 -d > "$workdir/ca.pem"
  ssl_args=(--ssl-ca=/work/ca.pem --ssl-mode=VERIFY_IDENTITY)
fi

# Runs a MySQL 8.0 client tool against the source; the password travels only as MYSQL_PWD.
source_client() {
  docker run --rm -i -e MYSQL_PWD="$DB_PASSWORD" -v "$workdir:/work" mysql:8.0 \
    "$1" -h "$host" -P "$port" -u "$DB_USER" ${ssl_args[@]+"${ssl_args[@]}"} "${@:2}"
}

echo "1/4 Dumping $DB_NAME (consistent snapshot, read only)..."
started=$(date +%s)
source_client mysqldump --single-transaction --routines --triggers --set-gtid-purged=OFF \
  --no-tablespaces --column-statistics=0 --hex-blob "$DB_NAME" > "$workdir/dump.sql"
dump_seconds=$(( $(date +%s) - started ))
dump_bytes=$(wc -c < "$workdir/dump.sql" | tr -d ' ')
echo "    $dump_bytes bytes in ${dump_seconds}s"

echo "2/4 Starting a throwaway MySQL 8.0..."
docker run -d --name "$restore_name" -p 127.0.0.1::3306 -e MYSQL_ROOT_PASSWORD="$restore_password" \
  -e MYSQL_DATABASE=restored mysql:8.0 >/dev/null
restore_port=$(docker port "$restore_name" 3306/tcp | head -1 | sed 's/.*://')
restored() { docker exec -i -e MYSQL_PWD="$restore_password" "$restore_name" mysql -h127.0.0.1 -uroot "$@"; }
for _ in $(seq 1 60); do
  if restored -e 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 2
done
restored -e 'SELECT 1' >/dev/null

echo "3/4 Restoring..."
started=$(date +%s)
restored restored < "$workdir/dump.sql"
echo "    restored in $(( $(date +%s) - started ))s"

echo "4/4 Comparing row counts with the source..."
tables=$(source_client mysql -N -B -e "SELECT table_name FROM information_schema.tables WHERE table_schema = '$DB_NAME' AND table_type = 'BASE TABLE' ORDER BY table_name")
missing=0 changed=0
printf '    %-32s %12s %12s\n' table source restored
for table in $tables; do
  source_rows=$(source_client mysql -N -B -e "SELECT COUNT(*) FROM \`$DB_NAME\`.\`$table\`")
  restored_rows=$(restored -N -B -e "SELECT COUNT(*) FROM restored.\`$table\`" 2>/dev/null || echo missing)
  mark=""
  if [ "$restored_rows" = missing ]; then mark="  MISSING"; missing=$((missing + 1))
  elif [ "$restored_rows" != "$source_rows" ]; then mark="  changed since the dump?"; changed=$((changed + 1)); fi
  printf '    %-32s %12s %12s%s\n' "$table" "$source_rows" "$restored_rows" "$mark"
done

if [ -f backend/dist/database/check-account-schema.js ]; then
  # These report the schema the backup carries (the source's state); they do not decide the drill.
  echo "    Backend schema checks against the restored copy:"
  for check in check-account-schema check-checkout-schema; do
    (DB_HOST=127.0.0.1 DB_PORT="$restore_port" DB_USER=root DB_PASSWORD="$restore_password" DB_NAME=restored \
      DB_SSL=false LOG_LEVEL=silent node "backend/dist/database/$check.js" || true) | sed 's/^/      /'
  done
else
  echo "    (Build the backend first to also run its schema checks: npm --prefix backend run build)"
fi

if [ "$missing" -gt 0 ]; then
  echo "Drill FAILED: $missing table(s) missing after restore." >&2
  exit 1
fi
summary="Drill passed: $(echo "$tables" | wc -w | tr -d ' ') tables restored"
if [ "$changed" -gt 0 ]; then summary="$summary; $changed differ, most likely live writes after the snapshot"; fi
echo "$summary."
