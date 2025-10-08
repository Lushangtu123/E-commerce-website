#!/bin/bash

# 管理员系统初始化脚本

echo "🚀 开始初始化电商后台管理系统..."
echo ""

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请先启动 Docker Desktop"
    exit 1
fi

echo "✅ Docker 正在运行"
echo ""

# 检查服务是否启动
echo "📡 检查服务状态..."
if ! docker-compose ps | grep -q "Up"; then
    echo "⚠️  服务未启动，正在启动所有服务..."
    docker-compose up -d
    echo "⏳ 等待服务启动完成（30秒）..."
    sleep 30
else
    echo "✅ 服务已启动"
fi

echo ""

# 编译后端代码
echo "🔨 编译后端代码..."
docker-compose exec -T backend npm run build

echo ""

# 运行管理员数据库迁移
echo "📊 初始化管理员数据库..."
docker-compose exec -T backend node dist/database/admin-migrate.js

echo ""
echo "🎉 管理员系统初始化完成！"
echo ""
echo "📝 访问信息："
echo "  管理后台登录页: http://localhost:3000/admin/login"
echo "  默认用户名: admin"
echo "  默认密码: admin123"
echo ""
echo "⚠️  重要提示："
echo "  1. 登录后请立即修改默认密码"
echo "  2. 详细使用说明请查看 ADMIN_GUIDE.md"
echo ""
echo "📚 相关文档："
echo "  - ADMIN_GUIDE.md    - 后台管理系统完整指南"
echo "  - README.md         - 项目总览"
echo "  - QUICKSTART.md     - 快速开始"
echo ""

