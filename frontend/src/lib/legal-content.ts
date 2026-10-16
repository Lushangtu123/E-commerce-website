import { registerTranslations } from '@/lib/i18n';
import type { InfoSection } from '@/components/InfoPage';

/** Demo disclosures reflect deployed behavior; formal operation needs a separate legal review. */
export const LEGAL_UPDATED = '更新日期：2026年10月16日';
const DEMO_NOTICE = '本网站是个人演示项目，不开展真实商品销售，不收取真实款项，也不提供实际配送、退款或售后服务。请仅使用授权测试账号和虚构资料，勿填写真实收货信息、支付信息或他人的个人信息。';

export const PRIVACY_POLICY: { title: string; intro: string; sections: InfoSection[] } = {
  title: '隐私政策',
  intro: DEMO_NOTICE,
  sections: [
    { title: '我们收集的信息', body: [
      '账户信息：测试账号的用户名、邮箱和密码哈希，以及你选择填写的手机号和头像地址。找回密码测试可使用你有权控制的测试邮箱。',
      '演示数据：收货资料、模拟订单和支付状态、物流、售后申请及评价。请使用虚构内容。',
      '使用记录：浏览过的商品、搜索关键词、购物车、收藏和领取的优惠券。',
      '公开访问仍可能产生 IP 地址、访问时间和路径等托管日志；个人演示不代表完全不处理个人信息。',
    ] },
    { title: '我们如何使用信息', body: [
      '测试登录、模拟购物流程、个人设置和密码找回功能；浏览和搜索记录用于演示推荐与搜索。',
      '诊断故障、限制滥用，并查看页面访问与性能统计。',
    ] },
    { title: 'Cookie 与本地存储', body: [
      '登录状态保存在仅限服务器读取的 Cookie 中；浏览器本地存储还保存会话编号、账户资料、语言偏好和部分待确认操作，退出登录会清理对应的会话资料。',
      '页面统计使用 Vercel Analytics 与 Speed Insights，不设置跟踪 Cookie；上报前去掉网址中的查询参数和片段。',
    ] },
    { title: '云服务与跨境处理', body: [
      '网站使用 Vercel 托管和统计、Aiven 数据库、Upstash 缓存与任务调度，以及已配置的邮件服务；启用 Sentry 时发送经过过滤的错误诊断数据。',
      '错误上报配置为排除请求体、Cookie 和用户资料，但请勿在测试内容或错误文本中填写个人信息。',
      '这些服务可能在你所在国家或地区以外处理数据。本项目尚未完成面向真实用户的跨境处理安排，正式开放前需要确认服务商、处理地区、告知与适用的授权程序。',
    ] },
    { title: '保存与清理', body: [
      '清理任务以浏览和搜索记录 180 天、页面访问记录 90 天为阈值，并删除过期密码重置凭据；实际清理取决于定时任务成功运行。',
      '模拟订单、售后和相关记录尚无自动到期清理。托管日志和备份按服务商实际配置保留，不由账户注销接口立即清除。',
      '注销账号会停用账户并删除地址簿、购物车、收藏、浏览和搜索记录等数据；当前仍保留模拟订单中的收货快照、售后、评价及去身份化的账户行，这些保留记录不保证匿名化。',
    ] },
    { title: '账户功能与咨询', body: [
      '个人设置可导出账户关联数据，包括账户资料、地址、订单和活动记录等；导出不包含密码、密钥或服务商的全部日志和备份。',
      '可修改账户资料，删除地址、浏览和搜索记录，或注销账号。未完成的模拟订单或售后会暂时阻止注销。',
      '如本页显示联系渠道，可用于演示问题咨询；正式运营主体、权利请求渠道和响应流程将在开放真实用户前明确。',
    ] },
    { title: '安全与使用限制', body: [
      '系统使用 HTTPS、密码哈希、权限控制和操作审计。演示验证不能替代正式安全评估，请勿提交真实交易或敏感资料。',
      '本演示不向十四周岁以下儿童提供注册服务，请勿提交儿童个人信息。',
    ] },
    { title: '政策更新', body: [
      '用途或数据处理方式发生变化时，应先更新本说明；开放真实用户或交易前将另行明确正式政策与条款。',
      LEGAL_UPDATED,
    ] },
  ],
};

