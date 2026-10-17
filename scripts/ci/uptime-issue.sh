#!/usr/bin/env bash
# Turns an uptime run into a GitHub issue: opens one on the first failure, adds at most one comment
# per hour while it keeps failing, and closes it with a note once the site recovers.
# Env: OUTCOME (success|failure), REPORT_FILE, GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_RUN_ID.
set -euo pipefail
label=uptime-alert
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
report=$(cat "$REPORT_FILE" 2>/dev/null || echo '（巡检没有生成报告，请查看运行记录）')
body=$(printf '%s\n\n运行记录：%s\n' "$report" "$run_url")

gh label create "$label" --color B60205 --description '生产巡检告警（自动开关）' >/dev/null 2>&1 || true
open=$(gh issue list --label "$label" --state open --limit 1 --json number --jq '.[0].number // empty')

if [ "$OUTCOME" = failure ]; then
  if [ -z "$open" ]; then
    gh issue create --label "$label" --title "生产巡检失败 $(date -u +%Y-%m-%dT%H:%MZ)" \
      --body "$body"$'\n\n处理步骤见 docs/MONITORING.md。站点恢复后，下一次巡检会自动关闭此 Issue。'
    exit 0
  fi
  last=$(gh issue view "$open" --json comments,createdAt --jq '(.comments | last | .createdAt) // .createdAt')
  age=$(node -e 'console.log(Math.floor((Date.now() - Date.parse(process.argv[1])) / 1000))' "$last")
  if [ "$age" -ge 3600 ]; then
    gh issue comment "$open" --body "仍未恢复。"$'\n\n'"$body"
  fi
elif [ -n "$open" ]; then
  gh issue comment "$open" --body "已恢复。"$'\n\n'"$body"
  gh issue close "$open" --reason completed
fi
