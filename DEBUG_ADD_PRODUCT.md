# 添加商品功能调试指南

## 当前状态

✅ 后端 API 已修复，测试通过
✅ 数据库字段已对齐（main_image）
✅ 前端代码已更新

## 测试步骤

### 方法 1: 使用测试页面（推荐）

1. **打开测试页面**：
   - 文件位置：`/Users/chenyinqi/E-commerce-website/test-add-product.html`
   - 或在浏览器打开：`file:///Users/chenyinqi/E-commerce-website/test-add-product.html`

2. **获取 Token**：
   - 点击"获取 Token"按钮
   - 应该显示"Token 获取成功！"

3. **填写商品信息**：
   - 默认值已填好，可以直接使用
   - 或修改任意字段

4. **点击"添加商品"**：
   - 成功会显示：`成功！创建成功，商品ID: XX`
   - 失败会显示具体错误信息

5. **查看浏览器控制台**：
   - 按 F12 打开开发者工具
   - 查看 Console 标签页的详细日志

### 方法 2: 使用管理后台

1. **访问管理后台**：
   ```
   http://localhost:3000/admin/login
   ```

2. **登录**：
   - 用户名：`admin`
   - 密码：`admin123`

3. **进入商品管理**：
   ```
   http://localhost:3000/admin/products
   ```

4. **点击"添加商品"按钮**（右上角蓝色按钮）

5. **填写表单**：
   - **必填项**（带 * 号）：
     - 商品标题
     - 价格
     - 分类（从下拉列表选择）
   - **可选项**：
     - 商品描述
     - 库存
     - 品牌
     - 商品图片 URL
     - 状态

6. **点击"添加商品"提交**

7. **打开浏览器开发者工具**（F12）：
   - **Console 标签**：查看 JavaScript 错误
   - **Network 标签**：查看网络请求
     - 找到 `POST /api/admin/products` 请求
     - 查看请求数据（Request）
     - 查看响应数据（Response）
     - 查看状态码（Status）

## 常见问题排查

### 问题 1: 没有任何反应

**可能原因**：
- Token 未保存或已过期
- JavaScript 错误

**解决方法**：
1. 打开浏览器控制台（F12）
2. 查看 Console 标签是否有错误
3. 重新登录获取新 Token
4. 检查 localStorage 中是否有 `admin_token`：
   ```javascript
   // 在浏览器控制台执行
   console.log(localStorage.getItem('admin_token'));
   ```

### 问题 2: 提示"请填写商品标题、价格和分类"

**可能原因**：
- 必填字段未填写

**解决方法**：
- 确保填写了商品标题、价格和分类

### 问题 3: 提交后显示错误

**可能原因**：
- 网络请求失败
- 后端返回错误

**解决方法**：
1. 打开 Network 标签
2. 找到失败的请求
3. 查看响应内容
4. 查看后端日志：
   ```bash
   cd /Users/chenyinqi/E-commerce-website
   docker-compose logs --tail=50 backend
   ```

### 问题 4: CORS 错误

**症状**：
```
Access to fetch at 'http://localhost:3001/api/admin/products' from origin 'http://localhost:3000' has been blocked by CORS policy
```

**解决方法**：
- 后端应该已经配置了 CORS
- 检查后端日志确认服务正常运行

## 手动测试 API

如果前端有问题，可以直接测试 API：

```bash
# 1. 获取 Token
TOKEN=$(curl -s -X POST http://localhost:3001/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "Token: $TOKEN"

# 2. 添加商品
curl -X POST http://localhost:3001/api/admin/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "命令行测试商品",
    "description": "通过命令行添加的测试商品",
    "price": 299.99,
    "stock": 50,
    "category_id": 1,
    "brand": "测试品牌",
    "image_url": "https://placehold.co/400x400",
    "status": 1
  }'
```

## 查看后端日志

实时查看后端日志：
```bash
cd /Users/chenyinqi/E-commerce-website
docker-compose logs -f backend
```

查看最近的日志：
```bash
docker-compose logs --tail=50 backend
```

## 验证商品是否添加成功

查看数据库中的商品：
```bash
docker-compose exec mysql mysql -uroot -proot123456 ecommerce \
  -e "SELECT product_id, title, price, brand, category_id FROM products ORDER BY product_id DESC LIMIT 5;"
```

## 前端刷新

如果修改了前端代码，需要：

1. **开发模式**（如果在用）：
   - 会自动热重载
   
2. **生产模式**（Docker）：
   ```bash
   # 重新构建前端
   docker-compose build frontend
   docker-compose up -d frontend
   
   # 等待启动完成
   sleep 10
   
   # 刷新浏览器（清除缓存：Cmd+Shift+R 或 Ctrl+Shift+R）
   ```

## 完整重启

如果以上都不行，完全重启所有服务：

```bash
cd /Users/chenyinqi/E-commerce-website

# 停止所有服务
docker-compose down

# 重新启动
docker-compose up -d

# 等待所有服务启动
sleep 15

# 检查状态
docker-compose ps
```

## 联系信息

如果问题仍然存在，请提供：
1. 浏览器控制台的错误截图（Console 标签）
2. Network 标签中失败请求的详情
3. 后端日志的相关错误

---

**最后更新**：2025-10-13

