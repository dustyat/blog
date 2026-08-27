# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# 安装构建依赖（sharp 等原生依赖在 Alpine 下需要 libc6-compat 或 python/make）
RUN apk add --no-cache libc6-compat

# 优先复制依赖定义以利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 复制源码并执行构建
COPY . .
RUN npm run build

# Stage 2: Production runtime stage
FROM nginx:alpine AS runner

# 默认端口设置为 8080 (Cloud Run 默认端口)
ENV PORT=8080

# 复制 Nginx 模板配置（nginx 官方镜像启动时会自动用 envsubst 处理 templates/ 下的文件）
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# 复制 Astro 静态产物
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
