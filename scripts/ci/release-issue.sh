#!/usr/bin/env bash
# Opens a release-failed issue saying which release step failed and what production is running now.
# Env: step outcomes (MIGRATE, DEPLOY, SMOKE, PROMOTE, VERIFY, ROLLBACK), DEPLOY_URL, COMMIT, GH_TOKEN, GITHUB_* run context.
set -euo pipefail
label=release-failed
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
if [ "${VERIFY:-}" = failure ]; then
  if [ "${ROLLBACK:-}" = success ]; then state='新版本切换后生产验证失败，**已自动回滚**到上一个生产部署。'
  else state='新版本切换后生产验证失败，**自动回滚也失败**：请立即在 Vercel → Deployments 对上一个正常部署点 Promote to Production。'; fi
elif [ "${PROMOTE:-}" = failure ]; then state='新版本通过冒烟测试，但切换生产域名失败；生产仍是上一个版本（请在 Vercel 确认）。'
elif [ "${SMOKE:-}" = failure ]; then state="新版本没有通过冒烟测试，未切换域名；生产保持原版本。新部署：${DEPLOY_URL:-未知}"
elif [ "${DEPLOY:-}" = failure ]; then state='Vercel 部署失败，未切换域名；生产保持原版本。'
elif [ "${MIGRATE:-}" = failure ]; then state='数据库迁移或结构检查失败，未部署；生产保持原版本（迁移均向后兼容）。'
else state='发布在准备阶段失败（拉取代码或编译），未改动数据库和生产。'; fi
reports=$(cat smoke-report.md verify-report.md 2>/dev/null || true)
gh label create "$label" --color D93F0B --description '生产发布失败（自动）' >/dev/null 2>&1 || true
gh issue create --label "$label" --title "生产发布失败：${COMMIT:0:7}" --body "$(printf '%s\n\n提交：%s\n运行记录：%s\n\n%s\n\n处理步骤见 docs/RELEASE.md。' "$state" "$COMMIT" "$run_url" "$reports")"
