---
description: Run the full backend suite, including MySQL and Redis integration tests, against throwaway Docker containers
argument-hint: "[jest arguments, e.g. a test path]"
---

Run `./scripts/dev/integration-tests.sh $ARGUMENTS` from the repository root.

The script starts MySQL 8.0 (the CI version) and Redis 7 on random 127.0.0.1 ports, runs `npx jest` in `backend/` with `MYSQL_TEST_*` and `REDIS_TEST_URL` set, and removes the containers afterwards. It needs Docker running and `npm ci` already done in `backend/`; if Docker is not running, tell the user instead of starting it.

Report the exact `Tests:` and `Test Suites:` lines. With both services available nothing should be skipped; name any skipped or failing suite and its first error. Afterwards confirm with `docker ps -a --filter name=ecommerce-it-` that no test container was left behind.
