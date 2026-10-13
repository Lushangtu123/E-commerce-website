import { registerTranslations } from '@/lib/i18n';
import type { InfoSection } from '@/components/InfoPage';

/**
 * Privacy policy and user agreement (PIPL arts. 7, 17). Every line is a dictionary key; the English text is
 * registered here so it only ships with these pages. Keep the facts in step with the code: what is collected,
 * the processors used, the retention periods (backend data-retention job) and the rights the account pages offer.
 * Have both texts reviewed by counsel before relying on them.
 */
export const LEGAL_UPDATED = '更新日期：2026年10月13日';

export const PRIVACY_POLICY: { title: string; intro: string; sections: InfoSection[] } = {
  title: '隐私政策',
  intro: '本政策说明本网站如何收集、使用、存储和保护你的个人信息，以及你享有的权利。使用本网站即表示你已阅读并理解本政策。',
  sections: [
    { title: '我们收集的信息', body: [
      '账户信息：注册时的用户名、邮箱和密码（仅保存不可逆的加密哈希），以及你选择填写的手机号和头像地址。',
      '交易信息：收货人姓名、电话和地址，订单、支付状态、物流、售后申请和评价。',
      '使用记录：你浏览过的商品、搜索关键词、购物车、收藏和领取的优惠券。',
      '安全日志：服务器为安全和排错记录请求的 IP 地址、时间和访问路径，按托管平台的日志保留期自动删除。',
    ] },
    { title: '我们如何使用信息', body: [
      '提供购物服务：登录、下单、配送、售后和找回密码。',
      '个性化推荐与搜索：根据你的浏览和搜索记录推荐商品，你可以随时删除这些记录。',
      '安全与改进：防止欺诈和滥用、排查故障，以及统计匿名化的页面访问情况。',
    ] },
    { title: 'Cookie 与本地存储', body: [
      '登录状态保存在仅限服务器读取的 Cookie 中；浏览器本地存储只保存登录会话编号和账户资料的副本，退出登录时清除。',
      '页面访问统计使用 Vercel Analytics 与 Speed Insights，不设置跟踪 Cookie，上报前会去掉网址中的查询参数。',
    ] },
    { title: '委托处理与数据出境', body: [
      '为运行本网站，我们委托以下服务商处理数据：Vercel（网站托管与访问统计）、Aiven（数据库）、Upstash（缓存）、邮件服务商（发送找回密码邮件），以及在启用时的 Sentry（错误报告，不含个人信息）。',
      '上述服务的服务器可能位于中国境外。我们与服务商约定其仅按我们的指示处理数据，并采取必要的安全措施；向境外提供个人信息前，我们会依法履行告知并取得你的单独同意等义务。',
      '除法律法规要求或你的明确同意外，我们不会向第三方出售或提供你的个人信息。',
    ] },
    { title: '保存期限', body: [
      '浏览记录与搜索记录保存 180 天，到期自动删除。',
      '密码重置链接在失效后删除。',
      '订单、售后和支付相关信息依照《电子商务法》自交易完成之日起保存三年。',
      '账户信息保存到你注销账号为止。',
    ] },
    { title: '你的权利', body: [
      '查阅与复制：在“个人设置”中导出你的全部个人信息（JSON 文件）。',
      '更正：在“个人设置”中修改用户名、手机号和头像。',
      '删除：可删除收货地址、浏览与搜索记录，或注销账号；注销后我们删除你的个人信息，交易记录按法律要求保留并不再关联你的身份。',
      '撤回同意与咨询：通过本页的联系方式联系我们，我们会在十五个工作日内答复。',
    ] },
    { title: '信息安全', body: [
      '我们使用加密传输（HTTPS）、密码哈希、访问权限控制和操作审计，并定期备份数据和演练恢复。',
      '如发生个人信息泄露，我们会依法采取补救措施并通知你和监管部门。',
    ] },
    { title: '未成年人', body: [
      '本网站不面向十四周岁以下的儿童。若你未满十四周岁，请在监护人同意和指导下使用。',
    ] },
    { title: '政策更新', body: [
      '政策发生重大变化时，我们会在网站显著位置通知你。',
      LEGAL_UPDATED,
    ] },
  ],
};