export const USER_AGREEMENT: { title: string; intro: string; sections: InfoSection[] } = {
  title: '用户协议',
  intro: DEMO_NOTICE,
  sections: [
    { title: '测试账户', body: [
      '仅使用你有权控制的测试账号，不冒用他人身份；妥善保管密码、验证器和恢复码。',
      '发现账号被误用时，请修改密码并停止测试。个人设置提供资料导出和账号注销功能。',
    ] },
    { title: '商品与模拟订单', body: [
      '商品、价格、库存、物流及售后状态仅用于功能展示，提交模拟订单不构成真实商品购买或实际履约承诺。',
      '请勿依据演示价格付款，也不要填写真实收货资料。',
    ] },
    { title: '支付', body: [
      '本网站不提供真实支付；明确启用的测试支付仅模拟状态变更，不会实际扣款。',
    ] },
    { title: '配送与售后', body: [
      '配送、退货、退款和售后页面用于演示流程，不会实际发货、收货、转账或退款。',
    ] },
    { title: '使用规则', body: [
      '测试内容应合法，不得侵犯他人权益；未经授权不得攻击本网站或第三方服务。',
      '演示服务可能调整或停止，请勿将其用于真实业务或保存唯一的数据副本。',
    ] },
    { title: '正式运营前', body: [
      '当前说明仅适用于个人演示；面向真实用户或交易前，将明确运营主体、服务地区、联系渠道、适用法律和正式服务条款。',
      LEGAL_UPDATED,
    ] },
  ],
};

