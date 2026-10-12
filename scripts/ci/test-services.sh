#!/usr/bin/env bash
# Behavioral contract for CI service recovery; no daemon, registry or credentials.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
mkdir -p "$task_tmp/bin"
cat > "$task_tmp/bin/timeout" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_TIMEOUT_LOG"
if [[ "$1" == -k ]]; then shift 2; fi
shift
exec "$@"
FAKE
cat > "$task_tmp/bin/sleep" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
cat > "$task_tmp/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_DOCKER_LOG"
case "$1" in
  info|logs|rm) exit 0 ;;
  pull)
    case "$TEST_SCENARIO" in
      fallback) [[ "$2" != public.ecr.aws/* ]] ;;
      pull-failure) exit 1 ;;
      *) exit 0 ;;
    esac ;;
  run)
    [[ "$TEST_SCENARIO" != run-failure || "$*" != *redis* ]] || exit 1
    printf 'fake-container\n' ;;
  port)
    if [[ "$2" == *mysql* ]]; then printf '127.0.0.1:43106\n'; else printf '127.0.0.1:46379\n'; fi ;;
  exec)
    [[ "$TEST_SCENARIO" != health-failure ]] || exit 1
    if [[ "$*" == *redis-cli* ]]; then
      [[ "$TEST_SCENARIO" != wrong-pong ]] && printf 'PONG\n' || printf 'LOADING\n'
    else printf '1\n1\n'; fi ;;
  *) printf 'unexpected Docker command: %s\n' "$*" >&2; exit 2 ;;
esac
FAKE
chmod +x "$task_tmp/bin/"*
export PATH="$task_tmp/bin:$PATH" ECOMMERCE_CI_SERVICE_SUFFIX=contract-test
export TEST_TIMEOUT_LOG="$task_tmp/timeout.log"
export TEST_DOCKER_LOG="$task_tmp/docker.log" GITHUB_ENV="$task_tmp/github-env"

run_case() {
  export TEST_SCENARIO="$1"
  : > "$TEST_DOCKER_LOG"
  : > "$TEST_TIMEOUT_LOG"
  : > "$GITHUB_ENV"
  if bash "$root/scripts/ci/services.sh" start > "$task_tmp/output" 2>&1; then
    [[ "$2" == success ]] || { cat "$task_tmp/output"; exit 1; }
  else
    [[ "$2" == failure ]] || { cat "$task_tmp/output"; exit 1; }
  fi
}
assert_log() { grep -F -- "$1" "$TEST_DOCKER_LOG" > /dev/null; }
assert_no_log() { if assert_log "$1"; then printf 'unexpected command: %s\n' "$1" >&2; exit 1; fi; }
assert_cleaned() { assert_log 'rm -fv ecommerce-ci-mysql-contract-test ecommerce-ci-redis-contract-test'; }
assert_no_export() { [[ ! -s "$GITHUB_ENV" ]]; }

run_case primary success
assert_log 'pull public.ecr.aws/docker/library/mysql:8.0'
assert_log 'pull public.ecr.aws/docker/library/redis:7-alpine'
assert_no_log 'pull docker.io/'
assert_log '-p 127.0.0.1::3306'
assert_log '-p 127.0.0.1::6379'
assert_log 'mysql --protocol=TCP -h127.0.0.1 -uroot -e SELECT 1'
assert_log 'redis-cli ping'
grep -F -- '-k 5 120 docker pull' "$TEST_TIMEOUT_LOG" > /dev/null
grep -F -- '-k 5 30 docker run' "$TEST_TIMEOUT_LOG" > /dev/null
grep -F -- '-k 2 5 docker exec' "$TEST_TIMEOUT_LOG" > /dev/null
grep -Fx 'MYSQL_TEST_PORT=43106' "$GITHUB_ENV" > /dev/null
grep -Fx 'REDIS_TEST_URL=redis://127.0.0.1:46379' "$GITHUB_ENV" > /dev/null
assert_no_log 'rm -fv'
bash "$root/scripts/ci/services.sh" stop
assert_cleaned
printf 'PASS primary registry, health gates, loopback ports, export, explicit cleanup\n'

run_case fallback success
assert_log 'pull docker.io/library/mysql:8.0'
assert_log 'pull docker.io/library/redis:7-alpine'
assert_log 'docker.io/library/mysql:8.0'
assert_log 'docker.io/library/redis:7-alpine'
[[ $(grep -c '^pull ' "$TEST_DOCKER_LOG") == 4 ]]
printf 'PASS both ECR failures recover with the same official Docker Hub versions\n'

for scenario in pull-failure run-failure health-failure wrong-pong; do
  run_case "$scenario" failure
  assert_cleaned
  assert_no_export
  printf 'PASS %s fails closed and cleans up\n' "$scenario"
done

: > "$TEST_DOCKER_LOG"
if ECOMMERCE_CI_SERVICE_SUFFIX='../unsafe' bash "$root/scripts/ci/services.sh" stop > /dev/null 2>&1; then exit 1; fi
[[ ! -s "$TEST_DOCKER_LOG" ]]
printf 'PASS invalid cleanup scope rejected before Docker access\n'
