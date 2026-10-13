# 安全策略 | Security Policy

本文档说明了项目的安全策略和漏洞报告流程。

**版本**: 2.0.0  
**最后更新**: 2025年10月31日

---

## 📋 目录

- [支持的版本](#支持的版本)
- [报告漏洞](#报告漏洞)
- [安全特性](#安全特性)
- [已知限制](#已知限制)
- [安全最佳实践](#安全最佳实践)
- [安全更新](#安全更新)

---

## 🔖 支持的版本

我们为以下版本提供安全更新：

| 版本 | 支持状态 | 说明 |
|------|---------|------|
| 2.x.x | ✅ 支持 | 当前版本，积极维护 |
| 1.x.x | ⚠️ 有限支持 | 仅关键安全修复 |
| < 1.0 | ❌ 不支持 | 请升级到最新版本 |

---

## 🚨 报告漏洞

### 如何报告

如果您发现了安全漏洞，请**不要**公开发布。请通过以下方式私下报告：

#### 1. 通过 GitHub Security Advisory

1. 访问项目的 [Security](https://github.com/Lushangtu123/E-commerce-website/security) 页面
2. 点击 "Report a vulnerability"
3. 填写详细的漏洞信息

#### 2. 通过邮件

发送邮件至：**security@example.com** (请替换为实际邮箱)

邮件主题：`[SECURITY] 漏洞报告 - [简短描述]`

### 报告内容

请在报告中包含以下信息：

```markdown
## 漏洞描述
[清晰描述漏洞]

## 漏洞类型
- [ ] SQL 注入
- [ ] XSS (跨站脚本)
- [ ] CSRF (跨站请求伪造)
- [ ] 认证绕过
- [ ] 权限提升
- [ ] 信息泄露
- [ ] 其他: [请说明]

## 影响范围
- 受影响的版本: [e.g., 2.0.0]
- 受影响的组件: [e.g., 用户登录模块]
- 严重程度: [低/中/高/严重]

## 复现步骤
1. [步骤1]
2. [步骤2]
3. [步骤3]

## 概念验证 (PoC)
[如果有，请提供PoC代码或截图]

## 建议修复方案
[如果有建议，请提供]

## 您的联系方式
- 姓名: [可选]
- Email: [必填]
- GitHub: [可选]
```

### 响应时间

我们承诺：

- **24小时内**：确认收到报告
- **72小时内**：初步评估并回复
- **7天内**：提供详细的处理计划
- **30天内**：发布修复补丁（视严重程度而定）

### 致谢

我们会在安全公告中感谢负责任地披露漏洞的研究人员（除非您希望匿名）。

---

## 🛡️ 安全特性

密钥轮换步骤与第三方渗透测试的准备见 [docs/KEY_ROTATION.md](docs/KEY_ROTATION.md)。

### 1. 认证与授权

#### JWT Token 认证

```typescript
// Token 生成
const token = jwt.sign(
  { userId: user.id, email: user.email },
  process.env.JWT_SECRET,
  { 
    expiresIn: '7d',
    algorithm: 'HS256'
  }
);

// Token 验证
const decoded = jwt.verify(token, process.env.JWT_SECRET);
```

**安全措施**:
- ✅ 使用强随机密钥（256位）
- ✅ Token 有效期限制（7天）
- ✅ 安全的存储方式（localStorage/httpOnly cookie）
- ✅ Token 刷新机制

#### 密码安全

```typescript
// 密码加密
const hashedPassword = await bcrypt.hash(password, 10);

// 密码验证
const isValid = await bcrypt.compare(password, hashedPassword);
```

**安全措施**:
- ✅ Bcrypt 加密（10轮salt）
- ✅ 密码强度要求（最少8位）
- ✅ 密码不以明文存储
- ✅ 密码不在日志中记录

### 2. SQL 注入防护

```typescript
// ✅ 使用参数化查询
const [users] = await pool.execute(
  'SELECT * FROM users WHERE email = ?',
  [email]
);

// ❌ 避免字符串拼接
const query = `SELECT * FROM users WHERE email = '${email}'`; // 危险！
```

**安全措施**:
- ✅ 所有查询使用参数化
- ✅ 使用 mysql2 prepared statements
- ✅ 输入验证和清理
- ✅ 最小权限原则（数据库用户权限）

### 3. XSS 防护

```typescript
// 前端
import DOMPurify from 'dompurify';
const clean = DOMPurify.sanitize(userInput);

// 后端
app.use(helmet());
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    scriptSrc: ["'self'"],
    imgSrc: ["'self'", "data:", "https:"]
  }
}));
```

**安全措施**:
- ✅ 输出转义
- ✅ Content Security Policy (CSP)
- ✅ X-XSS-Protection header
- ✅ 输入验证

### 4. CSRF 防护

```typescript
// CORS 配置
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

**安全措施**:
- ✅ CORS 白名单
- ✅ SameSite Cookie 属性
- ✅ 自定义请求头验证
- ✅ Referer 检查

### 5. 限流与防暴力破解

```typescript
// 全局限流
const limiter = rateLimit({
  windowMs: 60 * 1000,     // 1分钟
  max: 100,                 // 最多100次请求
  message: '请求过于频繁，请稍后再试'
});

// 登录限流
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 5,                    // 最多5次尝试
  skipSuccessfulRequests: true
});

app.use('/api/', limiter);
app.use('/api/users/login', loginLimiter);
```

**安全措施**:
- ✅ IP 限流
- ✅ 用户级别限流
- ✅ 登录失败锁定
- ✅ 验证码机制（计划中）

### 6. 数据加密

```typescript
// 敏感数据加密
const crypto = require('crypto');

function encrypt(text: string): string {
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.ENCRYPTION_KEY, 'hex'),
    iv
  );
  // ...
}

function decrypt(encrypted: string): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.ENCRYPTION_KEY, 'hex'),
    iv
  );
  // ...
}
```

**安全措施**:
- ✅ HTTPS 传输加密
- ✅ 数据库连接加密
- ✅ 敏感字段加密存储
- ✅ 密钥安全管理

### 7. 文件上传安全

```typescript
const multer = require('multer');