registerTranslations({
  [LEGAL_UPDATED]: 'Last updated: October 16, 2026',
  [DEMO_NOTICE]: 'This is a personal demonstration project. It does not sell goods, collect real payments, or provide actual delivery, refunds or after-sales services. Use only authorized test accounts and fictional details. Do not enter real shipping details, payment information or another person\'s personal data.',
  '我们收集的信息': 'Information we collect',
  '账户信息：测试账号的用户名、邮箱和密码哈希，以及你选择填写的手机号和头像地址。找回密码测试可使用你有权控制的测试邮箱。': 'Account information: a test account\'s username, email and password hash, and any phone number or avatar URL you choose to add. For password-recovery tests, use a test mailbox you control.',
  '演示数据：收货资料、模拟订单和支付状态、物流、售后申请及评价。请使用虚构内容。': 'Demo data: recipient details, simulated orders and payment statuses, shipping, after-sales requests and reviews. Use fictional content.',
  '使用记录：浏览过的商品、搜索关键词、购物车、收藏和领取的优惠券。': 'Activity: viewed products, search keywords, cart items, favorites and claimed coupons.',
  '公开访问仍可能产生 IP 地址、访问时间和路径等托管日志；个人演示不代表完全不处理个人信息。': 'Public visits can still generate hosting logs containing IP addresses, visit times and paths. A personal demo does not mean that no personal information is processed.',
  '我们如何使用信息': 'How information is used',
  '测试登录、模拟购物流程、个人设置和密码找回功能；浏览和搜索记录用于演示推荐与搜索。': 'To test sign-in, simulated shopping, profile settings and password recovery. Browsing and search history demonstrate recommendations and search.',
  '诊断故障、限制滥用，并查看页面访问与性能统计。': 'To diagnose faults, limit abuse and view page-visit and performance statistics.',
  'Cookie 与本地存储': 'Cookies and local storage',
  '登录状态保存在仅限服务器读取的 Cookie 中；浏览器本地存储还保存会话编号、账户资料、语言偏好和部分待确认操作，退出登录会清理对应的会话资料。': 'Sign-in is stored in a cookie only the server can read. Browser storage also holds session IDs, profile details, language preferences and some unconfirmed operations. Signing out clears the corresponding session details.',
  '页面统计使用 Vercel Analytics 与 Speed Insights，不设置跟踪 Cookie；上报前去掉网址中的查询参数和片段。': 'Page statistics use Vercel Analytics and Speed Insights without tracking cookies. URL query strings and fragments are removed before reporting.',
  '云服务与跨境处理': 'Cloud services and cross-border processing',
  '网站使用 Vercel 托管和统计、Aiven 数据库、Upstash 缓存与任务调度，以及已配置的邮件服务；启用 Sentry 时发送经过过滤的错误诊断数据。': 'The site uses Vercel for hosting and statistics, Aiven for its database, Upstash for caching and scheduled tasks, and the configured email service. When enabled, Sentry receives filtered error diagnostics.',
  '错误上报配置为排除请求体、Cookie 和用户资料，但请勿在测试内容或错误文本中填写个人信息。': 'Error reporting is configured to exclude request bodies, cookies and user profiles. Do not place personal information in test content or error messages.',
  '这些服务可能在你所在国家或地区以外处理数据。本项目尚未完成面向真实用户的跨境处理安排，正式开放前需要确认服务商、处理地区、告知与适用的授权程序。': 'These services may process data outside your country or region. Cross-border arrangements for real users have not been completed. Providers, processing locations, notices and applicable authorization procedures must be confirmed before public operation.',
  '保存与清理': 'Storage and cleanup',
  '清理任务以浏览和搜索记录 180 天、页面访问记录 90 天为阈值，并删除过期密码重置凭据；实际清理取决于定时任务成功运行。': 'The cleanup task uses thresholds of 180 days for browsing and search history and 90 days for page visits, and removes expired password-reset credentials. Actual cleanup depends on successful scheduled runs.',
  '模拟订单、售后和相关记录尚无自动到期清理。托管日志和备份按服务商实际配置保留，不由账户注销接口立即清除。': 'Simulated orders, after-sales and related records do not yet have automatic expiry cleanup. Hosting logs and backups follow the providers\' actual retention settings and are not immediately erased by account deletion.',
  '注销账号会停用账户并删除地址簿、购物车、收藏、浏览和搜索记录等数据；当前仍保留模拟订单中的收货快照、售后、评价及去身份化的账户行，这些保留记录不保证匿名化。': 'Account deletion disables the account and removes address-book entries, cart items, favorites, and browsing and search history. Simulated order address snapshots, after-sales records, reviews and the de-identified account row remain. These retained records are not guaranteed to be anonymous.',
  '账户功能与咨询': 'Account features and questions',
  '个人设置可导出账户关联数据，包括账户资料、地址、订单和活动记录等；导出不包含密码、密钥或服务商的全部日志和备份。': 'Profile settings can export account-linked data, including profile details, addresses, orders and activity records. The export excludes passwords, secrets and the providers\' complete logs and backups.',
  '可修改账户资料，删除地址、浏览和搜索记录，或注销账号。未完成的模拟订单或售后会暂时阻止注销。': 'You can edit profile details, remove addresses or browsing and search history, or delete your account. Unfinished simulated orders or after-sales requests temporarily prevent deletion.',
  '如本页显示联系渠道，可用于演示问题咨询；正式运营主体、权利请求渠道和响应流程将在开放真实用户前明确。': 'If contact details are shown on this page, use them for demo questions. The formal operator, rights-request channel and response process will be specified before opening to real users.',
  '安全与使用限制': 'Security and use limits',
  '系统使用 HTTPS、密码哈希、权限控制和操作审计。演示验证不能替代正式安全评估，请勿提交真实交易或敏感资料。': 'The system uses HTTPS, password hashing, access controls and audit logs. Demo testing does not replace a formal security assessment. Do not submit real transactions or sensitive information.',
  '本演示不向十四周岁以下儿童提供注册服务，请勿提交儿童个人信息。': 'Registration for this demo is not offered to children under fourteen. Do not submit children\'s personal information.',
  '政策更新': 'Changes',
  '用途或数据处理方式发生变化时，应先更新本说明；开放真实用户或交易前将另行明确正式政策与条款。': 'This notice must be updated before changing the purpose or data-processing practices. Formal policies and terms will be specified before accepting real users or transactions.',
  '测试账户': 'Test accounts',
  '仅使用你有权控制的测试账号，不冒用他人身份；妥善保管密码、验证器和恢复码。': 'Use only test accounts you are authorized to control and do not impersonate others. Keep passwords, authenticators and recovery codes secure.',
  '发现账号被误用时，请修改密码并停止测试。个人设置提供资料导出和账号注销功能。': 'If an account is misused, change its password and stop testing. Profile settings offer data export and account deletion.',
  '商品与模拟订单': 'Products and simulated orders',
  '商品、价格、库存、物流及售后状态仅用于功能展示，提交模拟订单不构成真实商品购买或实际履约承诺。': 'Products, prices, inventory, shipping and after-sales statuses demonstrate features only. A simulated order does not create a real purchase or a promise of actual fulfillment.',
  '请勿依据演示价格付款，也不要填写真实收货资料。': 'Do not pay based on demo prices or enter real shipping details.',
  '支付': 'Payment',
  '本网站不提供真实支付；明确启用的测试支付仅模拟状态变更，不会实际扣款。': 'The site does not offer real payments. Where test payments are explicitly enabled, they only simulate status changes and do not charge money.',
  '配送与售后': 'Delivery and after-sales',
  '配送、退货、退款和售后页面用于演示流程，不会实际发货、收货、转账或退款。': 'Shipping, returns, refunds and after-sales pages demonstrate workflows only. They do not send or receive goods, transfer money or issue actual refunds.',
  '使用规则': 'Use rules',
  '测试内容应合法，不得侵犯他人权益；未经授权不得攻击本网站或第三方服务。': 'Test content must be lawful and respect others\' rights. Do not attack this site or third-party services without authorization.',
  '演示服务可能调整或停止，请勿将其用于真实业务或保存唯一的数据副本。': 'The demo may change or stop. Do not use it for real business or to store the only copy of any data.',
  '正式运营前': 'Before public operation',
  '当前说明仅适用于个人演示；面向真实用户或交易前，将明确运营主体、服务地区、联系渠道、适用法律和正式服务条款。': 'This notice applies only to the personal demo. The operator, service regions, contact channels, applicable law and formal terms will be specified before accepting real users or transactions.',
});
