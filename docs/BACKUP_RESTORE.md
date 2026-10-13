# 备份、恢复与环境隔离

适用于 Vercel + Aiven MySQL + Upstash Redis 的云端部署（见 [云端部署指南](VERCEL_UPSTASH.md)）。Docker 自建部署同样可以使用其中的恢复演练脚本。

## 目标

| 指标 | 目标 | 说明 |
|------|------|------|
| RPO（最多丢失的数据） | 以 Aiven 套餐的备份频率为准 | 在 Aiven 控制台 → MySQL 服务 → **Backups** 查看备份间隔与保留天数，并记录在下方“记录” |
| RTO（恢复所需时间） | 1 小时内 | 演练脚本会输出导出与恢复耗时，用来校准这个目标 |

## 1. 自动备份（Aiven）

Aiven 托管 MySQL 自带自动备份，保留期取决于套餐。每次更换套餐后：

1. 打开 Aiven 控制台 → 对应 MySQL 服务 → **Backups**，确认最近一次备份时间和保留天数。
2. 把结果写进本文末尾的“记录”。保留期少于 7 天时，考虑升级套餐，或用演练脚本额外做定期逻辑备份并存放到加密存储。

## 2. 恢复演练（每季度一次，以及每次大的结构迁移之前）

`scripts/dev/backup-restore-drill.sh` 对配置的数据库做一次一致性逻辑备份（`mysqldump --single-transaction`，只读），恢复到本机临时 MySQL 8.0 容器，然后逐表比对行数，并在恢复出的副本上运行后端的结构检查。

```bash
npm --prefix backend run build   # 让演练同时运行后端结构检查
# 在当前终端临时设置连接信息（从 Aiven 控制台的 Connection information 复制），不要写进文件或提交：
export DB_HOST=... DB_PORT=... DB_USER=... DB_PASSWORD=... DB_NAME=defaultdb DB_SSL=true
export DB_SSL_CA_BASE64="$(base64 < ca.pem)"   # Aiven 下载的 CA 证书
./scripts/dev/backup-restore-drill.sh
```

- 脚本只读取环境变量，不读 `.env`，不打印凭据；导出文件含个人信息，只放在权限为 700 的临时目录，结束（包括失败）时与临时容器一起删除。
- 有表在恢复后缺失时，脚本以非零状态退出。演练期间仍有线上写入时，个别表的行数可能与快照后的源库略有差异，脚本会标出这些表，但不判定失败。
- 演练后在“记录”中写下日期、导出大小、恢复耗时和结果。

## 3. 真实恢复（数据损坏或误删时）

1. **止损**：在 Vercel 暂停写入流量（例如把生产部署回滚到维护版本，或临时移除域名），避免继续写入损坏的数据。
2. **恢复到新服务**：在 Aiven 控制台 → **Backups** 选择损坏之前的时间点，使用 *Fork & restore*（或套餐提供的时间点恢复）创建新的 MySQL 服务。不要直接覆盖原服务，以便对比和回退。
3. **核对**：用恢复演练脚本连接新服务做一次核对（行数与结构检查）。
4. **切换**：在 Vercel 把 **Production** 的 `DB_HOST`、`DB_PORT`、`DB_PASSWORD`、`DB_SSL_CA_BASE64` 改为新服务，重新部署，访问 `/api/health` 确认 `mysql: up`。
5. **复盘**：保留原服务至少 7 天用于取证，记录时间线和丢失的数据范围。

## 4. 预览环境的数据库隔离

预览部署不能写生产数据。在同一个 Aiven 服务中为预览单独建库：

1. Aiven 控制台 → MySQL 服务 → **Databases** → 新建 `ecommerce_preview`。
2. Vercel → Settings → Environment Variables，把 **Preview** 的 `DB_NAME` 改为 `ecommerce_preview`（Production 保持 `defaultdb`）。
3. 在本地对新库建表并初始化管理员（命令行里临时设置连接信息，同第 2 节）：

   ```bash
   npm --prefix backend run build
   DB_NAME=ecommerce_preview node backend/dist/database/migrate.js
   DB_NAME=ecommerce_preview ADMIN_BOOTSTRAP_PASSWORD='至少 16 个字符' node backend/dist/database/admin-migrate.js
   DB_NAME=ecommerce_preview node backend/dist/database/seed.js   # 可选：演示商品
   ```

4. 重新部署一个预览，确认 `/api/health` 正常，并在预览里注册的测试账号不会出现在生产后台。

Redis 已按环境使用不同的键前缀（`ecommerce:production:` / `ecommerce:preview:`），共用同一个 Upstash 实例的配额。

数据库密码、Redis 连接串等在 Vercel 中应设为 **Sensitive** 类型。

## 记录

| 日期 | 内容 | 结果 |
|------|------|------|
| | Aiven 备份间隔 / 保留天数 | |
| | 恢复演练（导出大小、恢复耗时） | |