const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024  // 5MB
  },
  fileFilter: (req, file, cb) => {
    // 白名单验证
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型'));
    }
  }
});
```

**安全措施**:
- ✅ 文件类型白名单
- ✅ 文件大小限制
- ✅ 文件名清理
- ✅ 病毒扫描（计划中）

### 8. 会话管理

```typescript
// Redis 会话存储
await redis.setex(
  `session:${userId}`,
  7 * 24 * 60 * 60,  // 7天
  JSON.stringify(sessionData)
);

// 会话失效
await redis.del(`session:${userId}`);
```

**安全措施**:
- ✅ 会话超时
- ✅ 会话固定攻击防护
- ✅ 登出时清除会话
- ✅ 并发会话限制

### 9. 安全响应头

```typescript
app.use(helmet({
  contentSecurityPolicy: true,
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: true,
  dnsPrefetchControl: true,
  frameguard: true,
  hidePoweredBy: true,
  hsts: true,
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: true,
  referrerPolicy: true,
  xssFilter: true
}));
```

**响应头**:
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
```

### 10. 日志与监控

```typescript
// 安全事件日志
logger.security({
  event: 'login_failed',
  userId: userId,
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  timestamp: new Date()
});

// 异常检测
if (failedAttempts > 5) {
  logger.alert({
    event: 'brute_force_detected',
    ip: req.ip,
    attempts: failedAttempts
  });
}
```

**监控内容**:
- ✅ 登录失败
- ✅ 权限拒绝
- ✅ 异常访问模式
- ✅ 错误率飙升

---

## ⚠️ 已知限制

### 当前版本的限制

1. **支付安全**
   - ⚠️ 当前使用模拟支付
   - 📝 生产环境需集成真实支付网关

2. **文件上传**
   - ⚠️ 未实现病毒扫描
   - 📝 建议使用云存储服务

3. **验证码**
   - ⚠️ 未实现图形验证码
   - 📝 高频操作建议添加验证码

4. **双因素认证**
   - ⚠️ 未实现 2FA
   - 📝 敏感操作建议添加 2FA

5. **审计日志**
   - ⚠️ 日志保留期限有限
   - 📝 建议使用专业日志服务

### 不在范围内的安全问题

以下不被视为安全漏洞：

- ❌ 演示/测试环境的问题
- ❌ 需要物理访问的攻击
- ❌ 社会工程学攻击
- ❌ 拒绝服务攻击（DDoS）
- ❌ 已知的第三方依赖漏洞（我们会定期更新）

