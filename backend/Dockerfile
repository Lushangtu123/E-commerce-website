FROM node:18-alpine

WORKDIR /app

# 复制package.json和package-lock.json
COPY package*.json ./

# 安装所有依赖（包括dev依赖，用于构建）
RUN npm ci

# 复制源代码
COPY . .

# 构建TypeScript
RUN npm run build

# 删除dev依赖，只保留生产依赖
RUN npm prune --omit=dev

# 暴露端口
EXPOSE 3001

# 启动应用
CMD ["npm", "start"]
