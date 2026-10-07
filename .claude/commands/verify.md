---
description: Type-check, unit-test and lint the backend and frontend, and report exact results
---

Run the repository's fast checks and report what actually happened. Do not fix anything unless asked.

1. `git status --short` and `git diff --stat` so the report says what was checked.
2. Backend, in `backend/`:
   - `npx tsc --noEmit`
   - `npx jest` (integration suites skip without MySQL/Redis env vars; say so, and suggest `/integration` if SQL, transactions, Redis, migrations or startup code changed)
3. Frontend, in `frontend/`:
   - `npm run typecheck`
   - `npx vitest run`
   - `npm run lint` (warnings are pre-existing; report only errors and any warning in a changed file)
4. Run independent checks in parallel where possible. If `node_modules` is missing in either package, say so and stop for that package rather than installing.

Report a table with each check, the exact pass/fail/skip counts from the output, and the first failing test or error per failed check. Never call a check passing that did not run.
