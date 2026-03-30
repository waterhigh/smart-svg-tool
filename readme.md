# Smart SVG Tool

一个把位图主体拆出来并转成 SVG 的工具，当前版本重点做了三件事：

- 分割链路从“单点 + 单结果”升级成“正点 / 负点 / 框选 + 3 个候选结果”
- SVG 输出从单一路线升级成 `Contour` 与 `Color Vector` 双路线
- 后端从进程级全局状态升级成基于 `upload_id` 的任务隔离

这次重构优先解决的是图片分割质量、SVG 转换质量，以及可继续部署和维护的工程结构。

## 这版重点改了什么

### 1. 分割质量

- 上传后会返回 `upload_id`，后续所有分割都基于任务隔离，不再依赖单个全局 `current_image_path`
- 支持 `正点击 / 负点击 / 框选`
- 每次分割返回 3 个候选结果，避免“一次给错就结束”
- mask 在送去矢量化前会统一经过：
  - 去小噪点
  - 填小孔洞
  - 平滑边缘
  - 可选只保留最大连通域

### 2. SVG 质量

- 新增 3 套图像预设：
  - `Logo / Icon`
  - `Illustration / Sticker`
  - `Photo / Complex Subject`
- 新增 2 条矢量化路线：
  - `Contour`：直接从 mask 轮廓提 path，适合 logo、图标、边界清晰对象
  - `Color Vector`：走 VTracer，适合插画、贴纸、复杂色块主体
- 提供 `detail` 和 `smoothing` 控制项，用于平衡“更干净”和“更保留细节”
- 当彩色矢量化失败时，后端会自动回退到 contour 模式，避免直接报废

### 3. 产品体验

- 首页不再强制登录
- 登录 / 注册保留，但上传和分割现在允许直接试用
- 前端工作流改成：
  1. 上传图片
  2. 添加提示点或框
  3. 查看候选结果
  4. 选中合适的 SVG 加入画布
  5. 在 Fabric 画布中拼装后导出

### 4. 工程能力

- 敏感配置全部改为环境变量
- 默认数据库改成 SQLite，开箱更轻；如果需要，也可以通过 `DATABASE_URL` 切回 Postgres
- 增加 `.env.example`
- 增加后端 / 前端 Dockerfile
- 更新根目录 `docker-compose.yml`
- 临时任务和导出文件统一写入 `backend/runtime`

## 当前技术栈

- Backend: FastAPI + SQLAlchemy + SAM + OpenCV + VTracer
- Frontend: Next.js 16 + React 19 + Fabric.js + Tailwind CSS
- Auth: JWT
- Default DB: SQLite

## 目录说明

```text
smart_svg_tools/
├─ backend/
│  ├─ app/
│  │  ├─ auth.py
│  │  ├─ config.py
│  │  ├─ crud.py
│  │  ├─ database.py
│  │  ├─ models.py
│  │  ├─ schemas.py
│  │  ├─ segmentation.py
│  │  └─ task_store.py
│  ├─ weights/
│  ├─ runtime/
│  ├─ Dockerfile
│  ├─ main.py
│  └─ requirements.txt
├─ frontend/
│  ├─ app/
│  ├─ public/
│  ├─ Dockerfile
│  └─ package.json
├─ .env.example
├─ docker-compose.yml
└─ readme.md
```

## 快速开始

### 1. 准备模型文件

下载 SAM 权重并放到：

```text
backend/weights/sam_vit_b_01ec64.pth
```

推荐下载地址：

```text
https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
```

### 2. 准备环境变量

在仓库根目录复制：

```bash
cp .env.example .env
```

Windows 可以直接手动复制一份 `.env.example` 为 `.env`。

默认关键配置：

```env
DATABASE_URL=sqlite:///./runtime/smart_svg.db
SAM_CHECKPOINT_PATH=./weights/sam_vit_b_01ec64.pth
RUNTIME_DIR=./runtime
FRONTEND_DIST_DIR=../frontend/out
NEXT_PUBLIC_API_BASE_URL=
```

说明：

- 这些路径都是相对于 `backend/` 目录解释的
- 如果前后端分离部署，前端需要设置 `NEXT_PUBLIC_API_BASE_URL`

## 本地开发

### 后端

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

如果你要使用 GPU 版 PyTorch，请按你的 CUDA 版本安装对应 wheel，再装其余依赖。

### 前端

```bash
cd frontend
npm install
npm run dev
```

默认访问：

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`

## 静态构建 + 后端托管

如果你想让 FastAPI 直接托管前端静态页面：

```bash
cd frontend
npm install
npm run build

cd ../backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

此时后端会读取 `../frontend/out` 作为静态站点目录。

## Docker Compose

根目录执行：

```bash
docker compose up --build
```

默认端口：

- Frontend: `3000`
- Backend: `8000`

注意：

- Compose 默认让前后端分离运行
- 后端容器会把 `backend/runtime` 挂载出来
- 请先确保 `backend/weights/sam_vit_b_01ec64.pth` 已存在

## 使用方式

### 工作流

1. 上传图片
2. 选择提示方式
   - 正点：告诉模型“我要这个”
   - 负点：告诉模型“不要这个”
   - 框选：限定主体范围
3. 选择图像预设和矢量模式
4. 点击“生成候选”
5. 从 `Tight / Balanced / Complete` 里选一个更合适的结果
6. 加入右侧画布并导出 SVG

### 质量建议

- Logo / 图标
  - 预设：`Logo / Icon`
  - 模式：优先 `Contour`
  - 建议：勾选“仅保留最大连通域”

- 插画 / 贴纸
  - 预设：`Illustration / Sticker`
  - 模式：优先 `Auto` 或 `Color Vector`
  - 建议：先加一个正点，再用负点清背景粘连

- 照片主体
  - 预设：`Photo / Complex Subject`
  - 模式：优先 `Color Vector`
  - 建议：尽量同时配合框选和负点

## API 概览

### `POST /upload/`

上传图片，返回：

- `upload_id`
- `image_url`
- `image_width`
- `image_height`
- `expires_at`

### `POST /segment/`

主要字段：

- `upload_id`
- `points_json`
- `box_json`
- `preset`
- `vector_mode`
- `detail`
- `smoothing`
- `keep_holes`
- `largest_component`

返回：

- `candidates[]`
  - `label`
  - `score_percent`
  - `preview_url`
  - `svg_url`
  - `offset_x`
  - `offset_y`

### `POST /token`

账号登录，返回 JWT。

### `POST /users/`

账号注册。

### `GET /me`

返回当前登录用户。

### `GET /health`

检查服务状态、模型加载状态和设备信息。

## 当前行为变化

和旧版本相比，以下行为已经明确变化：

- 不再宣传 OCR 自动去字
- 不再要求先登录才能上传和分割
- 不再使用单个全局图像状态
- 不再只返回一个 mask

## 已完成的验证

- 后端：`python -m compileall backend`
- 前端：`npm run lint`
- 前端：`npm run build`

## 我建议你下一步优先做的事

如果继续往产品化走，最值得追加的是：

1. 项目保存和历史记录
2. SVG / PNG / ZIP 多格式导出
3. 更细的结果分享和收费分层
4. 上传限流、任务队列和监控

## License

MIT
