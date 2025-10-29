#!/bin/bash

echo "🔧 完整重启电商平台..."
echo ""

# 1. 等待Docker就绪
echo "📊 等待Docker就绪..."
for i in {1..30}; do
    if docker info > /dev/null 2>&1; then
        echo "✅ Docker已就绪"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Docker未启动，请先打开Docker Desktop"
        exit 1
    fi
    sleep 1
    echo "   等待中... ($i/30)"
done

# 2. 启动Docker服务
echo ""
echo "🐳 启动Docker服务..."
cd "$(dirname "$0")"
docker-compose down 2>/dev/null
docker-compose up -d

# 3. 等待MySQL就绪
echo ""
echo "⏳ 等待MySQL启动 (最多60秒)..."
for i in {1..60}; do
    if docker exec ecommerce-mysql mysqladmin ping -h localhost -uroot -proot123456 > /dev/null 2>&1; then
        echo "✅ MySQL已就绪"
        break
    fi
    if [ $i -eq 60 ]; then
        echo "❌ MySQL启动超时"
        docker-compose logs mysql
        exit 1
    fi
    sleep 1
    [ $((i % 10)) -eq 0 ] && echo "   等待中... ($i/60)"
done

# 4. 停止旧的后端进程
echo ""
echo "🛑 停止旧的后端进程..."
pkill -9 -f "nodemon.*ts-node" 2>/dev/null || true
sleep 2

# 5. 启动后端
echo ""
echo "🔧 启动后端服务..."
cd backend
npm run dev > ../backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# 6. 等待后端就绪
echo ""
echo "⏳ 等待后端启动..."
for i in {1..30}; do
    if curl -s http://localhost:3001/health > /dev/null 2>&1; then
        echo "✅ 后端启动成功 (PID: $BACKEND_PID)"
        echo ""
        curl -s http://localhost:3001/health | jq . 2>/dev/null || curl -s http://localhost:3001/health
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ 后端启动失败，查看日志："
        tail -50 backend.log
        exit 1
    fi
    sleep 1
    [ $((i % 5)) -eq 0 ] && echo "   等待中... ($i/30)"
done

# 7. 检查前端
echo ""
echo "🎨 检查前端服务..."
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "✅ 前端已在运行"
else
    echo "⚠️  前端未运行，请在新终端运行："
    echo "   cd frontend && npm run dev"
fi

# 8. 完成
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 启动完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 访问地址："
echo "  🌐 前端主页:    http://localhost:3000"
echo "  🔧 后端API:     http://localhost:3001"
echo "  👨‍💼 管理后台:    http://localhost:3000/admin"
echo ""
echo "📋 服务状态："
docker-compose ps
echo ""
echo "📊 进程信息："
echo "  后端 PID: $BACKEND_PID"
echo "  后端日志: ./backend.log"
echo ""
echo "🛑 停止服务："
echo "  kill $BACKEND_PID    # 停止后端"
echo "  docker-compose down  # 停止Docker服务"
echo ""

