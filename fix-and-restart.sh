#!/bin/bash

echo "🔧 完全清理并重启项目..."
echo ""

# 1. 停止所有Node进程
echo "🛑 停止所有Node进程..."
pkill -9 node 2>/dev/null || true
sleep 2

# 2. 清除所有缓存
echo "🗑️  清除缓存..."
cd "$(dirname "$0")/backend"
rm -rf node_modules/.cache 2>/dev/null
rm -rf .ts-node 2>/dev/null
rm -rf dist 2>/dev/null
echo "✅ 缓存已清除"

# 3. 验证文件修改
echo ""
echo "📝 验证文件修改..."
if grep -q "AuthRequest" src/controllers/favorite.controller.ts; then
    echo "✅ favorite.controller.ts 已正确修改"
else
    echo "❌ favorite.controller.ts 未正确修改"
    exit 1
fi

# 4. 编译检查
echo ""
echo "🔍 TypeScript编译检查..."
npx tsc --noEmit 2>&1 | head -20
COMPILE_STATUS=$?

if [ $COMPILE_STATUS -ne 0 ]; then
    echo ""
    echo "❌ TypeScript编译失败，需要修复错误"
    exit 1
fi

# 5. 启动Docker服务
echo ""
echo "🐳 确保Docker服务运行..."
cd ..
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker未运行，请先启动Docker Desktop"
    exit 1
fi

docker-compose up -d 2>/dev/null
echo "⏳ 等待MySQL启动..."
for i in {1..30}; do
    if docker exec ecommerce-mysql mysqladmin ping -h localhost -uroot -proot123456 > /dev/null 2>&1; then
        echo "✅ MySQL已就绪"
        break
    fi
    sleep 1
done

# 6. 启动后端
echo ""
echo "🚀 启动后端服务..."
cd backend
npm run dev > ../backend-new.log 2>&1 &
BACKEND_PID=$!

# 7. 等待后端启动
echo "⏳ 等待后端启动..."
for i in {1..30}; do
    if curl -s http://localhost:3001/health > /dev/null 2>&1; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "✅ 后端启动成功！"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        curl -s http://localhost:3001/health | grep -o '{.*}'
        echo ""
        echo "📊 后端 PID: $BACKEND_PID"
        echo "📋 日志文件: ./backend-new.log"
        echo ""
        echo "🌐 现在可以访问:"
        echo "   http://localhost:3000"
        echo ""
        exit 0
    fi
    sleep 1
    [ $((i % 5)) -eq 0 ] && echo "   等待中... ($i/30)"
done

echo ""
echo "❌ 后端启动超时，查看日志:"
tail -50 ../backend-new.log
exit 1

