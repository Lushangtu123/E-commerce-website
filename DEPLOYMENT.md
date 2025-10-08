# 部署指南

本文档提供了电商平台系统的详细部署说明。

## 部署方式

### 1. Docker Compose部署（推荐）

这是最简单的部署方式，适合开发和测试环境。

#### 前置要求
- Docker 20.10+
- Docker Compose 2.0+

#### 部署步骤

1. **准备环境**
```bash
# 克隆项目
git clone <repository-url>
cd E-commerce-website
```

2. **配置环境变量**
```bash
# 后端环境变量（可选，使用docker-compose.yml中的默认值）
cp backend/.env.example backend/.env

# 前端环境变量（可选）
cp frontend/.env.local.example frontend/.env.local
```

3. **启动所有服务**
```bash
# 构建并启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

4. **初始化数据库**
```bash
# 等待MySQL启动完成后，运行迁移
docker-compose exec backend npm run migrate
```

5. **访问应用**
- 前端应用: http://localhost:3000
- 后端API: http://localhost:3001
- RabbitMQ管理界面: http://localhost:15672 (用户名: admin, 密码: admin123)
- Elasticsearch: http://localhost:9200

6. **停止服务**
```bash
# 停止所有服务
docker-compose down

# 停止并删除所有数据
docker-compose down -v
```

### 2. Kubernetes部署

适合生产环境的大规模部署。

#### 前置要求
- Kubernetes集群 1.20+
- kubectl命令行工具
- Helm 3.0+

#### 部署步骤

1. **创建命名空间**
```bash
kubectl create namespace ecommerce
```

2. **创建Secret存储敏感信息**
```bash
kubectl create secret generic ecommerce-secrets \
  --from-literal=db-password=your_db_password \
  --from-literal=redis-password=your_redis_password \
  --from-literal=jwt-secret=your_jwt_secret \
  -n ecommerce
```

3. **部署数据库服务**
```bash
# 使用Helm部署MySQL
helm install mysql bitnami/mysql \
  --set auth.rootPassword=root123456 \
  --set auth.database=ecommerce \
  -n ecommerce

# 部署Redis
helm install redis bitnami/redis \
  --set auth.enabled=false \
  -n ecommerce

# 部署MongoDB
helm install mongodb bitnami/mongodb \
  --set auth.rootPassword=admin123 \
  -n ecommerce

# 部署RabbitMQ
helm install rabbitmq bitnami/rabbitmq \
  --set auth.username=admin \
  --set auth.password=admin123 \
  -n ecommerce

# 部署Elasticsearch
helm install elasticsearch elastic/elasticsearch \
  --set replicas=1 \
  -n ecommerce
```

4. **部署应用**
```bash
# 构建并推送Docker镜像到镜像仓库
docker build -t your-registry/ecommerce-backend:latest ./backend
docker build -t your-registry/ecommerce-frontend:latest ./frontend
docker push your-registry/ecommerce-backend:latest
docker push your-registry/ecommerce-frontend:latest

# 应用Kubernetes配置（需要先创建配置文件）
kubectl apply -f k8s/ -n ecommerce
```

### 3. 手动部署

适合对基础设施有完全控制的场景。

#### 后端部署

1. **安装依赖**
```bash
cd backend
npm ci --production
```

2. **构建应用**
```bash
npm run build
```

3. **配置环境变量**
```bash
# 编辑.env文件
vim .env
```

4. **运行迁移**
```bash
npm run migrate
```

5. **启动应用**
```bash
# 使用PM2管理进程
npm install -g pm2
pm2 start dist/index.js --name ecommerce-backend

# 或使用systemd
sudo systemctl start ecommerce-backend
```

#### 前端部署

1. **安装依赖**
```bash
cd frontend
npm ci
```

2. **构建应用**
```bash
npm run build
```

3. **启动应用**
```bash
# 使用PM2
pm2 start npm --name ecommerce-frontend -- start

# 或使用Nginx反向代理
# 将构建产物部署到Nginx
```

## 数据库配置

### MySQL配置建议

```sql
-- 创建数据库
CREATE DATABASE ecommerce CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建用户
CREATE USER 'ecommerce'@'%' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON ecommerce.* TO 'ecommerce'@'%';
FLUSH PRIVILEGES;

-- 性能优化配置
SET GLOBAL max_connections = 1000;
SET GLOBAL innodb_buffer_pool_size = 2G;
```

### Redis配置建议

```conf
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
appendonly yes
```

## Nginx配置示例

```nginx
# /etc/nginx/sites-available/ecommerce
upstream backend {
    server localhost:3001;
}

upstream frontend {
    server localhost:3000;
}

server {
    listen 80;
    server_name example.com;

    # 前端
    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # API
    location /api {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }

    # 静态资源
    location /uploads {
        alias /var/www/ecommerce/uploads;
        expires 30d;
    }
}

# HTTPS配置（使用Let's Encrypt）
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    
    # ... 其他配置同上
}
```

## 监控和日志

### 使用PM2监控

```bash
# 查看进程状态
pm2 status

# 查看日志
pm2 logs

# 监控
pm2 monit
```

### 使用Prometheus + Grafana

1. 安装Prometheus
2. 配置metrics端点
3. 安装Grafana
4. 导入Dashboard

## 备份策略

### 数据库备份

```bash
# MySQL备份脚本
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/mysql"
mysqldump -u root -p ecommerce > $BACKUP_DIR/ecommerce_$DATE.sql
gzip $BACKUP_DIR/ecommerce_$DATE.sql

# 保留最近7天的备份
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
```

### Redis备份

```bash
# Redis持久化配置
appendonly yes
save 900 1
save 300 10
save 60 10000
```

## 性能优化

### 应用层优化
- 启用压缩
- 配置缓存策略
- 使用CDN加速静态资源

### 数据库优化
- 添加适当索引
- 配置查询缓存
- 读写分离
- 分库分表

### 缓存优化
- 热点数据缓存
- 页面缓存
- API结果缓存

## 安全建议

1. **使用HTTPS**
   - 配置SSL证书
   - 强制HTTPS重定向

2. **防火墙配置**
   - 只开放必要端口
   - 配置IP白名单

3. **定期更新**
   - 更新依赖包
   - 修复安全漏洞

4. **备份策略**
   - 定期备份数据
   - 测试恢复流程

5. **监控告警**
   - 配置监控系统
   - 设置告警规则

## 故障排查

### 常见问题

1. **数据库连接失败**
   - 检查数据库服务是否运行
   - 检查连接配置是否正确
   - 检查防火墙规则

2. **Redis连接失败**
   - 检查Redis服务状态
   - 检查连接配置

3. **应用启动失败**
   - 查看日志文件
   - 检查环境变量
   - 检查端口占用

### 日志位置

- 应用日志: `logs/app.log`
- 错误日志: `logs/error.log`
- 访问日志: `logs/access.log`

## 扩展性

### 水平扩展

1. **应用层扩展**
   - 部署多个后端实例
   - 配置负载均衡

2. **数据库扩展**
   - 主从复制
   - 分库分表
   - 读写分离

3. **缓存扩展**
   - Redis集群
   - Redis Sentinel

## 联系方式

如有部署问题，请查看项目文档或提交Issue。

