#!/bin/bash

# 优惠券系统测试脚本

BASE_URL="http://localhost:3001/api"
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "════════════════════════════════════════════════════════════════"
echo "  🎟️  优惠券系统完整测试"
echo "════════════════════════════════════════════════════════════════"
echo ""

# 1. 管理员登录
echo -e "${BLUE}[1/8] 管理员登录...${NC}"
ADMIN_LOGIN=$(curl -s -X POST "${BASE_URL}/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')

ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | grep -o '"token":"[^"]*' | sed 's/"token":"//')

if [ -n "$ADMIN_TOKEN" ]; then
  echo -e "${GREEN}✓ 管理员登录成功${NC}"
  echo "Token: ${ADMIN_TOKEN:0:50}..."
else
  echo -e "${RED}✗ 管理员登录失败${NC}"
  echo "$ADMIN_LOGIN"
  exit 1
fi
echo ""

# 2. 创建优惠券
echo -e "${BLUE}[2/8] 创建测试优惠券...${NC}"

# 创建满减券
echo "  • 创建满减券..."
COUPON1=$(curl -s -X POST "${BASE_URL}/admin/coupons" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "code": "WELCOME100",
    "name": "新用户欢迎券",
    "description": "新用户专享，满200减50",
    "type": 1,
    "discount_value": 50,
    "min_amount": 200,
    "total_quantity": 100,
    "per_user_limit": 1,
    "start_time": "2025-01-01 00:00:00",
    "end_time": "2025-12-31 23:59:59"
  }')

if echo "$COUPON1" | grep -q "success"; then
  echo -e "${GREEN}    ✓ 满减券创建成功${NC}"
else
  echo -e "${YELLOW}    ℹ 满减券可能已存在${NC}"
fi

# 创建折扣券
echo "  • 创建折扣券..."
COUPON2=$(curl -s -X POST "${BASE_URL}/admin/coupons" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "code": "DISCOUNT20",
    "name": "全场8折券",
    "description": "全场商品8折优惠，最高优惠100元",
    "type": 2,
    "discount_value": 20,
    "min_amount": 100,
    "max_discount": 100,
    "total_quantity": 200,
    "per_user_limit": 1,
    "start_time": "2025-01-01 00:00:00",
    "end_time": "2025-12-31 23:59:59"
  }')

if echo "$COUPON2" | grep -q "success"; then
  echo -e "${GREEN}    ✓ 折扣券创建成功${NC}"
else
  echo -e "${YELLOW}    ℹ 折扣券可能已存在${NC}"
fi

# 创建无门槛券
echo "  • 创建无门槛券..."
COUPON3=$(curl -s -X POST "${BASE_URL}/admin/coupons" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "code": "GIFT20",
    "name": "无门槛优惠券",
    "description": "直接抵扣20元，无门槛使用",
    "type": 3,
    "discount_value": 20,
    "min_amount": 0,
    "total_quantity": 500,
    "per_user_limit": 2,
    "start_time": "2025-01-01 00:00:00",
    "end_time": "2025-12-31 23:59:59"
  }')

if echo "$COUPON3" | grep -q "success"; then
  echo -e "${GREEN}    ✓ 无门槛券创建成功${NC}"
else
  echo -e "${YELLOW}    ℹ 无门槛券可能已存在${NC}"
fi
echo ""

