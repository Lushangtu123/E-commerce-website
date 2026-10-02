FROM node:24-alpine AS builder

WORKDIR /app

# 复制package.json
COPY package*.json ./

# 安装依赖
RUN npm ci

# 复制源代码
COPY . .

# NEXT_PUBLIC values are embedded in the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# 构建应用
RUN npm run build

# 生产镜像
FROM node:24-alpine

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./

# 安装生产依赖
RUN npm ci --omit=dev

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["npm", "start"]