---

## 🔐 安全最佳实践

### 开发者指南

#### 1. 环境变量安全

```bash
# ✅ 使用强随机密钥
JWT_SECRET=$(openssl rand -hex 32)

# ❌ 不要使用弱密钥
JWT_SECRET=secret123  # 危险！

# ✅ 不同环境使用不同密钥
# .env.development
JWT_SECRET=dev_key_xxx

# .env.production
JWT_SECRET=prod_key_yyy
```

#### 2. 依赖管理

```bash
# 定期检查漏洞
npm audit

# 自动修复
npm audit fix

# 更新依赖
npm update

# 检查过时的包
npm outdated
```

#### 3. 代码审查清单

- [ ] 所有用户输入都经过验证
- [ ] 使用参数化查询
- [ ] 敏感数据已加密
- [ ] 错误信息不泄露敏感信息
- [ ] 权限检查到位
- [ ] 日志不包含敏感信息
- [ ] HTTPS 强制使用
- [ ] 安全响应头已设置

#### 4. 数据库安全

```sql
-- ✅ 使用最小权限
CREATE USER 'ecommerce'@'localhost' IDENTIFIED BY 'strong_password';
GRANT SELECT, INSERT, UPDATE, DELETE ON ecommerce.* TO 'ecommerce'@'localhost';

-- ❌ 避免使用 root 用户
-- ❌ 避免授予 ALL PRIVILEGES
```

#### 5. 错误处理

```typescript
// ✅ 安全的错误处理
try {
  // ...
} catch (error) {
  logger.error('Database error', { error: error.message });
  return res.status(500).json({ 
    error: '服务器错误，请稍后重试' 
  });
}

// ❌ 不要暴露详细错误
catch (error) {
  return res.status(500).json({ 
    error: error.stack  // 危险！泄露堆栈信息
  });
}
```

### 部署指南

#### 1. HTTPS 配置

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}

# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name example.com;
    return 301 https://$server_name$request_uri;
}
```

#### 2. 防火墙配置

```bash
# 只开放必要端口
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
ufw enable
```

#### 3. 数据库备份

```bash
# 定期备份
0 2 * * * /usr/bin/mysqldump -u backup_user -p'password' ecommerce > /backup/ecommerce_$(date +\%Y\%m\%d).sql

# 加密备份
mysqldump ... | gpg --encrypt --recipient admin@example.com > backup.sql.gpg
```

#### 4. 日志管理

```bash
# 日志轮转
/var/log/ecommerce/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
}
```

---

## 🔄 安全更新

### 更新历史

| 日期 | 版本 | 类型 | 描述 |
|------|------|------|------|
| 2025-10-31 | 2.0.0 | 功能 | 初始安全策略发布 |
| - | - | - | - |

### 订阅更新

关注以下渠道获取安全更新：

- 📧 [GitHub Watch](https://github.com/Lushangtu123/E-commerce-website/subscription)
- 📢 [Release Notes](https://github.com/Lushangtu123/E-commerce-website/releases)
- 🔔 [Security Advisories](https://github.com/Lushangtu123/E-commerce-website/security/advisories)

---

## 📚 安全资源

### 参考文档

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

### 安全工具

- **代码扫描**: [Snyk](https://snyk.io/), [SonarQube](https://www.sonarqube.org/)
- **依赖检查**: `npm audit`, [Dependabot](https://github.com/dependabot)
- **渗透测试**: [OWASP ZAP](https://www.zaproxy.org/), [Burp Suite](https://portswigger.net/burp)
- **密码管理**: [1Password](https://1password.com/), [Bitwarden](https://bitwarden.com/)

---

## 📞 联系方式

### 安全团队

- 📧 Email: security@example.com
- 🔒 PGP Key: [公钥链接]
- 💬 GitHub: [@security-team](https://github.com/security-team)

### 紧急联系

对于严重的安全问题，请立即联系：

- 📱 电话: +86-xxx-xxxx-xxxx
- 💬 Telegram: @security_team

---

## 📄 许可证

本安全策略遵循项目的 [MIT License](./LICENSE)。

---

**感谢您帮助我们保持项目安全！** 🙏

**最后更新**: 2025年10月31日  
**版本**: 2.0.0


