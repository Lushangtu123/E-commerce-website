# 自动化发布

生产不再由 Vercel 在推送 main 时自动部署（`frontend/vercel.json` 关闭了 main 的 Git 部署），而是由 GitHub Actions「发布」工作流（`.github/workflows/release.yml`）按固定顺序完成：

```
PR 合并到 main → CI 全部通过
  → 迁移生产库 → 结构检查（check-account-schema、check-checkout-schema 均为 ready）
  → Vercel 部署新版本，但先不切换生产域名
  → 冒烟测试新部署（健康接口、首页、商品接口）
  → 切换生产域名（promote）
  → 验证生产域名；失败则自动回滚到上一个生产部署
任一步失败：开启 release-failed Issue，写明停在哪一步、生产当前是哪个版本
```

Pull request 仍由 Vercel 自动构建预览；同时「发布」工作流用 PR 的代码迁移**预览库**（来自 fork 和 Dependabot 的 PR 拿不到密钥，会跳过；`preview` 环境尚未配置时只给出警告并跳过）。生产缺少配置时则直接失败并开启 Issue，不会悄悄停止发布。

## 一次性设置（合并本流水线之前完成）

### 1. Vercel

1. Account Settings → Tokens：新建一个只用于本项目的令牌（Scope 选项目所在团队，设置过期时间），记为 `VERCEL_TOKEN`。
2. 在本地仓库根目录运行 `npx vercel link`，打开生成的 `.vercel/project.json`，其中 `orgId`、`projectId` 分别记为 `VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`（`.vercel/` 不要提交）。
3. Project → Settings → Deployment Protection → **Protection Bypass for Automation**：生成密钥，记为 `VERCEL_AUTOMATION_BYPASS_SECRET`，让冒烟测试能访问受保护的部署地址。

### 2. GitHub Environments

GitHub → Settings → Environments，新建两个环境并添加 Secrets：

| 环境 | Secrets |
|------|---------|
| `production` | `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`（`defaultdb`）、`DB_SSL_CA_BASE64`、`VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`、`VERCEL_AUTOMATION_BYPASS_SECRET` |
| `preview` | `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`（`ecommerce_preview`）、`DB_SSL_CA_BASE64` |

建议在 `production` 环境：
- Deployment branches 选 **Selected branches** 并只允许 `main`；
- 可选开启 **Required reviewers**（选你自己）：每次发布前需要在 Actions 页面点一次批准。

数据库连接值与 Vercel 中对应环境一致；如果 Aiven 开启了 IP 白名单，需要允许 GitHub Actions 访问（或暂时保持对所有来源开放、只靠强密码与 TLS）。

### 3. 首次验证

合并后，在 Actions → 发布 → Run workflow（main）手动运行一次，确认各步骤通过、生产域名指向新部署。

## 日常使用

- 正常合并即可，不再需要手动运行迁移。合并后约 15–20 分钟（CI 加发布）新版本上线。
- 重新发布当前 main：Actions → 发布 → Run workflow。
- 发布失败：查看自动开启的 `release-failed` Issue 和运行记录。冒烟测试未通过时生产不受影响；生产验证失败会自动回滚。
- 手动回滚：Vercel → Deployments，对上一个正常部署点 **Promote to Production**（或 `npx vercel rollback`）。

## 迁移规则

迁移在部署新代码**之前**运行，且不会随回滚撤销，因此每个迁移都必须向后兼容，让正在运行的旧版本继续工作：

- 只做“扩展”：新增表、可空列或有默认值的列、索引；
- 删除或重命名列分两次发布：先发布不再读写旧列的代码，下一次发布再删除；
- 迁移幂等，并在 `database/migrate.ts` 的 `runMigrations` 中、迁移锁内执行（见 CLAUDE.md）。

## 紧急情况

GitHub Actions 不可用时，可以在本地按旧方式发布：在终端临时设置生产库连接后运行 `node backend/dist/database/migrate.js` 和结构检查，再在仓库根目录运行 `npx vercel deploy --prod`。
