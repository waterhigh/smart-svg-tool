import os
import shutil
import uuid
import logging
import numpy as np
import torch
import vtracer
from PIL import Image
from datetime import timedelta

# FastAPI 相关
from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordRequestForm

# 数据库与逻辑
from sqlalchemy.orm import Session
from app import models, database, schemas, crud, auth

# AI 模型 (只保留 SAM)
from segment_anything import sam_model_registry, SamPredictor
# ❌ 已删除 PaddleOCR 引用

# --- 1. 环境初始化 ---
# 自动创建数据库表
models.Base.metadata.create_all(bind=database.engine)

project_root = os.path.dirname(os.path.abspath(__file__))
fake_home_dir = os.path.join(project_root, "paddle_home") # 这个目录其实没用了，但留着防止报错
os.makedirs(fake_home_dir, exist_ok=True)
os.environ['USERPROFILE'] = fake_home_dir
os.environ['HOME'] = fake_home_dir
os.environ['XDG_CACHE_HOME'] = fake_home_dir

app = FastAPI()

# --- 2. 目录配置 ---
TEMP_DIR = "temp_uploads"
OUTPUT_DIR = "output_svgs"
FRONTEND_DIST_DIR = os.path.join(os.path.dirname(project_root), "frontend", "out")

os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
if not os.path.exists(FRONTEND_DIST_DIR):
    os.makedirs(FRONTEND_DIST_DIR)

# --- 3. 中间件配置 ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 4. AI 模型加载 (仅 SAM) ---
print("正在加载 SAM 模型...")
CHECKPOINT_PATH = r"F:\smart_svg_tool\weights\sam_vit_b_01ec64.pth" 
MODEL_TYPE = "vit_b"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

sam_loaded = False
if not os.path.exists(CHECKPOINT_PATH):
    print(f"❌ 错误：找不到 SAM 模型文件 {CHECKPOINT_PATH}")
    predictor = None
else:
    try:
        sam = sam_model_registry[MODEL_TYPE](checkpoint=CHECKPOINT_PATH)
        sam.to(device=DEVICE)
        predictor = SamPredictor(sam)
        sam_loaded = True
        print(f"✅ SAM 模型加载完成！(OCR 模块已禁用)")
    except Exception as e:
        print(f"❌ SAM 加载失败: {e}")
        predictor = None

# ❌ 已删除 OCR 初始化代码，节省大量内存！

current_image_path = None

# --- 5. 辅助函数 (修改版) ---
def inpaint_text(img_path, output_path):
    """
    修改版：不再进行 OCR 去字，直接复制文件。
    这样既节省了资源，又保证了后续代码逻辑（需要一个 output_path 文件）不中断。
    """
    shutil.copyfile(img_path, output_path)

# =========================================================
# 🔥 核心 API 路由
# =========================================================

# 1. 注册接口
@app.post("/users/", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(database.get_db)):
    db_user = crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    return crud.create_user(db=db, user=user)

# 2. 登录接口
@app.post("/token", response_model=dict)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(database.get_db)):
    user = crud.get_user_by_email(db, email=form_data.username)
    if not user or not crud.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

# 3. 上传接口
@app.post("/upload/")
async def upload_image(file: UploadFile = File(...), current_user: schemas.User = Depends(auth.get_current_user)):
    global current_image_path
    filename = f"{uuid.uuid4()}_{file.filename}"
    original_path = f"{TEMP_DIR}/original_{filename}"
    cleaned_path = f"{TEMP_DIR}/cleaned_{filename}"
    
    with open(original_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # 这里现在只是简单的复制文件，速度极快
    inpaint_text(original_path, cleaned_path)
    current_image_path = cleaned_path
    
    image_pil = Image.open(cleaned_path).convert("RGB")
    if predictor:
        predictor.set_image(np.array(image_pil))
    
    return JSONResponse({
        "message": "OK",
        "image_url": f"/uploads/{os.path.basename(cleaned_path)}",
        "image_width": image_pil.width,
        "image_height": image_pil.height
    })

# 4. 拆解接口
@app.post("/segment/")
async def segment_point(
    x: float = Form(...), 
    y: float = Form(...),
    current_user: schemas.User = Depends(auth.get_current_user)
):
    global current_image_path
    if not current_image_path: raise HTTPException(status_code=400, detail="No image")
    if not predictor: raise HTTPException(status_code=500, detail="AI Model not loaded")

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
        "svg_url": f"/outputs/p_{pid}.svg",
        "offset_x": bbox[0], "offset_y": bbox[1]
    })

# =========================================================
# 📂 静态文件托管
# =========================================================

app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")
app.mount("/uploads", StaticFiles(directory=TEMP_DIR), name="uploads")
app.mount("/", StaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)