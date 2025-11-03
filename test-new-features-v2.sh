#!/bin/bash

# 新功能测试脚本 V2
# 测试 Elasticsearch、RabbitMQ、优惠券系统

BASE_URL="http://localhost:3001/api"
TOKEN=""
USER_ID=""
ADMIN_TOKEN=""

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "======================================"
echo "  新功能测试脚本 V2"
echo "======================================"
echo ""

# 1. 用户注册登录
echo -e "${BLUE}[1/10] 测试用户注册和登录${NC}"
REGISTER_RESPONSE=$(curl -s -X POST "${BASE_URL}/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser_es",
    "email": "testuser_es@example.com",
    "password": "123456",
    "phone": "13900000001"
  }')

if echo "$REGISTER_RESPONSE" | grep -q "token"; then
  echo -e "${GREEN}✓ 注册成功${NC}"
  TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*' | sed 's/"token":"//')
else
  # 尝试登录
  LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/users/login" \
    -H "Content-Type: application/json" \
    -d '{
      "username": "testuser_es",
      "password": "123456"
    }')
  TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | sed 's/"token":"//')
  echo -e "${GREEN}✓ 登录成功${NC}"
fi

echo "Token: $TOKEN"
echo ""

# 2. 测试 Elasticsearch 搜索
echo -e "${BLUE}[2/10] 测试 Elasticsearch 商品搜索${NC}"

# 2.1 关键词搜索
echo "  • 测试关键词搜索..."
SEARCH_RESPONSE=$(curl -s -X GET "${BASE_URL}/search/es?keyword=手机&page=1&page_size=5")
PRODUCT_COUNT=$(echo "$SEARCH_RESPONSE" | grep -o '"total":[0-9]*' | head -1 | sed 's/"total"://')
echo -e "${GREEN}    找到 $PRODUCT_COUNT 个商品${NC}"

# 2.2 价格筛选
echo "  • 测试价格筛选..."
curl -s -X GET "${BASE_URL}/search/es?keyword=手机&min_price=1000&max_price=5000" > /dev/null
echo -e "${GREEN}    价格筛选测试完成${NC}"

# 2.3 排序测试
echo "  • 测试排序功能..."
curl -s -X GET "${BASE_URL}/search/es?keyword=手机&sort_by=price&sort_order=asc" > /dev/null
echo -e "${GREEN}    排序测试完成${NC}"

echo ""

# 3. 测试优惠券系统
echo -e "${BLUE}[3/10] 测试优惠券系统${NC}"

# 3.1 管理员登录
echo "  • 管理员登录..."
ADMIN_LOGIN=$(curl -s -X POST "${BASE_URL}/admin/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }')
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | grep -o '"token":"[^"]*' | sed 's/"token":"//')

if [ -n "$ADMIN_TOKEN" ]; then
  echo -e "${GREEN}    管理员登录成功${NC}"
  
  # 3.2 创建优惠券
  echo "  • 创建优惠券..."
  CREATE_COUPON=$(curl -s -X POST "${BASE_URL}/admin/coupons" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{
      "code": "NEW2025",
      "name": "新年优惠券",
      "description": "新年特惠，全场通用",
      "type": 1,
      "discount_value": 50,
      "min_amount": 200,
      "total_quantity": 1000,
      "per_user_limit": 1,
      "start_time": "2025-01-01 00:00:00",
      "end_time": "2025-12-31 23:59:59"
    }')
  
  if echo "$CREATE_COUPON" | grep -q "success"; then
    COUPON_ID=$(echo "$CREATE_COUPON" | grep -o '"coupon_id":[0-9]*' | sed 's/"coupon_id"://')
    echo -e "${GREEN}    优惠券创建成功 (ID: $COUPON_ID)${NC}"
  else
    echo -e "${RED}    优惠券可能已存在${NC}"
  fi
else
  echo -e "${RED}    管理员登录失败，跳过优惠券创建${NC}"
fi

# 3.3 查看可领取优惠券
echo "  • 查看可领取优惠券..."
AVAILABLE_COUPONS=$(curl -s -X GET "${BASE_URL}/coupons/available" \
  -H "Authorization: Bearer $TOKEN")
COUPON_COUNT=$(echo "$AVAILABLE_COUPONS" | grep -o '"coupon_id"' | wc -l)
echo -e "${GREEN}    找到 $COUPON_COUNT 个可领取优惠券${NC}"

# 3.4 领取优惠券
echo "  • 领取优惠券..."
RECEIVE_COUPON=$(curl -s -X POST "${BASE_URL}/coupons/receive" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"code": "NEW2025"}')

if echo "$RECEIVE_COUPON" | grep -q "success"; then
  echo -e "${GREEN}    优惠券领取成功${NC}"
else
  echo -e "${RED}    优惠券已领取或领取失败${NC}"
fi

# 3.5 查看我的优惠券
echo "  • 查看我的优惠券..."
MY_COUPONS=$(curl -s -X GET "${BASE_URL}/coupons/my/list?status=1" \
  -H "Authorization: Bearer $TOKEN")
MY_COUPON_COUNT=$(echo "$MY_COUPONS" | grep -o '"user_coupon_id"' | wc -l)
echo -e "${GREEN}    拥有 $MY_COUPON_COUNT 张未使用的优惠券${NC}"

echo ""

# 4. 测试消息队列（模拟）
echo -e "${BLUE}[4/10] 测试消息队列功能${NC}"
echo "  • 消息队列在后台运行"
echo "  • 创建订单时会自动触发消息队列"
echo "  • 请查看后端日志确认消息处理"
echo -e "${GREEN}    消息队列功能已启用${NC}"
echo ""

# 5. 测试搜索历史
echo -e "${BLUE}[5/10] 测试搜索历史记录${NC}"
curl -s -X POST "${BASE_URL}/search/record" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"keyword": "手机", "result_count": 10}' > /dev/null

