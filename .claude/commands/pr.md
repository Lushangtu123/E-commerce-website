---
description: Commit the current change on a branch, push it, and produce a prefilled pull request link
argument-hint: "[pull request title]"
---

Prepare a pull request for the current change. Title: $ARGUMENTS (if empty, derive a conventional-commit title from the diff).

1. Inspect `git status`, `git diff` and `git log --oneline -5`. If on `main`, create a branch named `<type>/<short-topic>` first. Do not include unrelated changes; ask if the working tree mixes concerns.
2. Run `/verify`. Stop and report if any check fails.
3. Commit with a conventional message (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`) whose body explains why, ending with the attribution trailer the session specifies.
4. `git push -u origin <branch>`. Never force-push and never push to `main`.
5. Build the compare URL with Node so the title and body are URL-encoded:
   `node -e 'console.log("https://github.com/Lushangtu123/E-commerce-website/compare/main...<branch>?" + new URLSearchParams({ expand: "1", title, body }))'`
   The body has "## What changed", "## Verification" (exact commands and counts from step 2) and any rollout notes (migrations, env vars, Docker volumes).
6. Give the user the link. If a browser tool is connected and the user asked for it, open the link and click "Create pull request", waiting until GitHub finishes "Checking mergeability" first.

Merging is the user's job after CI passes; do not merge or enable auto-merge. When the user reports the merge: confirm it via the GitHub API, delete the branch on GitHub and locally, and fast-forward local `main`.
