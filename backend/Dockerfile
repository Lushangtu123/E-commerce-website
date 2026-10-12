# 构建阶段：安装全部依赖，编译 TypeScript 并生成 dist/openapi.json
FROM node:24-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行阶段：只包含生产依赖和编译产物
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist

# 以镜像自带的非 root 用户 node 运行，应用目录对它只读。
# 配置 LOG_FILE 时请指向挂载的可写卷。
USER node

EXPOSE 3001

# /health 在 MySQL 或 Redis 不可用时返回 503，容器随之标记为 unhealthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

# 直接以 node 作为 1 号进程：SIGTERM 直达应用，触发 index.ts 中的优雅关闭
CMD ["node", "dist/index.js"]
