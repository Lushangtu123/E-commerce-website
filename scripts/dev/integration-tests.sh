#!/bin/bash
# Run the backend Jest suite, including the MySQL and Redis integration tests, against
# throwaway MySQL 8.0 (the CI version) and Redis 7 containers bound to random loopback ports.
# The containers are removed on exit, even when the tests fail. Extra arguments go to Jest.
set -euo pipefail

cd "$(dirname "$0")/../../backend"
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and try again." >&2
  exit 1
fi

suffix="$$-$(date +%s)"
mysql_name="ecommerce-it-mysql-$suffix"
redis_name="ecommerce-it-redis-$suffix"
password="it-$(openssl rand -hex 12)"
cleanup() { docker rm -f "$mysql_name" "$redis_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$mysql_name" -p 127.0.0.1::3306 -e MYSQL_ROOT_PASSWORD="$password" mysql:8.0 >/dev/null
docker run -d --name "$redis_name" -p 127.0.0.1::6379 redis:7-alpine >/dev/null
mysql_port=$(docker port "$mysql_name" 3306/tcp | head -1 | sed 's/.*://')
redis_port=$(docker port "$redis_name" 6379/tcp | head -1 | sed 's/.*://')

echo "Waiting for MySQL on 127.0.0.1:$mysql_port..."
# Check over TCP: the image first runs a socket-only init server, then restarts.
mysql_ready() { docker exec "$mysql_name" mysql -h127.0.0.1 -uroot -p"$password" -e 'SELECT 1' >/dev/null 2>&1; }
for _ in $(seq 1 60); do
  if mysql_ready; then break; fi
  sleep 2
done
mysql_ready || { echo "MySQL did not start" >&2; exit 1; }

MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_PORT="$mysql_port" MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD="$password" \
REDIS_TEST_URL="redis://127.0.0.1:$redis_port" \
  npx jest "$@"
