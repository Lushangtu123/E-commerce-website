# Vercel、Upstash 与 Aiven 部署

商城前端和 Express API 在同一个 Vercel 项目中运行，浏览器使用 `/api`。交易、账户、浏览记录和推荐读取 MySQL；缓存和跨实例限流使用 Redis。独立服务器仍可通过 `backend/dist/index.js` 启动。

Vercel 自动启用内置 API；本地需要验证同一部署结构时可设置 `ECOMMERCE_SERVERLESS_API=true`，先构建后端。Docker 和原有独立前后端部署默认关闭内置 API，继续设置 `NEXT_PUBLIC_API_URL` 指向独立后端，因此前端镜像不需要复制后端代码。

## Vercel 设置

- Framework：Next.js，Node.js：24.x，Root Directory：`frontend`。
- Install Command：`cd .. && npm ci --prefix backend && npm ci --prefix frontend`。
- Build Command：`cd .. && npm --prefix backend run build && npm --prefix frontend run build`。
- 允许构建读取 Root Directory 外的后端代码。后端必须先编译，构建时生成 OpenAPI JSON。
- 默认发布 Preview：在仓库根目录运行 `vercel deploy --target preview --scope <team-slug>`。新项目第一次部署可能被 Vercel 自动设为 Production；检查 `vercel inspect` 的 target，并再次明确发布 Preview。

将以下变量配置到对应的 Vercel 环境。Preview 和 Production 的变量分别管理，不能只配置一个环境后直接推广另一个环境。

| 变量 | 用途 |
| --- | --- |
| `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` | Aiven MySQL 连接配置 |
| `DB_SSL=true`、`DB_SSL_CA_BASE64` | 开启证书验证，CA 为平台下载 PEM 的 Base64 |
| `DB_CONNECTION_LIMIT=2` | 限制每个函数实例的连接池 |
| `REDIS_URL` | Upstash 控制台提供的 `rediss://` TLS 连接地址 |
| `REDIS_KEY_PREFIX=ecommerce:preview:` | 与其他项目及环境隔离键名；仍共用实例配额 |
| `JWT_SECRET` | 独立随机长密钥 |
| `CRON_SECRET` | 至少 32 字符的独立随机定时任务密钥 |
| `CORS_ORIGIN` | 允许的前端来源；跨域调用时须包含实际域名 |
| `NEXT_PUBLIC_API_URL=/api` | 同域 API 地址 |

连接初始化可复用并在失败后重试，MySQL 与 Redis 均保留 TLS 验证。Vercel API 不启动监听器、RabbitMQ 消费者或后台定时器；`/api/health` 检查 MySQL 和 Redis，`/api/openapi.json` 提供接口定义。

## 初始化数据库

先配置云数据库变量，在本地运行 `npm --prefix backend run build`，然后运行 `backend/dist/database/migrate.js` 及 `backend/dist/database/admin-migrate.js`。管理员初始化还需临时设置至少 16 字符的 `ADMIN_BOOTSTRAP_PASSWORD`；生产环境不会创建默认弱密码账户。迁移不会在每次函数请求中运行。

初始化命令应从后端目录运行，或在进程中直接注入配置；不要提交 `.env`、云端连接地址中的密码、CA 私钥或管理员密码。`seed` 会清空开发数据，已禁止在 `NODE_ENV=production` 下执行。示例商品不是实际商品，正式运营前需由管理员替换。

## QStash 订单超时任务

待支付订单超过 30 分钟后取消，并通过现有事务恢复库存和优惠券；重复投递不会重复恢复库存。任务每次最多检查 50 笔，定时每 5 分钟触发一次。

在 QStash 创建 POST 任务，目标为当前有效 Preview 的 `/api/internal/order-timeouts`，使用 `*/5 * * * *`，最多重试 1 次、超时 55 秒。每日正常投递 288 次，全部重试时 576 次；其他 QStash 使用也会占用同一配额。

- `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`。
- Preview 开启 Vercel 登录保护时，需经账号所有者授权创建本项目的自动化访问密钥，再设置 `Upstash-Forward-x-vercel-protection-bypass`。该密钥可访问项目的受保护部署，应只给该任务使用。
- 使用 `Upstash-Redact-Fields: header[Authorization],header[x-vercel-protection-bypass]` 隐藏日志中的凭据，不将密钥放到 URL。
- 使用固定 Schedule ID，例如 `ecommerce-preview-order-timeouts`，更新现有任务避免重复创建。重新部署后需更新目标 URL，或绑定稳定的 Preview 别名。
- 确认 QStash 投递日志返回 200 后才算调度完成。未配置调度时，Vercel 不会自动取消超时订单。

## 当前能力范围

Vercel 方案不需要 MongoDB 或 RabbitMQ，普通商品搜索和推荐使用 MySQL。额外的 Elasticsearch 接口需要单独配置服务；此部署没有提供 Elasticsearch。支付目前是项目内状态流转，尚未对接实际收款渠道。Vercel 文件系统不能作为持久上传存储。

免费数据库适用于试用，容量、闲置暂停和配额以平台控制台为准。生产发布前应准备独立配置、商品数据、备份和支付服务。若尚未连接 Git 集成，推送 GitHub 只触发仓库 CI，需要再运行 Vercel CLI 发布。