export const USER_AGREEMENT: { title: string; intro: string; sections: InfoSection[] } = {
  title: '用户协议',
  intro: '本协议是你与本网站运营方之间关于使用本网站服务的约定。注册或使用本网站即表示你同意本协议。',
  sections: [
    { title: '账户', body: [
      '你应提供真实、有效的注册信息，并妥善保管密码；通过你的账户进行的操作视为你本人的行为。',
      '发现账户被盗用时，请立即修改密码并联系我们。你可以随时在“个人设置”中注销账号。',
    ] },
    { title: '订单与价格', body: [
      '商品价格、库存和优惠以下单时页面显示为准；订单提交后，我们按订单信息安排发货。',
      '因系统故障导致价格明显错误时，我们可以取消相关订单并全额退款。',
    ] },
    { title: '支付', body: [
      '本网站当前处于演示模式，不会实际扣款；接入正式支付后，以支付页面的提示为准。',
    ] },
    { title: '配送与售后', body: [
      '配送和退换货按“配送说明”和“退换货政策”执行，并适用《消费者权益保护法》关于网购商品七日无理由退货等规定。',
    ] },
    { title: '用户行为', body: [
      '你发布的评价应真实、合法，不得含有侵权、违法或广告内容；违规内容可能被删除。',
      '不得利用本网站从事违法活动，或以技术手段干扰网站的正常运行。',
    ] },
    { title: '责任', body: [
      '我们努力保证服务连续和信息准确，但在不可抗力或第三方原因导致服务中断时，在法律允许的范围内不承担责任。',
    ] },
    { title: '法律适用与争议', body: [
      '本协议适用中华人民共和国法律。发生争议时，双方应先协商；协商不成的，可向运营方所在地有管辖权的人民法院起诉。',
      LEGAL_UPDATED,
    ] },
  ],
};

