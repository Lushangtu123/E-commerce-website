# 前端更新说明 | Frontend Update

**更新日期**: 2025年10月31日  
**版本**: 2.1.0  
**类型**: 功能更新

---

## 🎯 更新目标

集成后端新增的推荐系统和订单超时功能，提升用户购物体验。

---

## ✨ 新增功能

### 1. 推荐系统前端集成

#### 1.1 API 接口集成

**文件**: `frontend/src/lib/api.ts`

新增接口:
```typescript
// 推荐相关API
export const recommendationApi = {
  // 个性化推荐（需要登录）
  getPersonalized: (limit?: number) => 
    api.get('/recommendations/personalized', { params: { limit } }),
  
  // 相关商品推荐
  getRelated: (productId: number, limit?: number) => 
    api.get(`/recommendations/related/${productId}`, { params: { limit } }),
  
  // 猜你喜欢（可选登录）
  getGuessYouLike: (limit?: number) => 
    api.get('/recommendations/guess-you-like', { params: { limit } }),
};

// 订单超时相关API
export const orderTimeoutApi = {
  // 获取订单剩余支付时间
  getRemainingTime: (orderId: number) => 
    api.get(`/orders/${orderId}/remaining-time`),
};
```

#### 1.2 商品详情页 - 相关推荐

**文件**: `frontend/src/app/products/[id]/page.tsx`

**功能**:
- 在商品详情下方展示"相关推荐"板块
- 显示4个相关商品
- 同分类、价格相近的商品
- 使用 ProductCard 组件统一展示

**实现**:
```typescript
const [relatedProducts, setRelatedProducts] = useState<any[]>([]);
const [loadingRecommendations, setLoadingRecommendations] = useState(false);

const loadRelatedProducts = async () => {
  try {
    setLoadingRecommendations(true);
    const data: any = await recommendationApi.getRelated(productId, 4);
    setRelatedProducts(data.related_products || []);
  } catch (error) {
    console.error('加载相关推荐失败:', error);
  } finally {
    setLoadingRecommendations(false);
  }
};
```

**UI 展示**:
```tsx
{relatedProducts.length > 0 && (
  <div className="card p-6">
    <h2 className="text-2xl font-bold mb-6">相关推荐</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {relatedProducts.map((relatedProduct) => (
        <ProductCard key={relatedProduct.product_id} product={relatedProduct} />
      ))}
    </div>
  </div>
)}
```

#### 1.3 首页 - 猜你喜欢

**文件**: `frontend/src/app/page.tsx`

**功能**:
- 首页新增"猜你喜欢"板块
- 已登录用户: 基于浏览历史的个性化推荐
- 未登录用户: 热门商品推荐
- 展示8个推荐商品
- 响应式网格布局

**实现**:
```typescript
const [recommendations, setRecommendations] = useState<any[]>([]);
const [loadingRecommendations, setLoadingRecommendations] = useState(false);

const loadRecommendations = async () => {
  try {
    setLoadingRecommendations(true);
    const data: any = await recommendationApi.getGuessYouLike(8);
    setRecommendations(data.recommendations || []);
  } catch (error: any) {
    console.error('加载推荐失败:', error);
  } finally {
    setLoadingRecommendations(false);
  }
};
```

**UI 展示**:
```tsx
{recommendations.length > 0 && (
  <section className="py-12">
    <div className="container-custom">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold">猜你喜欢</h2>
          <p className="text-gray-600 mt-2">
            {isAuthenticated ? '基于您的浏览历史为您推荐' : '热门商品推荐'}
          </p>
        </div>
        <Link href="/products">查看更多 →</Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {recommendations.map((product) => (
          <ProductCard key={product.product_id} product={product} />
        ))}
      </div>
    </div>
  </section>
)}
```

### 2. 订单超时倒计时

#### 2.1 订单详情页 - 支付倒计时

**文件**: `frontend/src/app/orders/[id]/page.tsx`

**功能**:
- 待支付订单显示剩余支付时间
- 每分钟自动更新倒计时
- 倒计时归零时显示超时提示
- 自动刷新订单状态

