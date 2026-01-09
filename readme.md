# Smart SVG Tool (基于 SAM 的智能图片拆解与矢量化工具)

这是一个基于 AI 的智能图片处理工具，能够利用 **Segment Anything Model (SAM)** 进行语义分割，并使用 **VTracer** 将位图转换为高质量的 SVG 矢量图。前端提供了一个强大的 **Fabric.js** 画布，支持对拆解后的矢量模块进行自由组合、缩放和导出。

## ✨ 主要功能

* **AI 智能拆解**：点击图片任意位置，利用 SAM 模型自动识别主体并抠图。
* **图像增强**：内置 OpenCV 锐化处理，提升非水彩风格图片（如插画、照片）的转换清晰度。
* **矢量化转换**：将抠图结果转换为可编辑的 SVG 路径。
* **交互式画布**：支持拖拽、缩放、组合、删除矢量元素。
* **灵活导出**：支持导出选中模块或全图，自动处理透明背景。

---

## 🛠️ 环境配置 (Prerequisites)

### 1. 基础环境

* **Python**: 3.8 或更高版本 (推荐 3.10)
* **Node.js**: 16.0 或更高版本
* **Git**

### 2. 后端配置 (Backend)

进入 `backend` 目录并安装依赖：

```bash
cd backend

# 1. (可选) 创建虚拟环境
conda create -n smart_svg python=3.10
conda activate smart_svg

# 2. 安装 Python 依赖
# 注意：如果你有 NVIDIA 显卡，请先安装 PyTorch 的 CUDA 版本，否则可能会默认安装 CPU 版
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
pip install -r requirements.txt

```

**依赖列表 (`requirements.txt` 参考):**

```txt
fastapi
uvicorn
python-multipart
numpy
Pillow
opencv-python-headless
segment-anything
vtracer
paddlepaddle
paddleocr

```

**模型文件下载:**
你需要手动下载 SAM 模型权重文件，并将其放入 `backend` 目录：

* **模型名称**: `sam_vit_b_01ec64.pth`
* **下载地址**: [Facebook SAM Model Checkpoint](https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth)

> **注意**: PaddleOCR 的模型会在第一次运行时自动下载到 `backend/paddle_home` 目录下，无需手动干预。

### 3. 前端配置 (Frontend)

进入 `frontend` 目录并安装依赖：

```bash
cd frontend
npm install

```

---

## 🚀 运行项目 (Running)

本项目支持 **前后端分离开发模式** 和 **整合托管模式**。

### 方式一：整合模式 (推荐，只需启动 Python)

这种方式由 Python 后端直接托管前端页面，适合部署或直接使用。

1. **构建前端**:
```bash
cd frontend
npm run build

```


*(构建成功后会生成 `out` 文件夹)*
2. **启动后端**:
```bash
cd backend
python main.py

```


3. **访问**: 打开浏览器访问 `http://localhost:8000`

### 方式二：开发模式 (调试用)

如果你需要修改前端代码，可以使用此模式。

1. **启动后端**: `cd backend` -> `python main.py`
2. **启动前端**: `cd frontend` -> `npm run dev`
3. **访问**: 打开浏览器访问 `http://localhost:3000`

---

## 🎨 VTracer 参数调整与高细节配置

本项目默认使用 **高细节 (High Detail)** 配置，以应对插画和照片风格的清晰度问题。如果你处理的是 **水彩风格** 图片，或者发现生成的 SVG 节点过多、文件过大，可以按以下说明调整参数。

### 修改位置

打开 `backend/main.py` 文件，找到 `segment_point` 函数中的 `vtracer.convert_image_to_svg_py` 调用部分。

### 参数详解

| 参数名 | 当前高细节值 | 说明 | 调整建议 |
| --- | --- | --- | --- |
| **`filter_speckle`** | `2` | 噪点过滤阈值。值越小，保留的微小细节越多。 | **水彩/简约风**: 改为 `4` 或 `10`，去除杂色。<br>

<br>**照片/插画**: 保持 `2` 或 `1`。 |
| **`color_precision`** | `8` | 颜色精度 (位)。值越高，颜色层级越丰富。 | **文件过大时**: 降为 `6`。<br>

<br>**追求色彩还原**: 保持 `8`。 |
| **`layer_difference`** | `10` | 颜色合并阈值。值越小，越能区分相似颜色。 | **色块分明时**: 改为 `16`。<br>

<br>**渐变丰富时**: 保持 `10`。 |
| **`path_precision`** | `2` | 路径拟合精度。值越小，线条越贴合原图边缘。 | **追求平滑/艺术感**: 改为 `4` 或 `8`。<br>

<br>**追求还原度**: 保持 `2`。 |
| **`corner_threshold`** | `60` | 拐角阈值。值越大，越倾向于保留尖角。 | **圆润风格**: 降为 `30`。<br>

<br>**硬朗风格**: 保持 `60`。 |

### 针对不同风格的推荐配置

#### 1. 高细节模式 (默认 - 适合照片、复杂插画)

```python
vtracer.convert_image_to_svg_py(
    # ...
    filter_speckle=2,       # 保留微小纹理
    color_precision=8,      # 高色彩精度
    layer_difference=10,    # 敏感的颜色区分
    corner_threshold=60,    # 保留锐利边缘
    path_precision=2        # 极高的路径贴合度
)

```

#### 2. 水彩/扁平化模式 (适合 Logo、水彩画)

如果你觉得生成的 SVG 太碎、太乱，请尝试改回以下参数：

```python
vtracer.convert_image_to_svg_py(
    # ...
    filter_speckle=4,       # 过滤噪点
    color_precision=6,      # 标准色彩
    layer_difference=16,    # 合并相似色块
    corner_threshold=45,    # 平滑拐角
    path_precision=4        # 标准路径精度
)

```

---

## 🤝 常见问题 (Troubleshooting)

1. **OCR 模型下载失败**:
* 项目会自动将 PaddleOCR 模型下载到 `backend/paddle_home`。如果下载卡住，请检查网络或手动下载模型放入该目录。


2. **前端上传失败**:
* 如果是局域网或公网访问，请确保 `action` 路径配置正确（整合模式下默认为 `/upload/`）。


3. **缺少 'sam_vit_b_01ec64.pth'**:
* 后端启动会报错，请务必从上方链接下载并放入 `backend` 根目录。



## 📝 License

[MIT](https://www.google.com/search?q=LICENSE)