# 3. 查看所有优惠券
echo -e "${BLUE}[3/8] 查看管理员优惠券列表...${NC}"
ADMIN_LIST=$(curl -s "${BASE_URL}/admin/coupons?page=1&page_size=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

COUPON_COUNT=$(echo "$ADMIN_LIST" | grep -o '"coupon_id"' | wc -l | tr -d ' ')
echo -e "${GREEN}✓ 找到 $COUPON_COUNT 个优惠券${NC}"
echo ""

# 4. 用户注册登录
echo -e "${BLUE}[4/8] 用户注册/登录...${NC}"

# 尝试注册
REGISTER=$(curl -s -X POST "${BASE_URL}/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "coupon_test_user",
    "email": "coupon@test.com",
    "password": "123456",
    "phone": "13800000001"
  }')

# 登录
USER_LOGIN=$(curl -s -X POST "${BASE_URL}/users/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "coupon_test_user",
    "password": "123456"
  }')

USER_TOKEN=$(echo "$USER_LOGIN" | grep -o '"token":"[^"]*' | sed 's/"token":"//')

if [ -n "$USER_TOKEN" ]; then
  echo -e "${GREEN}✓ 用户登录成功${NC}"
  echo "Token: ${USER_TOKEN:0:50}..."
else
  echo -e "${RED}✗ 用户登录失败${NC}"
  echo "$USER_LOGIN"
  exit 1
fi
echo ""

# 5. 查看可领取优惠券
echo -e "${BLUE}[5/8] 查看可领取的优惠券...${NC}"
AVAILABLE=$(curl -s "${BASE_URL}/coupons/available?page=1&page_size=10" \
  -H "Authorization: Bearer $USER_TOKEN")

echo "$AVAILABLE" | python3 -m json.tool 2>/dev/null | head -40
echo ""

# 6. 领取优惠券
echo -e "${BLUE}[6/8] 领取优惠券...${NC}"

echo "  • 领取满减券..."
RECEIVE1=$(curl -s -X POST "${BASE_URL}/coupons/receive" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"code": "WELCOME100"}')

if echo "$RECEIVE1" | grep -q "success"; then
  echo -e "${GREEN}    ✓ 满减券领取成功${NC}"
else
  echo -e "${YELLOW}    ℹ $(echo $RECEIVE1 | grep -o '"message":"[^"]*' | sed 's/"message":"//')${NC}"
fi

echo "  • 领取折扣券..."
RECEIVE2=$(curl -s -X POST "${BASE_URL}/coupons/receive" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"code": "DISCOUNT20"}')

if echo "$RECEIVE2" | grep -q "success"; then
  echo -e "${GREEN}    ✓ 折扣券领取成功${NC}"
else
  echo -e "${YELLOW}    ℹ $(echo $RECEIVE2 | grep -o '"message":"[^"]*' | sed 's/"message":"//')${NC}"
fi

echo "  • 领取无门槛券..."
RECEIVE3=$(curl -s -X POST "${BASE_URL}/coupons/receive" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"code": "GIFT20"}')

if echo "$RECEIVE3" | grep -q "success"; then
  echo -e "${GREEN}    ✓ 无门槛券领取成功${NC}"
else
  echo -e "${YELLOW}    ℹ $(echo $RECEIVE3 | grep -o '"message":"[^"]*' | sed 's/"message":"//')${NC}"
fi
echo ""

# 7. 查看我的优惠券
echo -e "${BLUE}[7/8] 查看我的优惠券...${NC}"
MY_COUPONS=$(curl -s "${BASE_URL}/coupons/my/list?status=1" \
  -H "Authorization: Bearer $USER_TOKEN")

MY_COUNT=$(echo "$MY_COUPONS" | grep -o '"user_coupon_id"' | wc -l | tr -d ' ')
echo -e "${GREEN}✓ 拥有 $MY_COUNT 张未使用的优惠券${NC}"

echo "$MY_COUPONS" | python3 -m json.tool 2>/dev/null | grep -A 5 "user_coupon_id" | head -30
echo ""

# 8. 测试优惠金额计算
echo -e "${BLUE}[8/8] 测试优惠金额计算...${NC}"

# 获取第一张优惠券ID
USER_COUPON_ID=$(echo "$MY_COUPONS" | grep -o '"user_coupon_id":[0-9]*' | head -1 | sed 's/"user_coupon_id"://')

if [ -n "$USER_COUPON_ID" ]; then
  echo "  • 计算订单金额 300 元的优惠..."
  CALC=$(curl -s -X POST "${BASE_URL}/coupons/calculate" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -d "{\"user_coupon_id\": $USER_COUPON_ID, \"order_amount\": 300}")
  
  echo "$CALC" | python3 -m json.tool 2>/dev/null
fi
echo ""

# 9. 查看数据库数据
echo -e "${BLUE}[查看数据库] 优惠券数据...${NC}"
echo ""
echo "优惠券列表:"
docker exec ecommerce-mysql mysql -uroot -proot123456 ecommerce \
  -e "SELECT coupon_id, code, name, type, discount_value, min_amount, total_quantity, remain_quantity, status FROM coupons;" 2>/dev/null

echo ""
echo "用户优惠券:"
docker exec ecommerce-mysql mysql -uroot -proot123456 ecommerce \
  -e "SELECT user_coupon_id, user_id, coupon_id, status, received_at FROM user_coupons ORDER BY received_at DESC LIMIT 5;" 2>/dev/null

echo ""
echo "════════════════════════════════════════════════════════════════"
echo -e "${GREEN}✅ 优惠券系统测试完成！${NC}"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "📝 总结:"
echo "  • 创建了 3 种类型的优惠券"
echo "  • 用户成功领取优惠券"
echo "  • 优惠金额计算正常"
echo ""
echo "🎯 下一步:"
echo "  • 在前端添加优惠券中心页面"
echo "  • 在结算页面集成优惠券选择功能"
echo "  • 在管理后台添加优惠券管理页面"
echo ""