**实现**:
```typescript
const [remainingTime, setRemainingTime] = useState<number | null>(null);

// 加载剩余时间
const loadRemainingTime = async () => {
  try {
    const data: any = await orderTimeoutApi.getRemainingTime(orderId);
    setRemainingTime(data.remaining_minutes);
    
    // 如果剩余时间为0，刷新订单状态
    if (data.remaining_minutes === 0) {
      loadOrder();
    }
  } catch (error: any) {
    console.error('加载剩余时间失败:', error);
  }
};

// 定时更新
useEffect(() => {
  if (order && order.status === 0) {
    loadRemainingTime();
    const interval = setInterval(loadRemainingTime, 60000); // 每分钟
    return () => clearInterval(interval);
  }
}, [order]);
```

**UI 展示**:
```tsx
{order.status === 0 && remainingTime !== null && remainingTime > 0 && (
  <div className="mt-2 text-orange-600 text-sm">
    ⏰ 剩余支付时间: {remainingTime} 分钟
  </div>
)}
{order.status === 0 && remainingTime === 0 && (
  <div className="mt-2 text-red-600 text-sm">
    ⚠️ 订单已超时，即将自动取消
  </div>
)}
```

---

## 📊 代码统计

### 修改文件

| 文件 | 变更类型 | 新增行数 | 说明 |
|------|---------|---------|------|
| `frontend/src/lib/api.ts` | 新增 | +23 | 推荐和超时API |
| `frontend/src/app/products/[id]/page.tsx` | 修改 | +35 | 相关推荐板块 |
| `frontend/src/app/page.tsx` | 修改 | +58 | 猜你喜欢板块 |
| `frontend/src/app/orders/[id]/page.tsx` | 修改 | +36 | 支付倒计时 |
| **总计** | **4个文件** | **+152行** | |

---

## 🎨 UI/UX 优化

### 1. 响应式设计

所有推荐板块都采用响应式网格布局:
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
```

- 移动端: 1列
- 平板: 2列
- 桌面: 4列

### 2. 加载状态

所有数据加载都有友好的加载提示:
```tsx
{loadingRecommendations ? (
  <div className="text-center py-12 text-gray-500">
    加载中...
  </div>
) : (
  // 商品列表
)}
```

### 3. 骨架屏

首页推荐板块使用骨架屏效果:
```tsx
<div className="card animate-pulse">
  <div className="bg-gray-300 h-64 w-full"></div>
  <div className="p-4 space-y-3">
    <div className="h-4 bg-gray-300 rounded w-3/4"></div>
    <div className="h-4 bg-gray-300 rounded w-1/2"></div>
  </div>
</div>
```

### 4. 倒计时动态更新

- 每分钟自动更新
- 实时显示剩余时间
- 超时自动刷新

---

## 🔌 API 调用流程

### 1. 商品详情页推荐

```
用户访问商品详情页
    ↓
加载商品信息
    ↓
调用 recommendationApi.getRelated(productId)
    ↓
展示相关推荐商品
```

### 2. 首页推荐

```
用户访问首页
    ↓
检查登录状态
    ↓
调用 recommendationApi.getGuessYouLike()
    ↓
后端返回:
  - 已登录: 个性化推荐
  - 未登录: 热门商品
    ↓
展示猜你喜欢商品
```

### 3. 订单倒计时

```
用户访问订单详情
    ↓
检查订单状态
    ↓
如果是待支付 (status = 0):
  ├─ 调用 orderTimeoutApi.getRemainingTime(orderId)
  ├─ 显示剩余时间
  ├─ 每分钟更新一次
  └─ 如果剩余时间为0，刷新订单状态
```

---

## 🧪 测试要点

### 功能测试

#### 1. 相关推荐测试

- [ ] 商品详情页是否显示相关推荐
- [ ] 相关推荐商品是否为同分类
- [ ] 点击推荐商品能否正常跳转
- [ ] 加载状态显示是否正常

#### 2. 猜你喜欢测试

- [ ] 首页是否显示猜你喜欢板块
- [ ] 未登录用户是否显示热门商品
- [ ] 已登录用户是否显示个性化推荐
- [ ] 推荐商品数量是否正确（8个）

#### 3. 订单倒计时测试

- [ ] 待支付订单是否显示倒计时
- [ ] 倒计时是否每分钟更新
- [ ] 超时是否显示提示
- [ ] 超时后订单状态是否自动更新

### 兼容性测试

- [ ] 桌面浏览器 (Chrome, Firefox, Safari)
- [ ] 移动端浏览器
- [ ] 不同屏幕尺寸
- [ ] 深色/浅色模式

### 性能测试

- [ ] 页面加载时间
- [ ] API 响应时间
- [ ] 骨架屏显示效果
- [ ] 图片加载优化

---

## 🚀 部署说明

### 1. 环境变量

确保 `NEXT_PUBLIC_API_URL` 正确配置:

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:3001/api  # 开发环境
# NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api  # 生产环境
```

