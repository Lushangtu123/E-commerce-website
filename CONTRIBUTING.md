# 贡献指南 | Contributing Guide

感谢您对本项目的关注！我们欢迎任何形式的贡献。

**语言**: [English](#english) | [中文](#中文)

---

## 中文

### 📋 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [报告问题](#报告问题)
- [开发环境搭建](#开发环境搭建)

---

### 🤝 行为准则

参与本项目即表示您同意遵守以下行为准则：

- **尊重他人**: 对所有贡献者保持尊重和友善
- **建设性反馈**: 提供有建设性的意见和建议
- **开放心态**: 接受不同的观点和想法
- **专业态度**: 保持专业和礼貌的沟通方式

---

### 💡 如何贡献

您可以通过以下方式为项目做出贡献：

#### 1. 代码贡献
- 修复 Bug
- 添加新功能
- 优化性能
- 重构代码

#### 2. 文档贡献
- 改进文档
- 翻译文档
- 添加示例
- 修正错别字

#### 3. 测试贡献
- 编写测试用例
- 报告 Bug
- 验证修复

#### 4. 设计贡献
- UI/UX 设计改进
- 图标和素材
- 界面优化建议

---

### 🔄 开发流程

#### 1. Fork 项目

点击项目页面右上角的 "Fork" 按钮，将项目 fork 到您的 GitHub 账号。

#### 2. 克隆到本地

```bash
git clone https://github.com/YOUR_USERNAME/E-commerce-website.git
cd E-commerce-website
```

#### 3. 添加上游仓库

```bash
git remote add upstream https://github.com/Lushangtu123/E-commerce-website.git
```

#### 4. 创建开发分支

```bash
# 确保在最新的 main 分支
git checkout main
git pull upstream main

# 创建功能分支
git checkout -b feature/your-feature-name
# 或修复分支
git checkout -b fix/bug-description
```

#### 5. 进行开发

按照[代码规范](#代码规范)进行开发。

#### 6. 提交代码

```bash
git add .
git commit -m "feat: add new feature"
```

遵循[提交规范](#提交规范)。

#### 7. 推送到远程

```bash
git push origin feature/your-feature-name
```

#### 8. 创建 Pull Request

在 GitHub 上创建 Pull Request，填写详细的描述。

---

### 📝 代码规范

#### TypeScript/JavaScript

##### 命名规范

```typescript
// 变量和函数: camelCase
const userName = 'John';
function getUserInfo() {}

// 类和接口: PascalCase
class UserService {}
interface UserData {}

// 常量: UPPER_SNAKE_CASE
const API_BASE_URL = 'http://api.example.com';

// 文件名: kebab-case
// user-service.ts
// product-controller.ts
```

##### 代码风格

```typescript
// ✅ 好的写法
async function getUserById(id: number): Promise<User> {
  try {
    const user = await userModel.findById(id);
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  } catch (error) {
    console.error('Error fetching user:', error);
    throw error;
  }
}

// ❌ 不好的写法
async function getUserById(id) {
  const user = await userModel.findById(id)
  if(!user) throw new Error('User not found')
  return user
}
```

##### 类型定义

```typescript
// ✅ 使用接口定义类型
interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
}

// ✅ 使用明确的类型注解
function calculateTotal(price: number, quantity: number): number {
  return price * quantity;
}

// ❌ 避免使用 any
function processData(data: any) {} // 不推荐
```

#### React/Next.js

##### 组件规范

```tsx
// ✅ 函数组件，使用 TypeScript
interface ProductCardProps {
  product: Product;
  onAddToCart: (productId: number) => void;
}

export default function ProductCard({ product, onAddToCart }: ProductCardProps) {
  const handleClick = () => {
    onAddToCart(product.id);
  };

  return (
    <div className="product-card">
      <h3>{product.name}</h3>
      <p>${product.price}</p>
      <button onClick={handleClick}>Add to Cart</button>
    </div>
  );
}
```

##### Hooks 使用

```tsx
// ✅ 正确的 Hooks 使用
function useProductList() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const data = await productApi.list();
      setProducts(data.products);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return { products, loading, error, refetch: fetchProducts };
}
```

#### CSS/TailwindCSS

```tsx
// ✅ 使用 Tailwind 类名
<div className="flex items-center justify-between p-4 bg-white rounded-lg shadow-md">
  <h2 className="text-xl font-bold text-gray-800">Title</h2>
  <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
    Button
  </button>
</div>

// 复杂样式可以抽取
const cardStyles = "flex items-center justify-between p-4 bg-white rounded-lg shadow-md";
<div className={cardStyles}>...</div>
```

#### 后端规范

##### 路由结构

```typescript
// ✅ RESTful 风格
router.get('/api/products', getProducts);           // 获取列表
router.get('/api/products/:id', getProductById);    // 获取单个
router.post('/api/products', createProduct);        // 创建
router.put('/api/products/:id', updateProduct);     // 更新
router.delete('/api/products/:id', deleteProduct);  // 删除
```

##### 控制器规范

```typescript
// ✅ 清晰的错误处理
export async function createProduct(req: Request, res: Response) {
  try {
    const { name, price, stock } = req.body;

    // 参数验证
    if (!name || !price || stock === undefined) {
      return res.status(400).json({ error: '缺少必需参数' });
    }

    // 业务逻辑
    const product = await productModel.create({
      name,
      price,
      stock
    });

    return res.status(201).json({
      message: '创建成功',
      product
    });
  } catch (error) {
    console.error('创建产品失败:', error);
    return res.status(500).json({ error: '服务器错误' });
  }
}
```

##### 数据库操作

```typescript
// ✅ 使用参数化查询防止 SQL 注入
const [products] = await pool.execute(
  'SELECT * FROM products WHERE category_id = ? AND price <= ?',
  [categoryId, maxPrice]
);

// ✅ 使用事务处理关联操作
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  
  // 操作1
  await connection.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, productId]);
  
  // 操作2
  await connection.execute('INSERT INTO order_items ...', [...]);
  
  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
}
```

---

### 📌 提交规范

我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

#### 提交格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Type 类型

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat: add product search function` |
| `fix` | Bug 修复 | `fix: resolve cart calculation error` |
| `docs` | 文档更新 | `docs: update API documentation` |
| `style` | 代码格式（不影响功能） | `style: format code with prettier` |
| `refactor` | 代码重构 | `refactor: optimize database queries` |
| `perf` | 性能优化 | `perf: improve product list loading speed` |
| `test` | 测试相关 | `test: add unit tests for user service` |
| `chore` | 构建/工具相关 | `chore: update dependencies` |
| `ci` | CI/CD 相关 | `ci: add GitHub Actions workflow` |
| `revert` | 回滚提交 | `revert: revert commit abc123` |

#### Scope 范围（可选）

- `frontend`: 前端相关
- `backend`: 后端相关
- `api`: API 相关
- `ui`: UI 相关
- `db`: 数据库相关
- `docs`: 文档相关

#### 示例

```bash
# 新功能
git commit -m "feat(frontend): add product favorites function"

# Bug 修复
git commit -m "fix(backend): resolve JWT token expiration issue"

# 文档更新
git commit -m "docs: add environment setup guide"

# 性能优化
git commit -m "perf(api): optimize product list query with Redis cache"

# 代码重构
git commit -m "refactor(backend): extract common validation logic"
```

#### 详细描述（可选）

```bash
git commit -m "feat(cart): add bulk operations for cart items

- Add select all functionality
- Add batch delete option
- Update cart summary calculation
- Add loading states for operations

Closes #123"
```

---

### 🔀 Pull Request 流程

#### 1. PR 标题

遵循提交规范，清晰描述改动：

```
feat: add product SKU management feature
fix: resolve order status update bug
docs: improve API documentation with examples
```

#### 2. PR 描述模板

```markdown
## 改动说明
<!-- 描述你做了什么改动 -->

## 改动类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 代码重构
- [ ] 性能优化
- [ ] 文档更新
- [ ] 测试相关

## 相关 Issue
<!-- 关联相关的 Issue -->
Closes #123

## 测试
<!-- 描述如何测试这些改动 -->
- [ ] 已在本地测试
- [ ] 已添加单元测试
- [ ] 已更新相关文档

## 截图（如果适用）
<!-- 添加截图展示改动 -->

## 检查清单
- [ ] 代码遵循项目规范
- [ ] 已运行并通过所有测试
- [ ] 已更新相关文档
- [ ] 提交信息遵循规范
- [ ] 已解决所有冲突
```

#### 3. 代码审查

- 保持 PR 简洁，每次只解决一个问题
- 响应审查意见，及时更新代码
- 如有疑问，及时沟通讨论

#### 4. 合并要求

- ✅ 所有 CI 检查通过
- ✅ 至少一位维护者批准
- ✅ 解决所有审查意见
- ✅ 无合并冲突

---

### 🐛 报告问题

#### 报告 Bug

创建 Issue 时，请包含以下信息：

**Bug 报告模板：**

```markdown
## Bug 描述
<!-- 清晰简洁地描述 Bug -->

## 复现步骤
1. 访问 '...'
2. 点击 '....'
3. 滚动到 '....'
4. 看到错误

## 期望行为
<!-- 描述你期望发生什么 -->

## 实际行为
<!-- 描述实际发生了什么 -->

## 截图
<!-- 如果适用，添加截图 -->

## 环境信息
- OS: [e.g. macOS 14.0]
- Browser: [e.g. Chrome 120]
- Node.js: [e.g. 18.17.0]
- 项目版本: [e.g. 2.0.0]

## 额外信息
<!-- 其他相关信息 -->
```

#### 功能请求

**功能请求模板：**

```markdown
## 功能描述
<!-- 清晰描述你想要的功能 -->

## 使用场景
<!-- 描述这个功能的使用场景 -->

## 建议实现
<!-- 如果有实现想法，可以描述 -->

## 替代方案
<!-- 描述你考虑过的替代方案 -->

## 额外信息
<!-- 其他相关信息 -->
```

---

### 🛠️ 开发环境搭建

#### 前置要求

- Node.js 18+
- npm 或 yarn
- Docker & Docker Compose
- Git

#### 安装步骤

```bash
# 1. 克隆项目
git clone https://github.com/YOUR_USERNAME/E-commerce-website.git
cd E-commerce-website

# 2. 安装后端依赖
cd backend
npm install

# 3. 配置后端环境变量
cp .env.example .env
# 编辑 .env 文件

# 4. 安装前端依赖
cd ../frontend
npm install

# 5. 配置前端环境变量
cp .env.local.example .env.local
# 编辑 .env.local 文件

# 6. 启动 Docker 服务
cd ..
docker-compose up -d

# 7. 运行数据库迁移
cd backend
npm run migrate:dev

# 8. 启动后端服务
npm run dev

# 9. 启动前端服务（新终端）
cd ../frontend
npm run dev
```

详细步骤请查看 [快速启动指南](./QUICK_START_GUIDE.md)。

#### 开发工具推荐

- **IDE**: VS Code, WebStorm
- **VS Code 插件**:
  - ESLint
  - Prettier
  - TypeScript Vue Plugin (Volar)
  - Tailwind CSS IntelliSense
  - GitLens
- **API 测试**: Postman, Insomnia
- **数据库工具**: MySQL Workbench, DBeaver

---

### 📚 相关资源

- [项目文档](./README.md)
- [API 文档](./API.md)
- [环境配置指南](./ENV_SETUP.md)
- [快速启动指南](./QUICK_START_GUIDE.md)

---

### 💬 联系方式

如有任何问题或建议：

- 📧 提交 [Issue](https://github.com/Lushangtu123/E-commerce-website/issues)
- 💬 参与 [Discussions](https://github.com/Lushangtu123/E-commerce-website/discussions)
- 📖 查看 [文档](./README.md)

---

### 📄 许可证

通过为本项目做出贡献，您同意您的贡献将在 [MIT License](./LICENSE) 下授权。

---

## English

### 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute-1)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [Development Setup](#development-setup)

---

### 🤝 Code of Conduct

By participating in this project, you agree to abide by the following code of conduct:

- **Respect Others**: Be respectful and kind to all contributors
- **Constructive Feedback**: Provide constructive comments and suggestions
- **Open Mindedness**: Accept different viewpoints and ideas
- **Professional Attitude**: Maintain professional and polite communication

---

### 💡 How to Contribute

You can contribute to the project in the following ways:

#### 1. Code Contributions
- Fix bugs
- Add new features
- Optimize performance
- Refactor code

#### 2. Documentation
- Improve documentation
- Translate documentation
- Add examples
- Fix typos

#### 3. Testing
- Write test cases
- Report bugs
- Verify fixes

#### 4. Design
- UI/UX improvements
- Icons and assets
- Interface optimization suggestions

---

### 🔄 Development Workflow

#### 1. Fork the Project

Click the "Fork" button on the project page to fork the project to your GitHub account.

#### 2. Clone Locally

```bash
git clone https://github.com/YOUR_USERNAME/E-commerce-website.git
cd E-commerce-website
```

#### 3. Add Upstream Repository

```bash
git remote add upstream https://github.com/Lushangtu123/E-commerce-website.git
```

#### 4. Create Development Branch

```bash
# Ensure you're on the latest main branch
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/your-feature-name
# Or fix branch
git checkout -b fix/bug-description
```

#### 5. Develop

Follow the [Code Standards](#code-standards).

#### 6. Commit Code

```bash
git add .
git commit -m "feat: add new feature"
```

Follow the [Commit Guidelines](#commit-guidelines).

#### 7. Push to Remote

```bash
git push origin feature/your-feature-name
```

#### 8. Create Pull Request

Create a Pull Request on GitHub with detailed description.

---

### 📝 Code Standards

Please refer to the Chinese section above for detailed code standards, as they apply to both languages.

Key points:
- Use TypeScript for type safety
- Follow ESLint and Prettier configurations
- Use meaningful variable and function names
- Write clear comments for complex logic
- Follow RESTful API design principles

---

### 📌 Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/).

**Format:**
```
<type>(<scope>): <subject>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code formatting
- `refactor`: Code refactoring
- `perf`: Performance optimization
- `test`: Testing
- `chore`: Build/tools

**Examples:**
```bash
feat(frontend): add product favorites function
fix(backend): resolve JWT token expiration issue
docs: add environment setup guide
```

---

### 🔀 Pull Request Process

1. **Clear Title**: Follow commit conventions
2. **Detailed Description**: Use the PR template
3. **Code Review**: Respond to feedback promptly
4. **Merge Requirements**:
   - ✅ All CI checks pass
   - ✅ At least one maintainer approval
   - ✅ All review comments resolved
   - ✅ No merge conflicts

---

### 🐛 Reporting Issues

When creating an issue, please include:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Screenshots (if applicable)
- Environment information

---

### 🛠️ Development Setup

```bash
# 1. Clone the project
git clone https://github.com/YOUR_USERNAME/E-commerce-website.git
cd E-commerce-website

# 2. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 3. Configure environment variables
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local

# 4. Start Docker services
docker-compose up -d

# 5. Run migrations
cd backend && npm run migrate:dev

# 6. Start development servers
npm run dev  # backend
cd ../frontend && npm run dev  # frontend
```

For detailed setup, see [Quick Start Guide](./QUICK_START_GUIDE.md).

---

### 📚 Resources

- [Project Documentation](./README_EN.md)
- [API Documentation](./API.md)
- [Environment Setup](./ENV_SETUP.md)
- [Quick Start Guide](./QUICK_START_GUIDE.md)

---

### 💬 Contact

For questions or suggestions:

- 📧 Submit an [Issue](https://github.com/Lushangtu123/E-commerce-website/issues)
- 💬 Join [Discussions](https://github.com/Lushangtu123/E-commerce-website/discussions)
- 📖 Read the [Documentation](./README_EN.md)

---

### 📄 License

By contributing to this project, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

---

**Thank you for contributing! 感谢您的贡献！** 🎉

