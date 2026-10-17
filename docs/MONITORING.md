# 监控与告警

适用于 Vercel + Aiven MySQL + Upstash Redis 的云端部署。目标是：站点不可用或错误突增时，你在十几分钟内收到通知，并知道从哪里查起。

## 监控一览

| 内容 | 方式 | 频率 | 告警送达 |
|------|------|------|----------|
| 站点可用性：`/api/health`（MySQL、Redis）、首页、商品接口 | GitHub Actions「线上巡检」（`.github/workflows/uptime.yml`，脚本 `scripts/ci/uptime-check.mjs`） | 每 10 分钟（GitHub 可能延迟几分钟），也可在 Actions 页面手动运行 | 自动开启带 `uptime-alert` 标签的 Issue；持续失败每小时最多追加一条评论；恢复后自动评论并关闭 |
| 后端错误（error / fatal 日志、未捕获异常） | Sentry（`SENTRY_DSN`） | 实时 | 按下文在 Sentry 开启告警规则 |
| 浏览器错误 | Sentry 浏览器项目（`NEXT_PUBLIC_SENTRY_DSN`） | 实时 | 同上 |
| 代码安全 | CodeQL（`.github/workflows/codeql.yml`） | 每个 PR、main、每周 | GitHub Security 页面 |
| 依赖更新 | Dependabot | 每周 | 自动开 PR |

每项巡检失败前会重试 3 次（间隔 15 秒），单次冷启动变慢不会触发告警；超过 3 秒的成功请求在报告里标为“偏慢”。巡检只发只读 GET 请求，不登录、不写数据。

## 让告警真正送到你

1. **GitHub 通知**：GitHub → Settings → Notifications，确认对自己“Watching”的仓库开启了 Email 通知（Issues 默认包含在内）。可选：在手机上安装 GitHub App 并开启推送。
2. **定时工作流失败邮件**：GitHub 会把定时工作流的失败通知发给最后修改该定时配置的人；本仓库合并这个工作流后即为你。
3. **生产地址**：巡检默认检查 `https://e-commerce-website-blush-rho.vercel.app`。更换域名时，在 GitHub → Settings → Secrets and variables → Actions → Variables 新建 `PRODUCTION_URL`（只填源，例如 `https://shop.example.com`）。
4. **保持启用**：公开仓库 60 天没有提交时，GitHub 会自动停用定时工作流。届时在 Actions → 线上巡检 中点击 Enable workflow。

## Sentry 告警规则（在 Sentry 网站上开启）

后端项目和浏览器项目各配置一遍，Environment 选 `production`（后端来自 `SENTRY_ENVIRONMENT`，浏览器来自 Vercel 的 `VERCEL_ENV`）：

| 规则 | Sentry 中的设置 | 动作 |
|------|-----------------|------|
| 新错误 | Alerts → Create Alert → Issues → “A new issue is created” | 发邮件给你 |
| 已修复的错误再次出现 | “The issue changes state from resolved to unresolved” | 发邮件给你 |
| 错误突增 | “The issue is seen more than 50 times in 1 hour” | 发邮件给你 |

上报内容已脱敏（不含请求体、Cookie、用户信息），每条后端错误都带 `request_id`，与响应头 `X-Request-Id` 一致，可据此在 Vercel 日志中查到同一个请求。

## 收到告警后

1. 打开 Issue 里的“运行记录”，看是哪一项失败、HTTP 状态和耗时。
2. 打开生产的 `/api/health`：
   - `mysql: down`：查看 Aiven 控制台的服务状态和连接数；
   - `redis: down`：查看 Upstash 控制台的状态和配额；
   - 健康检查正常但首页或商品接口失败：多半是代码或部署问题。
3. Vercel → Deployments：如果故障从最近一次部署开始，对上一个正常部署点 **Promote to Production**（即时回滚），再排查。
4. Vercel → Logs 或 Sentry：按时间、`request_id` 查看错误详情。
5. 修复后无需手动关闭 Issue：下一次巡检通过时会自动评论“已恢复”并关闭。重大故障在 Issue 里补一段时间线和原因。

## 尚未覆盖

- 电话、短信或值班轮换（需要 Better Stack、PagerDuty 等外部服务）；
- 长期日志检索与保存（Vercel 日志保留期短，日志外送需要 Vercel Pro）；
- 支付、下单等需要登录的业务流程的线上巡检（浏览器端到端测试只在 CI 中对隔离环境运行）。
