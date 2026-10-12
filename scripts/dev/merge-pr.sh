#!/bin/bash
# Merge a pull request into main with a merge commit, but only when it is safe to:
# open, not a draft, targeting main, mergeable, both CI jobs present, and every check
# finished successfully. The merge is pinned to the head commit that was checked, so a
# push that lands in between makes it fail instead of merging untested code.
# Usage: scripts/dev/merge-pr.sh <number> [--check]   (--check: report only, never merge)
set -euo pipefail

pr="${1:-}"
mode="${2:-}"
if [[ ! "$pr" =~ ^[1-9][0-9]*$ ]] || [[ -n "$mode" && "$mode" != "--check" ]]; then
  echo "Usage: $0 <pull request number> [--check]" >&2
  exit 2
fi

# The CI jobs from .github/workflows/ci.yml that must have run and passed.
required_checks='["后端：编译 + 测试","前端：构建"]'

json=$(gh pr view "$pr" --json state,isDraft,mergeable,baseRefName,headRefOid,url,statusCheckRollup)
head=$(REQUIRED="$required_checks" node -e '
const pr = JSON.parse(require("fs").readFileSync(0, "utf8"));
const required = JSON.parse(process.env.REQUIRED);
const problems = [];
if (pr.state !== "OPEN") problems.push(`state is ${pr.state}`);
if (pr.isDraft) problems.push("pull request is a draft");
if (pr.baseRefName !== "main") problems.push(`base is ${pr.baseRefName}, not main`);
if (pr.mergeable !== "MERGEABLE") problems.push(`mergeable is ${pr.mergeable}`);
const checks = pr.statusCheckRollup.map(c => c.__typename === "CheckRun"
  ? { name: c.name, done: c.status === "COMPLETED", ok: ["SUCCESS", "SKIPPED", "NEUTRAL"].includes(c.conclusion), result: c.conclusion || c.status }
  : { name: c.context, done: c.state !== "PENDING" && c.state !== "EXPECTED", ok: c.state === "SUCCESS", result: c.state });
for (const name of required) if (!checks.some(c => c.name === name)) problems.push(`required check "${name}" has not run`);
for (const c of checks) {
  if (!c.done) problems.push(`check "${c.name}" is still ${c.result}`);
  else if (!c.ok) problems.push(`check "${c.name}" ${c.result}`);
}
for (const c of checks) console.error(`  ${c.ok && c.done ? "ok  " : "FAIL"} ${c.name}: ${c.result}`);
if (problems.length) { console.error(`Not merging ${pr.url}:\n  - ${problems.join("\n  - ")}`); process.exit(1); }
console.log(pr.headRefOid);
' <<<"$json")

if [[ "$mode" == "--check" ]]; then
  echo "PR #$pr is ready to merge at ${head:0:7} (check only, not merged)."
  exit 0
fi
gh pr merge "$pr" --merge --match-head-commit "$head"
echo "Merged PR #$pr at ${head:0:7} with a merge commit."
