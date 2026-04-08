from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager, contextmanager
from datetime import timedelta
from threading import BoundedSemaphore
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app import auth, crud, database, models, schemas
from app.config import settings
from app.segmentation import PRESETS, SegmentationService
from app.task_store import TaskStore


logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("smart_svg.api")

task_store = TaskStore(
    root_dir=settings.runtime_dir,
    ttl_hours=settings.task_ttl_hours,
    max_upload_mb=settings.max_upload_mb,
    max_image_side=settings.max_image_side,
)
segmentation_service = SegmentationService(task_store)
job_slots = BoundedSemaphore(settings.max_concurrent_jobs)
segment_slots = BoundedSemaphore(settings.max_concurrent_segments)


@asynccontextmanager
async def lifespan(_: FastAPI):
    database.ensure_schema()
    task_store.cleanup_expired()
    segmentation_service.load()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _parse_bool(raw_value: str | None, default: bool | None = None) -> bool | None:
    if raw_value is None:
        return default
    normalized = raw_value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


def _parse_points(raw_value: str) -> list[dict[str, Any]]:
    try:
        payload = json.loads(raw_value or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid point payload.") from exc

    if not isinstance(payload, list):
        raise HTTPException(status_code=400, detail="Point payload must be a list.")

    points: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Each point must be an object.")
        if "x" not in item or "y" not in item or "label" not in item:
            raise HTTPException(status_code=400, detail="Each point needs x, y, label.")
        points.append(
            {
                "x": float(item["x"]),
                "y": float(item["y"]),
                "label": int(item["label"]),
            }
        )
    return points


def _parse_box(raw_value: str | None) -> dict[str, float] | None:
    if not raw_value:
        return None
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid box payload.") from exc

    required_keys = {"x0", "y0", "x1", "y1"}
    if not isinstance(payload, dict) or not required_keys.issubset(payload):
        raise HTTPException(status_code=400, detail="Box payload is incomplete.")

    x0, x1 = sorted([float(payload["x0"]), float(payload["x1"])])
    y0, y1 = sorted([float(payload["y0"]), float(payload["y1"])])
    if abs(x1 - x0) < 2 or abs(y1 - y0) < 2:
        raise HTTPException(status_code=400, detail="The box is too small.")
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1}


@contextmanager
def _reserve_slot(semaphore: BoundedSemaphore, detail: str):
    if not semaphore.acquire(blocking=False):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail,
        )
    try:
        yield
    finally:
        semaphore.release()


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "model_ready": segmentation_service.ready,
        "model_error": segmentation_service.last_error,
        "device": segmentation_service.device,
        "presets": list(PRESETS.keys()),
    }


@app.get("/me", response_model=schemas.User | None)
async def read_current_user(
    current_user: schemas.User | None = Depends(auth.get_current_user_optional),
):
    return current_user


@app.post("/users/", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(database.get_db)):
    db_user = crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered.")
    return crud.create_user(db=db, user=user)


@app.post("/token", response_model=schemas.Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(database.get_db),
):
    user = crud.get_user_by_email(db, email=form_data.username)
    if not user or not crud.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = auth.create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/upload/")
async def upload_image(
    file: UploadFile = File(...),
    current_user=Depends(auth.get_current_user_with_basic_access),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload a valid image file.")

    try:
        with _reserve_slot(
            job_slots,
            "The server is busy. Please try your upload again in a moment.",
        ):
            task = await run_in_threadpool(task_store.create_task, file)
        logger.info(
            "Upload created",
            extra={
                "upload_id": task.upload_id,
                "owner": getattr(current_user, "email", None),
                "width": task.width,
                "height": task.height,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return JSONResponse(
        {
            "message": "ok",
            "upload_id": task.upload_id,
            "image_url": task_store.to_media_url(task.working_file),
            "image_width": task.width,
            "image_height": task.height,
            "expires_at": task.expires_at,
        }
    )


@app.post("/segment/")
async def segment_image(
    upload_id: str = Form(...),
    points_json: str = Form("[]"),
    box_json: str = Form(""),
    preset: str = Form("photo"),
    vector_mode: str = Form("color"),
    detail: int = Form(2),
    smoothing: int = Form(2),
    keep_holes: str = Form("true"),
    largest_component: str | None = Form(None),
    current_user=Depends(auth.get_current_user_with_basic_access),
):
    points = _parse_points(points_json)
    box = _parse_box(box_json)
    keep_holes_value = bool(_parse_bool(keep_holes, True))
    largest_component_value = _parse_bool(largest_component, None)
    if not points and not box:
        raise HTTPException(
            status_code=400,
            detail="Add at least one point or one box before extracting.",
        )

    try:
        task = task_store.get_task(upload_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        with _reserve_slot(
            job_slots,
            "The server is busy. Please try your request again in a moment.",
        ):
            with _reserve_slot(
                segment_slots,
                (
                    "Too many segmentation requests are in progress. "
                    "Please try again in a moment."
                ),
            ):
                candidates = await run_in_threadpool(
                    segmentation_service.segment,
                    task,
                    points,
                    box,
                    preset,
                    vector_mode,
                    detail,
                    smoothing,
                    keep_holes_value,
                    largest_component_value,
                )
        logger.info(
            "Segmentation completed",
            extra={
                "upload_id": upload_id,
                "owner": getattr(current_user, "email", None),
                "preset": preset,
                "vector_mode": vector_mode,
                "candidates": len(candidates),
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return JSONResponse(
        {
            "upload_id": upload_id,
            "preset": preset,
            "vector_mode": vector_mode,
            "candidates": candidates,
        }
    )


app.mount("/media", StaticFiles(directory=settings.runtime_dir), name="media")

if settings.serve_frontend and settings.frontend_dist_dir.exists():
    app.mount(
        "/",
        StaticFiles(directory=settings.frontend_dist_dir, html=True),
        name="frontend",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
