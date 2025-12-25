# backend/main.py
import os
import sys

# --- 1. 路径重定向 (保持不变) ---
project_root = os.path.dirname(os.path.abspath(__file__))
fake_home_dir = os.path.join(project_root, "paddle_home")
os.makedirs(fake_home_dir, exist_ok=True)
os.environ['USERPROFILE'] = fake_home_dir
os.environ['HOME'] = fake_home_dir
os.environ['XDG_CACHE_HOME'] = fake_home_dir

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
import numpy as np
import torch
import shutil
import vtracer
import uuid
import cv2
import logging
from segment_anything import sam_model_registry, SamPredictor
from paddleocr import PaddleOCR

logging.getLogger("ppocr").setLevel(logging.WARNING)

app = FastAPI()

# 允许跨域 (虽然合并后不需要跨域了，但留着无妨)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 目录配置
TEMP_DIR = "temp_uploads"
OUTPUT_DIR = "output_svgs"
# 🔥 指向前端打包后的文件夹 (假设 backend 和 frontend 是兄弟目录)
FRONTEND_DIST_DIR = os.path.join(os.path.dirname(project_root), "frontend", "out")

os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 挂载资源目录
app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")
app.mount("/uploads", StaticFiles(directory=TEMP_DIR), name="uploads")

# --- AI 模型初始化 (保持不变) ---
print("正在加载 AI 模型...")
CHECKPOINT_PATH = r"F:\smart_svg_tool\weights\sam_vit_b_01ec64.pth" 
MODEL_TYPE = "vit_b"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

sam_loaded = False
if not os.path.exists(CHECKPOINT_PATH):
    print(f"❌ 错误：找不到 SAM 模型文件 {CHECKPOINT_PATH}")
else:
    try:
        sam = sam_model_registry[MODEL_TYPE](checkpoint=CHECKPOINT_PATH)
        sam.to(device=DEVICE)
        predictor = SamPredictor(sam)
        sam_loaded = True
        print(f"✅ SAM 模型加载完成！")
    except Exception as e:
        print(f"❌ SAM 加载失败: {e}")

# OCR 初始化 (保持不变)
try:
    ocr_engine = PaddleOCR(use_textline_orientation=True, lang="ch")
except:
    try:
        ocr_engine = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
    except:
        ocr_engine = None
print(f"✅ OCR 引擎状态: {'可用' if ocr_engine else '不可用'}")

current_image_path = None

# --- 辅助函数 (保持不变) ---
def inpaint_text(img_path, output_path):
    if not ocr_engine:
        shutil.copyfile(img_path, output_path)
        return
    try:
        img = cv2.imread(img_path)
        result = ocr_engine.ocr(img_path, cls=True)
        if not result or (isinstance(result, list) and len(result)>0 and result[0] is None):
            shutil.copyfile(img_path, output_path)
            return
        
        mask = np.zeros(img.shape[:2], dtype=np.uint8)
        lines = result[0] if result and isinstance(result[0], list) else result
        if lines:
            for line in lines:
                try:
                    box = np.array(line[0]).astype(np.int32).reshape((-1, 1, 2))
                    cv2.fillPoly(mask, [box], 255)
                except: continue
        kernel = np.ones((5, 5), np.uint8)
        mask = cv2.dilate(mask, kernel, iterations=2)
        cleaned_img = cv2.inpaint(img, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
        cv2.imwrite(output_path, cleaned_img)
    except:
        shutil.copyfile(img_path, output_path)

# --- API 路由 (保持不变) ---
@app.post("/upload/")
async def upload_image(file: UploadFile = File(...)):
    global current_image_path
    filename = f"{uuid.uuid4()}_{file.filename}"
    original_path = f"{TEMP_DIR}/original_{filename}"
    cleaned_path = f"{TEMP_DIR}/cleaned_{filename}"
    
    with open(original_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    inpaint_text(original_path, cleaned_path)
    current_image_path = cleaned_path
    
    image_pil = Image.open(cleaned_path).convert("RGB")
    predictor.set_image(np.array(image_pil))
    
    return JSONResponse({
        "message": "OK",
        "image_url": f"/uploads/{os.path.basename(cleaned_path)}", # 改为相对路径
        "image_width": image_pil.width,
        "image_height": image_pil.height
    })

@app.post("/segment/")
async def segment_point(x: float = Form(...), y: float = Form(...)):
    global current_image_path
    if not current_image_path: raise HTTPException(status_code=400, detail="No image")

    input_point = np.array([[int(x), int(y)]])
    masks, scores, _ = predictor.predict(point_coords=input_point, point_labels=np.array([1]), multimask_output=True)
    best_mask = masks[np.argmax(scores)]
    
    mask_img = Image.fromarray((best_mask * 255).astype(np.uint8)).convert("L")
    orig = Image.open(current_image_path).convert("RGBA")
    res = Image.new("RGBA", orig.size, (0,0,0,0))
    res.paste(orig, (0,0), mask_img)
    
    bbox = res.getbbox()
    if not bbox: raise HTTPException(400, "Empty")
    
    pad=2
    bbox = (max(0, bbox[0]-pad), max(0, bbox[1]-pad), min(orig.width, bbox[2]+pad), min(orig.height, bbox[3]+pad))
    res = res.crop(bbox)
    
    pid = str(uuid.uuid4())
    png_p = f"{TEMP_DIR}/p_{pid}.png"
    svg_p = f"{OUTPUT_DIR}/p_{pid}.svg"
    res.save(png_p)
    
    vtracer.convert_image_to_svg_py(
        png_p, svg_p, colormode='color', hierarchical='stacked', mode='spline',
        filter_speckle=4, color_precision=7, layer_difference=12,
        corner_threshold=45, length_threshold=10, max_iterations=10,
        splice_threshold=45, path_precision=4
    )
    
    return JSONResponse({
        "svg_url": f"/outputs/p_{pid}.svg", # 改为相对路径
        "offset_x": bbox[0], "offset_y": bbox[1]
    })

# --- 🔥 托管前端静态文件 (必须放在所有 API 路由之后) ---
# 1. 托管 _next 静态资源
app.mount("/_next", StaticFiles(directory=os.path.join(FRONTEND_DIST_DIR, "_next")), name="next")

# 2. 托管主页和其他静态文件
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    # 如果请求的是 API，跳过 (虽然上面已经匹配了，但为了保险)
    if full_path.startswith("upload/") or full_path.startswith("segment/"):
        return HTTPException(status_code=404)
        
    # 尝试在 out 目录下找文件
    file_path = os.path.join(FRONTEND_DIST_DIR, full_path)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    
    # 默认返回 index.html (SPA 单页应用支持)
    return FileResponse(os.path.join(FRONTEND_DIST_DIR, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)