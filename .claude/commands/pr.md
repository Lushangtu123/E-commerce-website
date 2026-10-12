---
description: Commit the current change on a branch, push it, and produce a prefilled pull request link
argument-hint: "[pull request title]"
---

Prepare a pull request for the current change. Title: $ARGUMENTS (if empty, derive a conventional-commit title from the diff).

1. Inspect `git status`, `git diff` and `git log --oneline -5`. If on `main`, create a branch named `<type>/<short-topic>` first. Do not include unrelated changes; ask if the working tree mixes concerns.
2. Run `/verify`. Stop and report if any check fails.
3. Commit with a conventional message (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) whose body explains why, ending with the attribution trailer the session specifies.
4. `git push -u origin <branch>`. Never force-push and never push to `main`.
5. Create the PR with `gh pr create --base main --head <branch> --title "<title>" --body-file <file>`. The body has "## What changed", "## Verification" (exact commands and counts from step 2) and any rollout notes (migrations, env vars, Docker volumes). Report the PR URL.
6. Check CI with `./scripts/dev/merge-pr.sh <number> --check`. When it reports ready, merge with `./scripts/dev/merge-pr.sh <number>`. If checks are still running, tell the user and check again later; if one failed, report it and stop instead of merging.

Never merge any other way: direct `gh pr merge` and `gh api` are denied, and auto-merge is not used. After the merge GitHub deletes the remote branch automatically; delete the local branch and fast-forward local `main`.