### 2. 构建前端

```bash
cd frontend
npm install
npm run build
npm run start
```

### 3. 验证功能

```bash
# 访问首页，检查猜你喜欢
http://localhost:3000

# 访问商品详情，检查相关推荐
http://localhost:3000/products/1

# 访问订单详情，检查倒计时
http://localhost:3000/orders/1
```

---

## 📝 用户使用说明

### 首页推荐

1. 访问首页
2. 向下滚动到"猜你喜欢"板块
3. 已登录用户会看到基于浏览历史的推荐
4. 未登录用户会看到热门商品

### 商品详情页推荐

1. 点击任意商品进入详情页
2. 向下滚动到评论区下方
3. 查看"相关推荐"板块
4. 点击推荐商品可查看详情

### 订单支付倒计时

1. 创建订单后进入订单详情页
2. 在订单状态区域查看剩余支付时间
3. 倒计时会每分钟自动更新
4. 超时后系统会自动取消订单

---

## 💡 技术亮点

### 1. 智能推荐

- 已登录用户基于浏览历史推荐
- 未登录用户显示热门商品
- 相关推荐考虑分类和价格因素

### 2. 实时更新

- 订单倒计时每分钟自动更新
- 超时自动刷新订单状态
- 无需手动刷新页面

### 3. 用户体验

- 响应式设计适配各种设备
- 骨架屏提升感知性能
- 友好的加载和错误提示

### 4. 代码质量

- TypeScript 类型安全
- 组件复用（ProductCard）
- 清晰的状态管理
- 良好的错误处理

---

## 🔄 后续优化建议

### 短期（1周内）

1. **性能优化**
   - 实现推荐结果缓存
   - 图片懒加载
   - 虚拟滚动（长列表）

2. **用户体验**
   - 添加推荐理由说明
   - 点击推荐商品记录事件
   - 支持推荐商品快速加购

### 中期（1-2月）

1. **功能增强**
   - 推荐商品筛选
   - 更多推荐类型（新品、促销）
   - 推荐刷新按钮

2. **数据统计**
   - 推荐点击率统计
   - 转化率分析
   - A/B 测试不同推荐策略

### 长期（3-6月）

1. **智能化**
   - 机器学习推荐
   - 实时推荐更新
   - 个性化权重调整

2. **移动端**
   - 独立移动端 App
   - 推送通知
   - 离线浏览

---

## 🐛 已知问题

### 问题1: 推荐商品为空

**现象**: 某些商品没有相关推荐

**原因**: 
- 数据库商品数量较少
- 同分类商品不足
- 价格范围内无商品

**解决方案**:
- 补充更多商品数据
- 放宽推荐条件
- 显示其他分类商品作为兜底

### 问题2: 倒计时不够精确

**现象**: 倒计时以分钟为单位

**原因**: 
- 后端返回分钟数
- 前端每分钟更新

**优化方案**:
- 后端返回秒级时间戳
- 前端实现秒级倒计时
- 使用 `setInterval(1000)` 每秒更新

---

## 📚 相关文档

- [后端开发日志](./开发日志_后端.md) - 后端实现详情
- [最终测试报告](./FINAL_TEST_REPORT.md) - 完整测试报告
- [功能更新说明](./FEATURE_UPDATE_20251031.md) - 后端功能说明

---

## ✅ 更新检查清单

- [x] API 接口定义
- [x] 商品详情页相关推荐
- [x] 首页猜你喜欢
- [x] 订单支付倒计时
- [x] 响应式设计
- [x] 加载状态处理
- [x] 错误处理
- [x] 代码提交
- [x] 文档编写
- [ ] 功能测试（待用户测试）
- [ ] 性能优化（后续）

---

**更新完成时间**: 2025-10-31  
**开发者**: AI Assistant  
**版本**: v2.1.0


