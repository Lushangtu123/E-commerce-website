#!/usr/bin/env bash
# Throwaway MySQL/Redis for one CI run; official registries, loopback ports only.
set -euo pipefail
suffix=${ECOMMERCE_CI_SERVICE_SUFFIX:-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}}
[[ "$suffix" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid CI service suffix' >&2; exit 2; }
mysql_name="ecommerce-ci-mysql-$suffix"
redis_name="ecommerce-ci-redis-$suffix"
cleanup() { timeout -k 2 15 docker rm -fv "$mysql_name" "$redis_name" >/dev/null 2>&1 || true; }
if [[ ${1:-} == stop ]]; then cleanup; exit 0; fi
[[ ${1:-} == start && -n ${GITHUB_ENV:-} ]] || { echo 'Usage: services.sh start|stop (start requires GITHUB_ENV)' >&2; exit 2; }
trap 'result=$?; if (( result != 0 )); then cleanup; fi' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

timeout -k 2 15 docker info >/dev/null
pull_image() {
  local image
  for image in "public.ecr.aws/docker/library/$1" "docker.io/library/$1"; do
    echo "Pulling CI image $image" >&2
    if timeout -k 5 120 docker pull "$image" >&2; then printf '%s\n' "$image"; return; fi
    echo "Registry unavailable for $image; trying remaining official registry." >&2
  done
  echo "Unable to pull either official registry image for $1" >&2
  return 1
}
mysql_image=$(pull_image mysql:8.0)
redis_image=$(pull_image redis:7-alpine)
password=${MYSQL_TEST_PASSWORD:-order_test_password}
timeout -k 5 30 docker run -d --name "$mysql_name" -p 127.0.0.1::3306 \
  -e "MYSQL_ROOT_PASSWORD=$password" -e 'MYSQL_ROOT_HOST=%' "$mysql_image" >/dev/null
timeout -k 5 30 docker run -d --name "$redis_name" -p 127.0.0.1::6379 "$redis_image" >/dev/null

wait_ready() {
  local service=$1 attempt reply
  for attempt in {1..60}; do
    if [[ "$service" == mysql ]]; then
      if timeout -k 2 5 docker exec -e "MYSQL_PWD=$password" "$mysql_name" \
          mysql --protocol=TCP -h127.0.0.1 -uroot -e 'SELECT 1' >/dev/null 2>&1; then return; fi
    else
      if reply=$(timeout -k 2 5 docker exec "$redis_name" redis-cli ping 2>/dev/null) && [[ "$reply" == PONG ]]; then return; fi
    fi
    sleep 2
  done
  echo "CI $service did not become ready within the bounded startup window." >&2
  return 1
}
wait_ready mysql
wait_ready redis
port_for() {
  local binding
  binding=$(timeout -k 2 10 docker port "$1" "$2")
  [[ "$binding" =~ ^127\.0\.0\.1:([0-9]+)$ ]] || { echo 'Invalid loopback service binding' >&2; return 1; }
  local port=${BASH_REMATCH[1]}
  (( port > 0 && port <= 65535 )) || return 1
  printf '%s\n' "$port"
}
mysql_port=$(port_for "$mysql_name" 3306/tcp)
redis_port=$(port_for "$redis_name" 6379/tcp)
printf 'MYSQL_TEST_PORT=%s\nREDIS_TEST_URL=redis://127.0.0.1:%s\n' "$mysql_port" "$redis_port" >> "$GITHUB_ENV"
echo 'CI MySQL and Redis are ready on loopback.'