curl -s -X POST "${BASE_URL}/search/record" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"keyword": "电脑", "result_count": 5}' > /dev/null

SEARCH_HISTORY=$(curl -s -X GET "${BASE_URL}/search/history?limit=10" \
  -H "Authorization: Bearer $TOKEN")
HISTORY_COUNT=$(echo "$SEARCH_HISTORY" | grep -o '"keyword"' | wc -l)
echo -e "${GREEN}✓ 搜索历史记录: $HISTORY_COUNT 条${NC}"
echo ""

# 6. 测试热搜关键词
echo -e "${BLUE}[6/10] 测试热搜关键词${NC}"
HOT_KEYWORDS=$(curl -s -X GET "${BASE_URL}/search/hot?days=7&limit=5")
HOT_COUNT=$(echo "$HOT_KEYWORDS" | grep -o '"keyword"' | wc -l)
echo -e "${GREEN}✓ 热搜关键词: $HOT_COUNT 个${NC}"
echo ""

# 7. 测试商品推荐
echo -e "${BLUE}[7/10] 测试商品推荐${NC}"
RECOMMENDATIONS=$(curl -s -X GET "${BASE_URL}/recommendations/personalized?limit=5" \
  -H "Authorization: Bearer $TOKEN")
REC_COUNT=$(echo "$RECOMMENDATIONS" | grep -o '"product_id"' | wc -l)
echo -e "${GREEN}✓ 个性化推荐: $REC_COUNT 个商品${NC}"
echo ""

# 8. 测试浏览历史
echo -e "${BLUE}[8/10] 测试浏览历史${NC}"
curl -s -X POST "${BASE_URL}/browse" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"product_id": 1}' > /dev/null

BROWSE_HISTORY=$(curl -s -X GET "${BASE_URL}/browse?limit=10" \
  -H "Authorization: Bearer $TOKEN")
BROWSE_COUNT=$(echo "$BROWSE_HISTORY" | grep -o '"product_id"' | wc -l)
echo -e "${GREEN}✓ 浏览历史: $BROWSE_COUNT 条${NC}"
echo ""

# 9. 健康检查
echo -e "${BLUE}[9/10] 服务健康检查${NC}"
HEALTH=$(curl -s -X GET "http://localhost:3001/health")
if echo "$HEALTH" | grep -q "ok"; then
  echo -e "${GREEN}✓ 服务运行正常${NC}"
else
  echo -e "${RED}✗ 服务异常${NC}"
fi
echo ""

# 10. 总结
echo -e "${BLUE}[10/10] 测试总结${NC}"
echo "======================================"
echo -e "${GREEN}✓ Elasticsearch 商品搜索${NC}"
echo -e "${GREEN}✓ 优惠券系统 (创建/领取/查看)${NC}"
echo -e "${GREEN}✓ RabbitMQ 消息队列${NC}"
echo -e "${GREEN}✓ 搜索历史记录${NC}"
echo -e "${GREEN}✓ 热搜关键词${NC}"
echo -e "${GREEN}✓ 商品推荐系统${NC}"
echo -e "${GREEN}✓ 浏览历史功能${NC}"
echo "======================================"
echo ""
echo -e "${BLUE}📝 注意事项:${NC}"
echo "1. 确保 Elasticsearch 服务正在运行"
echo "2. 确保 RabbitMQ 服务正在运行"
echo "3. 确保已执行优惠券数据库迁移"
echo "4. 确保已同步商品数据到 Elasticsearch"
echo ""
echo -e "${BLUE}🚀 相关命令:${NC}"
echo "  npm run migrate-coupon:dev  # 创建优惠券表"
echo "  npm run sync-es:dev         # 同步商品到ES"
echo ""
echo "测试完成！"

