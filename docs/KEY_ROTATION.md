# 密钥轮换与安全评审

## 何时轮换

| 情况 | 范围 |
|------|------|
| 例行 | 每 90 天轮换 `JWT_SECRET`、`CRON_SECRET`；每 180 天轮换数据库和 Redis 凭据 |
| 有人员离开（能接触 Vercel、Aiven、Upstash 或本仓库密钥的人） | 立即轮换其接触过的全部密钥 |
| 怀疑泄露（日志、截图、仓库、聊天中出现密钥） | 立即轮换对应密钥，并按事故处理 |

每次轮换后在本文末尾“记录”中登记日期和范围。只在 Vercel、Aiven、Upstash 的控制台和本地临时终端中处理密钥，不写进文件、提交或聊天。

## JWT_SECRET（顾客与管理员登录令牌）

后端用 `JWT_SECRET` 签发令牌，校验时先用 `JWT_SECRET`，签名不匹配再用 `JWT_SECRET_PREVIOUS`（`utils/jwt-secret.ts` 的 `verifyJwt`，只接受 HS256）。按以下步骤轮换，已登录的用户不会被迫退出：

1. 生成新密钥：`openssl rand -base64 48`
2. 在 Vercel（Production，Preview 同理）把**旧值**填入 `JWT_SECRET_PREVIOUS`，把**新值**填入 `JWT_SECRET`，类型选 Sensitive，然后重新部署。
3. 新令牌立即用新密钥签发；旧令牌在过渡期内仍可用。
4. **等待最长令牌有效期**：顾客令牌 `JWT_EXPIRES_IN`（默认 7 天），管理员令牌 24 小时，管理员退出重试凭据 24 小时。取最大值，默认 7 天。
5. 删除 `JWT_SECRET_PREVIOUS` 并重新部署。

怀疑泄露时跳过过渡期：直接替换 `JWT_SECRET`、不设置 `JWT_SECRET_PREVIOUS`，所有人需要重新登录。

`validateEnv` 在生产环境拒绝弱的或与 `JWT_SECRET` 相同的 `JWT_SECRET_PREVIOUS`。

## CRON_SECRET（定时任务）

内部任务接口（`/api/internal/order-timeouts`、`/api/internal/data-retention`）接受 `CRON_SECRET` 或轮换期的 `CRON_SECRET_PREVIOUS`，两者都至少 32 个字符。

1. 在 Vercel 把旧值填入 `CRON_SECRET_PREVIOUS`、新值填入 `CRON_SECRET`，重新部署。
2. 在 QStash 中把每个定时任务的 `Authorization: Bearer <CRON_SECRET>` 改为新值。
3. 确认下一次投递成功（QStash 日志为 200）后，删除 `CRON_SECRET_PREVIOUS` 并重新部署。

## 数据库密码（Aiven MySQL）

为避免停机，用“新建用户—切换—删除旧用户”代替直接改密码：

1. Aiven 控制台 → MySQL 服务 → **Users**：新建用户（例如 `app_2026q4`），授予与现有应用用户相同的权限。
2. Vercel 中更新 Production（和 Preview）的 `DB_USER`、`DB_PASSWORD`，重新部署；访问 `/api/health` 确认 `mysql: up`。
3. 观察一天无连接错误后，在 Aiven 删除旧用户。

## Redis（Upstash）

Upstash 控制台重置密码后旧连接串立即失效，会有短暂的缓存与限流不可用（订单与账户数据不受影响）：

1. 选择低峰时段，在 Upstash 重置密码。
2. 立即在 Vercel 更新 `REDIS_URL` 并重新部署，确认 `/api/health` 中 `redis: up`。

## ADMIN_TOTP_KEY（管理员两步验证）

`ADMIN_TOTP_KEY` 加密数据库中每位管理员的验证器密钥。它没有过渡期：换了新值，旧密钥加密的验证器全部无法解密，所有管理员都要重新绑定。因此不做例行轮换，只在怀疑泄露（同时数据库也可能泄露）时更换：

1. 用 `openssl rand -base64 32` 生成新值，在 Vercel 更新 `ADMIN_TOTP_KEY`（Sensitive）并重新部署。
2. 对每位管理员执行 `node dist/database/admin-reset-two-factor.js <用户名>`（清除旧绑定和恢复码），他们下次登录时重新绑定。

`ADMIN_TOTP_KEY` 要和数据库备份分开保存：只拿到备份的人解不开验证器密钥；从备份恢复时则需要同一个密钥，否则管理员要全部重新绑定。

## 其他密钥

| 密钥 | 轮换方法 |
|------|----------|
| `GMAIL_APP_PASSWORD` / `RESEND_API_KEY` | 在邮件服务商处新建应用密码或 API Key，更新 Vercel 后吊销旧的 |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Sentry 项目 → Client Keys 新建 Key，更新 Vercel 并重新部署后禁用旧 Key |
| `ADMIN_BOOTSTRAP_PASSWORD` | 仅初始化管理员时临时设置，用完即从环境中删除 |
| 管理员密码 | 管理员在后台自行修改；人员离开时由超级管理员禁用其账户 |

## 第三方安全评审（渗透测试）

上线前及每年一次，请具备资质的第三方做一次渗透测试。准备工作：

- **范围**：顾客站点、管理后台（`/admin`）、同域 API（`/api`），以及认证、会话、订单与库存、优惠券、售后、个人信息导出与注销等关键流程。参考 OWASP ASVS Level 2。
- **环境**：使用独立的预览部署和 `ecommerce_preview` 数据库（见 [备份、恢复与环境隔离](BACKUP_RESTORE.md)），不对生产环境测试；测试前做一次备份。
- **账户**：为测试方创建专用的顾客账户和各角色的管理员账户，测试结束后禁用并轮换上述密钥。
- **规则**：书面约定测试时间窗、禁止的手段（拒绝服务、社会工程等）和联系人。
- **结果**：发现的问题按严重程度进入修复计划，修复后由测试方复测，报告保存在仓库之外的受控位置。

漏洞报告渠道见 [SECURITY.md](../SECURITY.md)。

## 记录

| 日期 | 轮换或评审内容 | 执行人 |
|------|----------------|--------|
| | | |