registerTranslations({
  [LEGAL_UPDATED]: 'Last updated: October 13, 2026',
  '本政策说明本网站如何收集、使用、存储和保护你的个人信息，以及你享有的权利。使用本网站即表示你已阅读并理解本政策。':
    'This policy explains how this site collects, uses, stores and protects your personal information, and the rights you have. By using the site you confirm that you have read and understood it.',
  '我们收集的信息': 'Information we collect',
  '账户信息：注册时的用户名、邮箱和密码（仅保存不可逆的加密哈希），以及你选择填写的手机号和头像地址。':
    'Account: the username, email and password you register with (only an irreversible hash of the password is stored), and the phone number and avatar URL you choose to add.',
  '交易信息：收货人姓名、电话和地址，订单、支付状态、物流、售后申请和评价。':
    'Transactions: recipient name, phone and address; orders, payment status, shipping, after-sales requests and reviews.',
  '使用记录：你浏览过的商品、搜索关键词、购物车、收藏和领取的优惠券。':
    'Activity: products you viewed, search keywords, your cart, favorites and claimed coupons.',
  '安全日志：服务器为安全和排错记录请求的 IP 地址、时间和访问路径，按托管平台的日志保留期自动删除。':
    'Security logs: for security and troubleshooting the servers record the IP address, time and path of requests; they are deleted automatically under the hosting platform\'s log retention.',
  '我们如何使用信息': 'How we use it',
  '提供购物服务：登录、下单、配送、售后和找回密码。': 'To provide the store: sign-in, orders, delivery, after-sales and password recovery.',
  '个性化推荐与搜索：根据你的浏览和搜索记录推荐商品，你可以随时删除这些记录。':
    'Recommendations and search: products are suggested from your browsing and search history, which you can delete at any time.',
  '安全与改进：防止欺诈和滥用、排查故障，以及统计匿名化的页面访问情况。':
    'Security and improvement: preventing fraud and abuse, fixing faults and measuring anonymized page visits.',
  'Cookie 与本地存储': 'Cookies and local storage',
  '登录状态保存在仅限服务器读取的 Cookie 中；浏览器本地存储只保存登录会话编号和账户资料的副本，退出登录时清除。':
    'Your sign-in is kept in a cookie only the server can read. Browser storage holds just the session ID and a copy of your profile, cleared when you sign out.',
  '页面访问统计使用 Vercel Analytics 与 Speed Insights，不设置跟踪 Cookie，上报前会去掉网址中的查询参数。':
    'Page statistics use Vercel Analytics and Speed Insights without tracking cookies; query strings are removed from URLs before anything is sent.',
  '委托处理与数据出境': 'Processors and cross-border transfer',
  '为运行本网站，我们委托以下服务商处理数据：Vercel（网站托管与访问统计）、Aiven（数据库）、Upstash（缓存）、邮件服务商（发送找回密码邮件），以及在启用时的 Sentry（错误报告，不含个人信息）。':
    'To run this site we use these processors: Vercel (hosting and page statistics), Aiven (database), Upstash (cache), an email provider (password-recovery emails) and, when enabled, Sentry (error reports without personal information).',
  '上述服务的服务器可能位于中国境外。我们与服务商约定其仅按我们的指示处理数据，并采取必要的安全措施；向境外提供个人信息前，我们会依法履行告知并取得你的单独同意等义务。':
    'Their servers may be located outside mainland China. They process data only on our instructions and under the necessary safeguards; before personal information is provided abroad we inform you and obtain your separate consent as the law requires.',
  '除法律法规要求或你的明确同意外，我们不会向第三方出售或提供你的个人信息。':
    'We do not sell or provide your personal information to third parties unless the law requires it or you explicitly agree.',
  '保存期限': 'Retention',
  '浏览记录与搜索记录保存 180 天，到期自动删除。': 'Browsing and search history are kept for 180 days and then deleted automatically.',
  '密码重置链接在失效后删除。': 'Password-reset links are deleted once they expire.',
  '订单、售后和支付相关信息依照《电子商务法》自交易完成之日起保存三年。':
    'Orders, after-sales and payment records are kept for three years after the transaction completes, as the E-Commerce Law requires.',
  '账户信息保存到你注销账号为止。': 'Account information is kept until you delete your account.',
  '你的权利': 'Your rights',
  '查阅与复制：在“个人设置”中导出你的全部个人信息（JSON 文件）。': 'Access and copy: export all of your personal data from Profile settings (JSON file).',
  '更正：在“个人设置”中修改用户名、手机号和头像。': 'Correction: change your username, phone number and avatar in Profile settings.',
  '删除：可删除收货地址、浏览与搜索记录，或注销账号；注销后我们删除你的个人信息，交易记录按法律要求保留并不再关联你的身份。':
    'Deletion: delete addresses or browsing and search history, or delete your account. Deleting the account removes your personal information; transaction records are kept as the law requires and no longer identify you.',
  '撤回同意与咨询：通过本页的联系方式联系我们，我们会在十五个工作日内答复。':
    'Withdrawing consent and questions: contact us using the details on this page; we reply within fifteen working days.',
  '信息安全': 'Security',
  '我们使用加密传输（HTTPS）、密码哈希、访问权限控制和操作审计，并定期备份数据和演练恢复。':
    'We use encrypted transport (HTTPS), password hashing, access control and audit logs, and back up data and rehearse restores regularly.',
  '如发生个人信息泄露，我们会依法采取补救措施并通知你和监管部门。':
    'If personal information is leaked we take remedial action and notify you and the regulator as the law requires.',
  '未成年人': 'Children',
  '本网站不面向十四周岁以下的儿童。若你未满十四周岁，请在监护人同意和指导下使用。':
    'This site is not directed at children under fourteen. If you are under fourteen, use it only with a guardian\'s consent and guidance.',
  '政策更新': 'Changes',
  '政策发生重大变化时，我们会在网站显著位置通知你。': 'We will announce material changes prominently on the site.',
  '本协议是你与本网站运营方之间关于使用本网站服务的约定。注册或使用本网站即表示你同意本协议。':
    'This agreement governs your use of this site between you and its operator. By registering or using the site you accept it.',
  '账户': 'Account',
  '你应提供真实、有效的注册信息，并妥善保管密码；通过你的账户进行的操作视为你本人的行为。':
    'Provide accurate registration details and keep your password safe; actions taken with your account are treated as your own.',
  '发现账户被盗用时，请立即修改密码并联系我们。你可以随时在“个人设置”中注销账号。':
    'If your account is misused, change your password and contact us at once. You can delete your account at any time in Profile settings.',
  '订单与价格': 'Orders and prices',
  '商品价格、库存和优惠以下单时页面显示为准；订单提交后，我们按订单信息安排发货。':
    'Prices, stock and discounts are those shown when you place the order; we ship according to the order details.',
  '因系统故障导致价格明显错误时，我们可以取消相关订单并全额退款。':
    'If a system fault produces an obviously wrong price, we may cancel the order and refund it in full.',
  '支付': 'Payment',
  '本网站当前处于演示模式，不会实际扣款；接入正式支付后，以支付页面的提示为准。':
    'The site is currently in demonstration mode and takes no real payments; once real payments are enabled, the payment page applies.',
  '配送与售后': 'Delivery and after-sales',
  '配送和退换货按“配送说明”和“退换货政策”执行，并适用《消费者权益保护法》关于网购商品七日无理由退货等规定。':
    'Delivery and returns follow the Shipping and Returns pages, together with the Consumer Rights Protection Law, including the seven-day no-reason return for online purchases.',
  '用户行为': 'Conduct',
  '你发布的评价应真实、合法，不得含有侵权、违法或广告内容；违规内容可能被删除。':
    'Reviews must be truthful and lawful, without infringing, illegal or advertising content; violating content may be removed.',
  '不得利用本网站从事违法活动，或以技术手段干扰网站的正常运行。': 'Do not use the site for illegal activities or interfere with its operation by technical means.',
  '责任': 'Liability',
  '我们努力保证服务连续和信息准确，但在不可抗力或第三方原因导致服务中断时，在法律允许的范围内不承担责任。':
    'We work to keep the service available and accurate but, as far as the law allows, are not liable for interruptions caused by force majeure or third parties.',
  '法律适用与争议': 'Governing law and disputes',
  '本协议适用中华人民共和国法律。发生争议时，双方应先协商；协商不成的，可向运营方所在地有管辖权的人民法院起诉。':
    'This agreement is governed by the laws of the People\'s Republic of China. Disputes are first settled by negotiation; failing that, either party may sue in the competent people\'s court where the operator is located.',
});
