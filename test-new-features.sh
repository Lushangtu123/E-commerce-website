#!/bin/bash

# 新功能测试脚本
# 测试订单超时和商品推荐功能

echo "======================================"
echo "  电商平台新功能测试"
echo "======================================"
echo ""

API_BASE="http://localhost:3001/api"
TOKEN=""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试函数
test_api() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    local auth=$5
    
    echo -e "${YELLOW}测试: $name${NC}"
    
    if [ "$auth" = "true" ] && [ -n "$TOKEN" ]; then
        if [ "$method" = "GET" ]; then
            response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE$endpoint" \
                -H "Authorization: Bearer $TOKEN" \
                -H "Content-Type: application/json")
        else
            response=$(curl -s -w "\n%{http_code}" -X $method "$API_BASE$endpoint" \
                -H "Authorization: Bearer $TOKEN" \
                -H "Content-Type: application/json" \
                -d "$data")
        fi
    else
        if [ "$method" = "GET" ]; then
            response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE$endpoint" \
                -H "Content-Type: application/json")
        else
            response=$(curl -s -w "\n%{http_code}" -X $method "$API_BASE$endpoint" \
                -H "Content-Type: application/json" \
                -d "$data")
        fi
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ 成功 (HTTP $http_code)${NC}"
        echo "响应: $body" | jq '.' 2>/dev/null || echo "$body"
    else
        echo -e "${RED}✗ 失败 (HTTP $http_code)${NC}"
        echo "响应: $body"
    fi
    echo ""
}

# 1. 健康检查
echo "1. 健康检查"
echo "--------------------------------------"
test_api "服务器健康检查" "GET" "/health" "" "false"

# 2. 用户登录（获取token）
echo "2. 用户登录"
echo "--------------------------------------"
login_response=$(curl -s -X POST "$API_BASE/users/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"password123"}')

TOKEN=$(echo $login_response | jq -r '.token' 2>/dev/null)

if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
    echo -e "${GREEN}✓ 登录成功${NC}"
    echo "Token: ${TOKEN:0:20}..."
else
    echo -e "${YELLOW}⚠ 未找到测试用户，尝试注册...${NC}"
    register_response=$(curl -s -X POST "$API_BASE/users/register" \
        -H "Content-Type: application/json" \
        -d '{"username":"testuser","email":"test@example.com","password":"password123","phone":"13800138000"}')
    TOKEN=$(echo $register_response | jq -r '.token' 2>/dev/null)
    if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
        echo -e "${GREEN}✓ 注册并登录成功${NC}"
    else
        echo -e "${RED}✗ 无法获取token，部分测试将跳过${NC}"
    fi
fi
echo ""

# 3. 测试订单超时功能
echo "3. 测试订单超时功能"
echo "--------------------------------------"

if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
    # 创建测试订单
    test_api "创建测试订单" "POST" "/orders" \
        '{"items":[{"product_id":1,"quantity":1}],"shipping_address_id":1}' "true"
    
    # 获取订单列表
    test_api "获取订单列表" "GET" "/orders?status=pending_payment" "" "true"
    
    # 假设订单ID为1，获取剩余支付时间
    test_api "获取订单剩余支付时间" "GET" "/orders/1/remaining-time" "" "true"
else
    echo -e "${YELLOW}⚠ 跳过订单测试（需要登录）${NC}"
    echo ""
fi

# 4. 测试商品推荐功能
echo "4. 测试商品推荐功能"
echo "--------------------------------------"

# 猜你喜欢（不需要登录）
test_api "猜你喜欢推荐" "GET" "/recommendations/guess-you-like?limit=5" "" "false"

# 相关商品推荐
test_api "相关商品推荐" "GET" "/recommendations/related/1?limit=5" "" "false"

if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
    # 个性化推荐（需要登录）
    test_api "个性化推荐" "GET" "/recommendations/personalized?limit=5" "" "true"
    
    # 记录浏览历史
    test_api "记录浏览历史" "POST" "/browse" '{"product_id":1}' "true"
    test_api "记录浏览历史" "POST" "/browse" '{"product_id":2}' "true"
    test_api "记录浏览历史" "POST" "/browse" '{"product_id":3}' "true"
    
    # 再次获取个性化推荐
    test_api "个性化推荐（有浏览历史）" "GET" "/recommendations/personalized?limit=5" "" "true"
else
    echo -e "${YELLOW}⚠ 跳过个性化推荐测试（需要登录）${NC}"
    echo ""
fi

# 5. 测试订单超时检查服务
echo "5. 订单超时检查服务状态"
echo "--------------------------------------"
echo "订单超时检查服务应该在后台运行"
echo "检查后端日志查看定时任务输出"
echo "超时时间: 30分钟"
echo "检查频率: 每5分钟"
echo ""

# 总结
echo "======================================"
echo "  测试完成"
echo "======================================"
echo ""
echo "新功能说明:"
echo "1. 订单超时自动取消"
echo "   - 待支付订单30分钟后自动取消"
echo "   - 自动恢复库存"
echo "   - 可查询剩余支付时间"
echo ""
echo "2. 商品推荐系统"
echo "   - 基于浏览历史的个性化推荐"
echo "   - 相关商品推荐"
echo "   - 猜你喜欢"
echo "   - 新用户推荐"
echo ""
echo "API端点:"
echo "  GET  /api/orders/:id/remaining-time  - 获取订单剩余支付时间"
echo "  GET  /api/recommendations/personalized - 个性化推荐"
echo "  GET  /api/recommendations/related/:id  - 相关商品推荐"
echo "  GET  /api/recommendations/guess-you-like - 猜你喜欢"
echo ""

