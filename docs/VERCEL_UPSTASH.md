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
| `NEXT_PUBLIC_SITE_URL` | 可选。网站公开地址，用于 canonical、Open Graph 和 sitemap；不填时生产环境使用 Vercel 项目生产域名。只有 Production 允许搜索引擎收录，Preview 一律 noindex |
| `NEXT_PUBLIC_SUPPORT_PHONE`、`NEXT_PUBLIC_SUPPORT_EMAIL` | 可选的公开商家客服联系信息。留空或格式不可用时不发布示例联系方式；仅配置一项时只显示该项。这些值会打包到客户端，修改后须重新构建和部署，勿填写密钥 |
| `PAYMENT_MODE=demo` | 仅 Preview 演示交易，不实际扣款；默认 disabled，生产环境强制关闭模拟支付 |
| `RESEND_API_KEY`、`EMAIL_FROM`、`APP_URL` | 可选的 Resend 密码找回；发件域名须验证，APP_URL 为可信 HTTPS 网站根地址 |
| `EMAIL_PROVIDER=gmail`、`GMAIL_USER`、`GMAIL_APP_PASSWORD`、`APP_URL` | 可选的个人 Gmail 密码找回，无需独立域名；使用 Google 应用专用密码，通过 smtp.gmail.com:465 验证 TLS 后发信 |

连接初始化可复用并在失败后重试，MySQL 与 Redis 均保留 TLS 验证。Vercel API 不启动监听器、RabbitMQ 消费者或后台定时器；`/api/health` 检查 MySQL 和 Redis，`/api/openapi.json` 提供接口定义。

`/health` 与 `/api/health` 在同一实例共享独立的每 IP 每分钟 30 次限额，不消耗业务 API 的限流额度，也不向 Redis 写限流计数。依赖报告按实例缓存 5 秒，并发请求复用同一次探测；3 秒超时后仍未结束的底层探测会继续被复用，防止重复排队。必需依赖故障仍返回 503，超额返回 429；响应设置 `Cache-Control: no-store`，错误仅返回通用状态。Vercel 各实例的计数和缓存独立，不能把此限制视为全站总流量上限。

服务器 HTTP 日志只记录路径，不记录查询串。数据库异常只保留安全类型、错误码和 SQLSTATE，不保留 SQL、参数、原始消息或堆栈；普通错误继续保留诊断消息，附加对象字段不进入错误日志。不要主动将凭据或个人信息放入业务日志上下文。

商品详情在每次服务端请求中检查当前上架状态，下架后的 404 不会被旧的成功缓存覆盖；同一次页面请求仍复用商品数据。站点地图仅在可收录的生产环境生成 URL，完整结果按小时 ISR 缓存；生成时分页数据不跨请求缓存。分页失败或响应格式不可用会使本次生成失败，有既有结果时继续提供上次完整 XML，并在后续请求重试；首次生成失败会报错，不发布残缺列表。商品列表保持现有最多 50 页、每页 100 件的上限。

首页、配送和售后说明描述当前可用流程。配送范围、费用、时效及退换货条件需由商家提供实际信息，不预设全国包邮、固定送达时间或赔付承诺。Docker 部署通过同名公开构建参数传入客服信息；只更改运行时环境不能更新已构建的客户端。

## Web Analytics 与 Speed Insights

根布局接入 `@vercel/analytics/next` 和 `@vercel/speed-insights/next`，覆盖首次访问和 Next.js 路由切换。两个 SDK 通过 `beforeSend` 去掉 URL 的查询参数、片段和内嵌凭据，保留页面路径及动态路由分组；不添加账户、订单内容或自定义业务事件。

在 Vercel 项目的 Analytics 页面启用 Web Analytics，然后重新部署。Speed Insights 免费版在安装 SDK 并部署后开始收集，无需开通 Plus。SDK 使用平台自动生成的脚本和上报路径，不需客户端密钥。查看当前分支数据时，将两个面板的环境筛选设为 Preview 或 All Environments。

