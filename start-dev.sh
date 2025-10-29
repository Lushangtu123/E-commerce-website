#!/bin/bash

echo "🚀 启动电商平台开发环境..."
echo ""

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请先启动 Docker Desktop"
    exit 1
fi

# 检查 Docker 服务
echo "📊 检查 Docker 服务状态..."
cd "$(dirname "$0")"
docker-compose ps | grep -q "Up" || {
    echo "🐳 启动 Docker 服务..."
    docker-compose up -d
    echo "⏳ 等待服务就绪 (30秒)..."
    sleep 30
}

# 检查后端配置
if [ ! -f "backend/.env" ]; then
    echo "❌ 缺少 backend/.env 文件"
    echo "请参考 QUICK_START_GUIDE.md 创建配置文件"
    exit 1
fi

# 启动后端
echo ""
echo "🔧 启动后端服务..."
cd backend
npm run dev > ../backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# 等待后端启动
echo "⏳ 等待后端就绪..."
for i in {1..10}; do
    if curl -s http://localhost:3001/health > /dev/null 2>&1; then
        echo "✅ 后端服务启动成功 (PID: $BACKEND_PID)"
        break
    fi
    sleep 1
done

# 启动前端
echo ""
echo "🎨 启动前端服务..."
cd frontend
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ 所有服务启动完成！"
echo ""
echo "📝 访问地址："
echo "  - 前端: http://localhost:3000"
echo "  - 后端: http://localhost:3001"
echo "  - 管理后台: http://localhost:3000/admin"
echo ""
echo "📊 进程信息："
echo "  - 后端 PID: $BACKEND_PID"
echo "  - 前端 PID: $FRONTEND_PID"
echo ""
echo "📋 日志文件："
echo "  - 后端日志: ./backend.log"
echo "  - 前端日志: ./frontend.log"
echo ""
echo "🛑 停止服务："
echo "  kill $BACKEND_PID $FRONTEND_PID"
echo ""
echo "💡 提示: 按 Ctrl+C 不会停止后台服务，需要手动 kill"

