# Astro 静态博客部署至 Google Cloud Run 标准作业程序 (SOP)

> **版本**：v1.0 (生产就绪版)  
> **适用场景**：Astro / Next.js / 静态网站 容器化持续部署到 Google Cloud Run，采用全自动 CI/CD 与 Workload Identity Federation 无密钥安全认证。

---

## 目录
1. [架构概览与核心特性](#一架构概览与核心特性)
2. [关键避坑经验总结（踩坑实录）](#二关键避坑经验总结踩坑实录)
3. [阶段一：本地项目容器化与 CI/CD 配置](#三阶段一本地项目容器化与-cicd-配置)
4. [阶段二：Google Cloud 资源与互信一键初始化](#四阶段二google-cloud-资源与互信一键初始化)
5. [阶段三：GitHub Secrets 配置与自动化部署](#五阶段三github-secrets-配置与自动化部署)
6. [阶段四：自定义域名与自动 SSL 证书绑定](#六阶段四自定义域名与自动-ssl-证书绑定)
7. [日常运维与内容发布流程](#七日常运维与内容发布流程)

---

## 一、架构概览与核心特性

```mermaid
flowchart TD
    A[本地撰写 Markdown / 提交代码] -->|git push origin main| B[GitHub Actions CI/CD]
    B -->|1. OIDC 无密钥握手| C[GCP Workload Identity Federation]
    B -->|2. 多阶段构建 Docker 镜像| D[Node.js 22 编译 -> Nginx Alpine]
    B -->|3. 推送镜像| E[GCP Artifact Registry (新加坡 asia-southeast1)]
    B -->|4. 自动部署| F[Google Cloud Run (min-instances=0)]
    B -->|5. 自动广播新文章| G[Mastodon 联邦宇宙]
    F -->|HTTPS 访问| H[自定义域名 blog.dustyat.com]
```

* **极致轻量**：多阶段构建，最终产物仅包含编译静态文件 + Nginx Alpine，镜像体积约 **20MB**。
* **零元运行 (Scale-to-Zero)**：配置 `min-instances=0`，无人访问时 0 实例、0 消耗、0 费用；冷启动时间仅 **0.2~0.3s**。
* **超低延迟**：亚太节点部署在 `asia-southeast1`（新加坡），直连海缆对东南亚与国内访问速度极快。
* **最高安全标准**：摒弃明文 JSON 密钥文件，采用 Google 官方推荐的 **Workload Identity Federation (WIF)** 无密钥认证。

---

## 二、关键避坑经验总结（踩坑实录）

在构建和部署过程中，有以下 4 个必须规避的经典问题：

### 1. Nginx 在 Cloud Run 反向代理下导致子页面 404 / 重定向丢失端口
* **现象**：访问主页正常，但点击 `/blog` 或 `/about` 页面无响应或报错。
* **根因**：Cloud Run 外网走 `HTTPS:443` 转发到容器内 `$PORT (8080)`。Nginx 默认在处理未带尾随斜杠的目录时，会发起带有内部端口 `8080` 的绝对路径重定向，导致浏览器被拦截。
* **解决方案**：
  1. `nginx.conf.template` 中必须显式配置：
     ```nginx
     port_in_redirect off;
     absolute_redirect off;
     ```
  2. 页面导航链接规范化为带尾部斜杠格式（如 `/blog/`、`/about/`）。

### 2. Google Cloud 组织禁止创建明文 Service Account 密钥
* **现象**：执行 `gcloud iam service-accounts keys create` 时报错 `FAILED_PRECONDITION: Key creation is not allowed on this service account`。
* **根因**：GCP 组织默认启用了 `iam.disableServiceAccountKeyCreation` 安全策略。
* **解决方案**：使用 **Workload Identity Federation (WIF)**，利用 GitHub OIDC Token 换取临时 GCP 凭据，彻底告别管理明文 JSON。

### 3. WIF 创建 OIDC Provider 报 `INVALID_ARGUMENT: The attribute condition must reference...`
* **现象**：创建 Provider 失败，提示缺少 attribute condition。
* **根因**：GCP 安全策略要求 OIDC Provider 必须显式添加属性断言条件，防止非所属仓库盗用。
* **解决方案**：创建 Provider 时加入属性映射与账号绑定条件：
  ```bash
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner=='<你的GitHub用户名>'"
  ```

### 4. 浏览器强缓存旧 Favicon 图标
* **现象**：更换 `favicon.svg` 后，浏览器标签页仍旧显示旧图标。
* **根因**：Chrome / Edge 对根目录 `/favicon.ico` 有极强的本地数据库持久缓存。
* **解决方案**：全量生成 `favicon.svg`、`favicon.png` 与 `favicon.ico`，并在 HTML 标签中添加版本号清除缓存（如 `/favicon.svg?v=3`）。

---

## 三、阶段一：本地项目容器化与 CI/CD 配置

### 1. 多阶段构建 `Dockerfile`
```dockerfile
# 1. 构建阶段
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 2. 运行阶段 (Nginx 极简镜像)
FROM nginx:alpine AS runner
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 8080
ENV PORT=8080
CMD ["nginx", "-g", "daemon off;"]
```

### 2. Nginx 模板 `nginx.conf.template`
```nginx
server {
    listen ${PORT};
    server_name localhost;

    # 关键：避免反向代理下内部重定向携带 8080 端口
    port_in_redirect off;
    absolute_redirect off;

    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml application/rss+xml image/svg+xml;

    location ~* ^/_astro/ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location ~* \.(?:ico|css|js|gif|jpe?g|png|webp|woff2?|eot|ttf|svg)$ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000";
    }

    location / {
        try_files $uri $uri/ $uri/index.html /index.html =404;
        add_header Cache-Control "public, max-age=0, must-revalidate";
    }

    error_page 404 /404.html;
    location = /404.html {
        internal;
    }
}
```

### 3. GitHub Actions 工作流 `.github/workflows/deploy.yml`
```yaml
name: Deploy Astro Blog to Google Cloud Run

on:
  push:
    branches:
      - main
  workflow_dispatch:

env:
  GCP_REGION: asia-southeast1                # 新加坡（东南亚与国内超低延迟）
  GAR_REPOSITORY: blog-repo                 # Artifact Registry 镜像库名
  SERVICE_NAME: astro-blog                  # Cloud Run 服务名

permissions:
  contents: read
  id-token: write                           # OIDC 必须权限

jobs:
  deploy:
    name: Build and Deploy
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Authenticate to Google Cloud (Workload Identity Federation)
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_WIF_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Authorize Docker to Artifact Registry
        run: |
          gcloud auth configure-docker ${{ env.GCP_REGION }}-docker.pkg.dev --quiet

      - name: Build and Tag Docker Image
        run: |
          IMAGE_TAG="${{ env.GCP_REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.GAR_REPOSITORY }}/${{ env.SERVICE_NAME }}"
          docker build \
            -t "${IMAGE_TAG}:${{ github.sha }}" \
            -t "${IMAGE_TAG}:latest" \
            .

      - name: Push Docker Image to Artifact Registry
        run: |
          IMAGE_TAG="${{ env.GCP_REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.GAR_REPOSITORY }}/${{ env.SERVICE_NAME }}"
          docker push "${IMAGE_TAG}:${{ github.sha }}"
          docker push "${IMAGE_TAG}:latest"

      - name: Deploy to Cloud Run
        id: deploy
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: ${{ env.SERVICE_NAME }}
          region: ${{ env.GCP_REGION }}
          image: ${{ env.GCP_REGION }}-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/${{ env.GAR_REPOSITORY }}/${{ env.SERVICE_NAME }}:${{ github.sha }}
          flags: |
            --allow-unauthenticated
            --min-instances=0
            --max-instances=5
            --memory=256Mi
            --cpu=1

      - name: Show Output Service URL
        run: |
          echo "🚀 Astro Blog successfully deployed to: ${{ steps.deploy.outputs.url }}"
```

---

## 四、阶段二：Google Cloud 资源与互信一键初始化

在 Google Cloud Shell 终端中**整段复制执行以下命令**（将 `<你的GitHub用户名>` 替换为实际用户名）：

```bash
# 1. 获取项目基本信息
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUM=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
GITHUB_USER="dustyat" # 改为你的 GitHub 用户名

# 2. 启用必要 API 服务
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com

# 3. 创建 Artifact Registry Docker 镜像仓库 (新加坡 asia-southeast1)
gcloud artifacts repositories create blog-repo \
  --repository-format=docker \
  --location=asia-southeast1 \
  --description="Docker repository for Astro Blog" || true

# 4. 创建服务账号 github-deployer
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions Deployer" || true

# 5. 分配最小所需权限
SA_EMAIL="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding ${PROJECT_ID} --member="serviceAccount:${SA_EMAIL}" --role="roles/run.admin"
gcloud projects add-iam-policy-binding ${PROJECT_ID} --member="serviceAccount:${SA_EMAIL}" --role="roles/artifactregistry.writer"
gcloud projects add-iam-policy-binding ${PROJECT_ID} --member="serviceAccount:${SA_EMAIL}" --role="roles/iam.serviceAccountUser"

# 6. 创建 Workload Identity Pool 与 OIDC Provider
gcloud iam workload-identity-pools create "github-pool" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Pool" || true

gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner=='${GITHUB_USER}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" || true

# 7. 授权互信池使用服务账号
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUM}/locations/global/workloadIdentityPools/github-pool/*"

echo ""
echo "==================== 🔑 填入 GitHub Secrets 的参数 ===================="
echo "1. GCP_WIF_PROVIDER:"
echo "projects/${PROJECT_NUM}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
echo ""
echo "2. GCP_WIF_SERVICE_ACCOUNT:"
echo "${SA_EMAIL}"
echo ""
echo "3. GCP_PROJECT_ID:"
echo "${PROJECT_ID}"
echo "========================================================================="
```

---

## 五、阶段三：GitHub Secrets 配置与自动化部署

1. 打开 GitHub 仓库 ➔ **Settings** ➔ **Secrets and variables** ➔ **Actions**；
2. 添加以下 3 个 Repository Secrets：

| Secret 名称 | 说明 / 来源 |
| :--- | :--- |
| **`GCP_WIF_PROVIDER`** | 阶段二脚本输出的 `projects/xxx/.../providers/github-provider` |
| **`GCP_WIF_SERVICE_ACCOUNT`** | `github-deployer@<PROJECT_ID>.iam.gserviceaccount.com` |
| **`GCP_PROJECT_ID`** | 您的 Google Cloud 项目 ID |

3. 在 GitHub 仓库 **Actions** 标签页点击 **Run workflow**，约 1~2 分钟即可完成初次部署！

---

## 六、阶段四：自定义域名与自动 SSL 证书绑定

1. **Google 所有权验证**：
   - 访问 [Google Search Console](https://search.google.com/search-console) ➔ 添加网域 `dustyat.com`；
   - 在域名 DNS 后台添加一条 `@` 的 `TXT` 记录（`google-site-verification=...`）完成所有权验证。
2. **Cloud Run 添加映射**：
   - 进入 Cloud Run 控制台 ➔ **Domain mappings（网域映射）** ➔ **Add mapping**；
   - 选择服务 `astro-blog` ➔ 填写 `blog.dustyat.com` ➔ 点击 Continue。
3. **DNS 记录解析**：
   - 在您的域名服务商（如腾讯云/阿里云/Cloudflare）添加一条 **CNAME**：
     * **主机记录 / 名称**：`blog`
     * **记录类型**：`CNAME`
     * **记录值 / 目标**：`ghs.googlehosted.com.`
4. **SSL 证书**：Google Cloud 会在 5~15 分钟内自动签发受信任的 HTTPS 证书。

---

## 七、日常运维与内容发布流程

* **写新文章**：在 `src/content/blog/` 目录下新建 `.md` 或 `.mdx` 文件；
* **发布上线**：
  ```bash
  git add .
  git commit -m "feat: 发布新文章：我的第一篇技术手记"
  git push origin main
  ```
* **自动化触发**：GitHub Actions 会在 1 分钟内自动完成测试、构建镜像、灰度发布至 Cloud Run，并可选自动同步推送到 Mastodon！
