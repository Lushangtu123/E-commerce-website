#!/bin/bash

echo "════════════════════════════════════════════════════════════════"
echo "🎟️  优惠券前端功能测试"
echo "════════════════════════════════════════════════════════════════"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BASE_URL="http://localhost:3001/api"
FRONTEND_URL="http://localhost:3000"

echo "📋 测试准备"
echo "────────────────────────────────────────────────────────────────"

# 1. 检查服务状态
echo -n "检查前端服务... "
if curl -s -o /dev/null -w "%{http_code}" $FRONTEND_URL | grep -q "200"; then
    echo -e "${GREEN}✓ 运行中${NC}"
else
    echo -e "${RED}✗ 未运行${NC}"
    echo "请先启动前端服务: docker-compose up -d frontend"
    exit 1
fi

echo -n "检查后端服务... "
if curl -s -o /dev/null -w "%{http_code}" $BASE_URL/health | grep -q "200"; then
    echo -e "${GREEN}✓ 运行中${NC}"
else
    echo -e "${RED}✗ 未运行${NC}"
    echo "请先启动后端服务: docker-compose up -d backend"
    exit 1
fi

echo ""
echo "🔐 用户登录"
echo "────────────────────────────────────────────────────────────────"

# 2. 用户登录
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/users/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"123456"}')

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
    echo -e "${RED}✗ 登录失败${NC}"
    echo "响应: $LOGIN_RESPONSE"
    exit 1
else
    echo -e "${GREEN}✓ 登录成功${NC}"
    echo "Token: ${TOKEN:0:20}..."
fi

echo ""
echo "🎫 测试优惠券 API"
echo "────────────────────────────────────────────────────────────────"

# 3. 获取可领取的优惠券
echo -n "测试 GET /api/coupons/available... "
AVAILABLE_RESPONSE=$(curl -s "$BASE_URL/coupons/available" \
  -H "Authorization: Bearer $TOKEN")

if echo $AVAILABLE_RESPONSE | grep -q "success"; then
    COUNT=$(echo $AVAILABLE_RESPONSE | grep -o '"data":\[' | wc -l)
    echo -e "${GREEN}✓ 成功${NC}"
    echo "  └─ 可领取优惠券数量: $(echo $AVAILABLE_RESPONSE | grep -o '"coupon_id"' | wc -l)"
else
    echo -e "${RED}✗ 失败${NC}"
    echo "  └─ $AVAILABLE_RESPONSE"
fi

# 4. 领取优惠券（使用测试优惠券）
echo -n "测试 POST /api/coupons/receive... "
RECEIVE_RESPONSE=$(curl -s -X POST "$BASE_URL/coupons/receive" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"code":"WELCOME50"}')

if echo $RECEIVE_RESPONSE | grep -q "success\|已领取"; then
    echo -e "${GREEN}✓ 成功${NC}"
else
    echo -e "${YELLOW}⚠ $(echo $RECEIVE_RESPONSE | grep -o '"message":"[^"]*"' | cut -d'"' -f4)${NC}"
fi

# 5. 获取我的优惠券
echo -n "测试 GET /api/coupons/my/list... "
MY_COUPONS_RESPONSE=$(curl -s "$BASE_URL/coupons/my/list" \
  -H "Authorization: Bearer $TOKEN")

if echo $MY_COUPONS_RESPONSE | grep -q "success"; then
    MY_COUNT=$(echo $MY_COUPONS_RESPONSE | grep -o '"user_coupon_id"' | wc -l)
    echo -e "${GREEN}✓ 成功${NC}"
    echo "  └─ 我的优惠券数量: $MY_COUNT"
else
    echo -e "${RED}✗ 失败${NC}"
fi

# 6. 获取订单可用优惠券
echo -n "测试 GET /api/coupons/my/available-for-order... "
ORDER_COUPONS_RESPONSE=$(curl -s "$BASE_URL/coupons/my/available-for-order?amount=300" \
  -H "Authorization: Bearer $TOKEN")

if echo $ORDER_COUPONS_RESPONSE | grep -q "success"; then
    echo -e "${GREEN}✓ 成功${NC}"
    echo "  └─ 订单可用优惠券: $(echo $ORDER_COUPONS_RESPONSE | grep -o '"user_coupon_id"' | wc -l)"
else
    echo -e "${RED}✗ 失败${NC}"
fi

# 7. 计算优惠金额
echo -n "测试 POST /api/coupons/calculate... "
CALC_RESPONSE=$(curl -s -X POST "$BASE_URL/coupons/calculate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"user_coupon_id":1,"order_amount":300}')

if echo $CALC_RESPONSE | grep -q "discount_amount"; then
    DISCOUNT=$(echo $CALC_RESPONSE | grep -o '"discount_amount":[0-9.]*' | cut -d':' -f2)
    FINAL=$(echo $CALC_RESPONSE | grep -o '"final_amount":[0-9.]*' | cut -d':' -f2)
    echo -e "${GREEN}✓ 成功${NC}"
    echo "  └─ 优惠金额: ¥$DISCOUNT, 最终金额: ¥$FINAL"
else
    echo -e "${YELLOW}⚠ $(echo $CALC_RESPONSE | grep -o '"message":"[^"]*"' | cut -d'"' -f4)${NC}"
fi

echo ""
echo "📊 数据库检查"
echo "────────────────────────────────────────────────────────────────"

# 8. 检查数据库中的优惠券
echo "优惠券表数据:"
docker exec ecommerce-mysql mysql -uroot -proot123456 ecommerce -e "
SELECT 
  coupon_id as ID, 
  code as 代码, 
  name as 名称, 
  CASE type WHEN 1 THEN '满减' WHEN 2 THEN '折扣' WHEN 3 THEN '无门槛' END as 类型,
  discount_value as 优惠值,
  remain_quantity as 剩余,
  total_quantity as 总量
FROM coupons 
LIMIT 3;" 2>/dev/null

echo ""
echo "用户优惠券表数据:"
docker exec ecommerce-mysql mysql -uroot -proot123456 ecommerce -e "
SELECT 
  user_coupon_id as ID, 
  user_id as 用户ID, 
  CASE status WHEN 1 THEN '未使用' WHEN 2 THEN '已使用' WHEN 3 THEN '已过期' END as 状态,
  DATE(received_at) as 领取日期
FROM user_coupons 
ORDER BY user_coupon_id DESC 
LIMIT 5;" 2>/dev/null

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "🌐 前端页面测试"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo -e "${BLUE}请在浏览器中访问以下页面进行测试:${NC}"
echo ""
echo "1️⃣  首页 (查看优惠券横幅)"
echo "   ${FRONTEND_URL}"
echo ""
echo "2️⃣  优惠券中心 (领取优惠券)"
echo "   ${FRONTEND_URL}/coupons"
echo ""
echo "3️⃣  我的优惠券 (查看已领取的优惠券)"
echo "   ${FRONTEND_URL}/my/coupons"
echo ""
echo "4️⃣  登录页面 (如果未登录)"
echo "   ${FRONTEND_URL}/login"
echo "   测试账号: testuser / 123456"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✅ API 测试完成！"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo -e "${YELLOW}💡 提示:${NC}"
echo "  • 确保已登录才能访问优惠券功能"
echo "  • 在 Header 导航栏可以看到礼物图标（优惠券入口）"
echo "  • 点击优惠券卡片的「立即领取」按钮领取优惠券"
echo "  • 在「我的优惠券」页面可以查看已领取的优惠券"
echo ""