访问部署并切换页面后检查浏览器 Network 中的脚本和上报请求，再等待面板聚合数据。开发模式不收集 Analytics 正式访问数据，访问统计和性能评分不会追溯 SDK 接入前的历史。免费 Speed Insights 提供 Real Experience Score；各项 Core Web Vitals 的详细面板属于 Plus，当前部署使用免费版。额度和功能以 [Analytics 官方说明](https://vercel.com/docs/analytics/limits-and-pricing) 与 [Speed Insights 官方说明](https://vercel.com/docs/speed-insights/limits-and-pricing) 为准。

## 初始化数据库

先配置云数据库变量，在本地运行 `npm --prefix backend run build`，然后运行 `backend/dist/database/migrate.js` 及 `backend/dist/database/admin-migrate.js`。管理员初始化还需临时设置至少 16 字符的 `ADMIN_BOOTSTRAP_PASSWORD`；生产环境不会创建默认弱密码账户。迁移不会在每次函数请求中运行。

初始化命令应从后端目录运行，或在进程中直接注入配置；不要提交 `.env`、云端连接地址中的密码、CA 私钥或管理员密码。`seed` 会清空开发数据，已禁止在 `NODE_ENV=production` 下执行。示例商品不是实际商品，正式运营前需由管理员替换。

商品双语功能要求发布前先升级目标库。核对 Preview / Production 是否共用同一数据库，并备份 `products`、`product_skus`、`order_items` 的结构和数据；在 `backend` 中运行 `npm run build`，再运行 `npm run migrate:product-i18n`。迁移仅为商品增加 `title_en`、`description_en`、`specs_en`，为 SKU 增加 `specs_en`，为订单明细增加 `product_name_en`、`sku_specs_en`，全部为可空列，重复执行安全。旧中文字段、库存、价格和历史订单不变；回滚代码时保留新增列。迁移不在构建或请求中自动运行，推送会触发 Preview 时也须先完成升级。Elasticsearch 已有索引需要在更新商品英文内容后运行 `sync-es` 全量同步；未配置 Elasticsearch 的部署直接使用 MySQL 英文搜索。共享 Redis 的商品详情与热榜使用新版本缓存键，禁止清空共用 Redis。

已有数据库升级时，编译后依次运行 `backend/dist/database/migrate-account-security.js` 和 `backend/dist/database/migrate-fulfillment.js`。两者只添加缺失字段和新表，重复运行安全，不重建账户或订单。账户安全迁移保留历史密码，将历史会话版本设为 0；改密后旧会话立即失效。物流迁移添加快递公司、运单号和售后审核记录。

售后进度上线前，核对 Preview / Production 是否共用目标库，先备份 `after_sales_requests` 的结构和数据，编译后在 `backend` 运行 `npm run schema:after-sales`。若返回 `migration_required`，经授权运行 `npm run migrate:after-sales`，然后复查必须是 `ready`。迁移仅添加 `return_company`、`return_tracking_number`、`return_submitted_at`、`refund_amount`、`refund_reference`、`completion_note`、`completed_by`、`completed_at` 八个可空字段，保留原四种审核状态和历史记录，重复运行安全。旧的已审核申请继续等待人工处理；退货须提交一次运单后才可结案。退款申请可直接记录人工处理结果，非零退款必须有凭证且不能超过订单实付金额，演示订单只允许零金额。结案记录与管理员审计在同一事务，订单状态、库存、资金均不由结案接口变更。回滚旧代码保留新增列；构建、API 请求不自动执行迁移。

结算重试保护需要 `orders.checkout_key`、`orders.checkout_fingerprint` 和 `(user_id, checkout_key)` 唯一索引。发布此功能前，核对目标库并备份，在 `backend` 目录运行 `npm run build`、`npm run schema:checkout`；若提示 `migration_required`，执行 `npm run migrate:checkout`，再检查，必须返回 `ready`。迁移只增加可空列和索引，既有订单保持不变，可重复执行；回滚旧代码时保留这些列。迁移不在构建或请求中自动执行。完整基础迁移也包含此升级。

`POST /api/orders` 必须携带 UUID 格式的 `checkout_key`。新结算生成新请求号，同一次结算重试保留原请求号、商品、地址、备注和优惠券；同号修改内容返回 409。浏览器在提交前把待确认结算保存到当前标签页的会话存储；保存失败时不发请求，网络错误、HTTP 408 超时、429 限流或 5xx 后显示“重试确认订单”，重新打开购物车也可恢复。超时或限流不能确认此前下单失败，因此继续保留原请求号；明确的业务拒绝仍允许重新结算。重试返回原订单和原金额，不再次扣库存、使用优惠券或移除新加入购物车的同种商品；已取消订单仍返回原订单。

账户安全迁移还会补齐 `users.status`（既有用户默认启用）与 `admins.auth_version`。禁用用户会撤销旧会话，重新启用后需要重新登录。发布包含这些字段的新代码前，使用目标环境的数据库配置，从 `backend` 目录先执行 `npm run build`，再执行 `npm run schema:check`。该检查只读取数据库结构；缺列会列出字段并以非零状态退出。核对目标库并备份后运行 `npm run migrate:account-security`，然后重复 `npm run schema:check`，结果必须是 `ready`。不要把迁移放进构建命令或每次 API 请求，也不要在共享数据库上运行 `seed`。

后台销售额与累计消费只统计已支付、已发货、已完成订单（状态 1、2、3）；订单数量仍包含全部状态。趋势按订单创建日期分组，不代表支付渠道对账或自动退款记录。仪表盘统计接口要求 `statistics:view`，最近订单要求 `order:view`；各区域独立加载，有权区域不会被其他区域的权限错误阻断。

后台优惠券列表与详情要求 `coupon:view`，创建要求 `coupon:create`，启停要求 `coupon:edit`。超级管理员按现有规则拥有全部权限；商品、订单或统计角色不会自动获得优惠券权限，其他角色需明确授权。已有仅使用超级管理员的部署无需变更数据库结构即可启用门禁；权限目录可通过现有 `admin-migrate.js` 初始化，勿给普通角色批量授予。

## QStash 订单超时任务

待支付订单超过 30 分钟后取消，并通过现有事务恢复库存和优惠券；重复投递不会重复恢复库存。任务每次最多检查 50 笔，定时每 5 分钟触发一次。

批次响应包含 `checked`、`cancelled`、`failed`、`skipped`。单笔事务失败会计入 `failed`，批次返回 503 以触发重试；并发中已改变状态的订单只计 `skipped`。商城 Redis 前缀下的 `order-timeouts:cursor:v1` 保存扫描进度，跨 Vercel 实例按订单 ID 继续，扫描到尾部后复位并重试之前失败的订单；原子版本比较防止迟到批次覆盖新进度，键闲置一天自动过期。Redis 进度不可用时记录警告并从头有界扫描，已提交的取消不会回滚。应持续关注 `failed` 计数，重试不能修复永久的数据错误。

演示支付在取得订单行锁后重新检查数据库时间，满 30 分钟即拒绝付款，不增加销量或改变库存、优惠券；取消任务随后释放预留库存和优惠券。

在 QStash 创建 POST 任务，目标为当前有效 Preview 的 `/api/internal/order-timeouts`，使用 `*/5 * * * *`，最多重试 1 次、超时 55 秒。每日正常投递 288 次，全部重试时 576 次；其他 QStash 使用也会占用同一配额。

- `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`。
- Preview 开启 Vercel 登录保护时，需经账号所有者授权创建本项目的自动化访问密钥，再设置 `Upstash-Forward-x-vercel-protection-bypass`。该密钥可访问项目的受保护部署，应只给该任务使用。
- 使用 `Upstash-Redact-Fields: header[Authorization],header[x-vercel-protection-bypass]` 隐藏日志中的凭据，不将密钥放到 URL。
- 使用固定 Schedule ID，例如 `ecommerce-preview-order-timeouts`，更新现有任务避免重复创建。重新部署后需更新目标 URL，或绑定稳定的 Preview 别名。
- 确认 QStash 投递日志返回 200 且 `failed=0` 后才算该批次完成；503 需要重试并检查失败计数。未配置调度时，Vercel 不会自动取消超时订单。

## 当前能力范围

Vercel 方案不需要 RabbitMQ 或 Elasticsearch：商品搜索（含 `/api/search/es`）和推荐在未配置 `ELASTICSEARCH_URL` 时使用 MySQL，订单超时由下文的 QStash 定时任务取消。演示支付会明确显示未实际扣款，并记录 payment_method=demo，尚未对接实际收款渠道。发货必须填写快递公司和运单号；售后支持申请、撤回、管理员批准或拒绝、退货运单、人工退款记录及结案；审核和结案不会自动执行资金退款、恢复库存或改变订单状态。每个订单最多创建一次售后申请。Vercel 文件系统不能作为持久上传存储。

邮件服务未配置时，找回密码页面禁用发送，接口返回 503；已登录用户仍可验证当前密码并修改密码。配置邮件服务后，重置链接使用一次性凭据，30 分钟有效，重置后撤销所有旧会话。邮件发送和真实支付需要运营方准备外部服务，本仓库不会自动注册付费服务。

### 使用个人 Gmail 发送找回密码邮件

没有独立域名时，可使用运营方能登录的个人 `@gmail.com` 邮箱。先自行开启 Google 两步验证并生成应用专用密码；不要提供 Google 登录密码，也不要将应用密码写入 Git、聊天、公开前端变量或日志。

在商城 Vercel 项目的 Settings → Environment Variables 中，分别配置需要启用发信的 Preview / Production 环境：

- `EMAIL_PROVIDER=gmail`。
- `GMAIL_USER`：发件人 Gmail 地址。
- `GMAIL_APP_PASSWORD`：16 字符的 Google 应用专用密码；界面显示的分组空格可保留。凭据变量应选择 Sensitive。
- `APP_URL`：可信商城 HTTPS 根地址，例如 `https://e-commerce-website-blush-rho.vercel.app`。Preview 验证时请使用对应的测试商城地址，避免测试链接误指向正式数据库。

重新部署后生效。Gmail 的 From 固定使用 `GMAIL_USER`，不读取 `EMAIL_FROM`；原有 Resend 配置无需删除。`EMAIL_PROVIDER` 未设置时仍使用 Resend；选择 Gmail 但凭据缺失、格式不正确或网站地址不可信时保持关闭，不自动切换其他服务。SMTP 验证证书和主机名，整个发送最多等待 5 秒后关闭连接，协议日志关闭；失败仅记录通用提示，接口不暴露账户是否存在或邮件服务错误。

用自有测试账户在部署上请求一次密码找回，实际检查收信、链接打开、重置成功、重复链接失效及旧会话撤销；不要只根据 API 返回成功判断投递成功。本地回归使用测试 SMTP 服务器，不向真实用户发信。Gmail 的风控可能限制云端登录或发送，需检查 Google 账号与邮箱中的提示。个人 Gmail 的发送额度参见 [Google 官方说明](https://support.google.com/mail/answer/22839)，应用密码设置参见 [Google 官方说明](https://support.google.com/accounts/answer/185833)。修改 Google 登录密码会撤销应用密码，之后需更新 Vercel 凭据并重新部署。若暂不发信，移除 Gmail 应用密码即可恢复未配置状态。

浏览器回归在本机或 CI 使用独立 MySQL 测试库，不访问云端商城数据。在后端编译后，从前端目录执行 `npx playwright install chromium`，再设置本机 `MYSQL_TEST_HOST`、`MYSQL_TEST_PORT`、`MYSQL_TEST_USER`、`MYSQL_TEST_PASSWORD`（或 `MYSQL_TEST_SOCKET`）并运行 `npm run test:e2e`。数据库账户须能创建和删除测试库。测试覆盖注册、地址、结算、演示支付、发货、收货、售后审核和修改密码；缓存接口隔离模拟，交易与账户存储使用真实 MySQL。

免费数据库适用于试用，容量、闲置暂停和配额以平台控制台为准。生产发布前应准备独立配置、商品数据、备份和支付服务。若尚未连接 Git 集成，推送 GitHub 只触发仓库 CI，需要再运行 Vercel CLI 发布。
