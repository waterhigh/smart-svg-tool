from __future__ import annotations

import json
import shutil
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class TaskMeta:
    upload_id: str
    created_at: str
    updated_at: str
    expires_at: str
    original_path: str
    working_path: str
    width: int
    height: int

    @property
    def original_file(self) -> Path:
        return Path(self.original_path)

    @property
    def working_file(self) -> Path:
        return Path(self.working_path)


class TaskStore:
    def __init__(
        self,
        root_dir: Path,
        ttl_hours: int,
        max_upload_mb: int,
        max_image_side: int,
    ) -> None:
        self.root_dir = root_dir
        self.tasks_dir = self.root_dir / "tasks"
        self.ttl = timedelta(hours=ttl_hours)
        self.max_upload_bytes = max_upload_mb * 1024 * 1024
        self.max_image_side = max_image_side

        self.tasks_dir.mkdir(parents=True, exist_ok=True)

    def create_task(self, uploaded_file: Any) -> TaskMeta:
        upload_id = uuid.uuid4().hex
        task_dir = self.tasks_dir / upload_id
        task_dir.mkdir(parents=True, exist_ok=True)

        original_suffix = Path(uploaded_file.filename or "upload.png").suffix.lower()
        if not original_suffix:
            original_suffix = ".png"

        original_path = task_dir / f"original{original_suffix}"
        with original_path.open("wb") as buffer:
            shutil.copyfileobj(uploaded_file.file, buffer)

        if original_path.stat().st_size > self.max_upload_bytes:
            shutil.rmtree(task_dir, ignore_errors=True)
            raise ValueError("The uploaded image exceeds the file-size limit.")

        try:
            with Image.open(original_path) as image:
                normalized = ImageOps.exif_transpose(image).convert("RGBA")
                normalized = self._resize_if_needed(normalized)
                width, height = normalized.size
                working_path = task_dir / "working.png"
                normalized.save(working_path, format="PNG")
        except Exception as exc:  # noqa: BLE001
            shutil.rmtree(task_dir, ignore_errors=True)
            raise ValueError("Unsupported or corrupted image file.") from exc

        now = utc_now()
        task = TaskMeta(
            upload_id=upload_id,
            created_at=now.isoformat(),
            updated_at=now.isoformat(),
            expires_at=(now + self.ttl).isoformat(),
            original_path=str(original_path.resolve()),
            working_path=str(working_path.resolve()),
            width=width,
            height=height,
        )
        self._write_task(task)
        return task

    def get_task(self, upload_id: str, refresh_ttl: bool = True) -> TaskMeta:
        task = self._read_task(upload_id)
        expires_at = datetime.fromisoformat(task.expires_at)
        if expires_at <= utc_now():
            self.delete_task(upload_id)
            raise FileNotFoundError("The upload has expired.")

        if refresh_ttl:
            task = self.touch(task)
        return task

    def touch(self, task: TaskMeta) -> TaskMeta:
        now = utc_now()
        task.updated_at = now.isoformat()
        task.expires_at = (now + self.ttl).isoformat()
        self._write_task(task)
        return task

    def create_segment_dir(self, upload_id: str) -> tuple[str, Path]:
        segment_id = uuid.uuid4().hex
        segment_dir = self.tasks_dir / upload_id / "segments" / segment_id
        segment_dir.mkdir(parents=True, exist_ok=True)
        return segment_id, segment_dir

    def delete_task(self, upload_id: str) -> None:
        task_dir = self.tasks_dir / upload_id
        if task_dir.exists():
            shutil.rmtree(task_dir, ignore_errors=True)

    def cleanup_expired(self) -> None:
        for task_dir in self.tasks_dir.iterdir():
            if not task_dir.is_dir():
                continue
            try:
                task = self._read_task(task_dir.name)
            except Exception:  # noqa: BLE001
                shutil.rmtree(task_dir, ignore_errors=True)
                continue

            expires_at = datetime.fromisoformat(task.expires_at)
            if expires_at <= utc_now():
                shutil.rmtree(task_dir, ignore_errors=True)

    def to_media_url(self, file_path: Path | str) -> str:
        path = Path(file_path).resolve()
        relative_path = path.relative_to(self.root_dir.resolve())
        return f"/media/{relative_path.as_posix()}"

    def _task_meta_path(self, upload_id: str) -> Path:
        return self.tasks_dir / upload_id / "task.json"

    def _read_task(self, upload_id: str) -> TaskMeta:
        meta_path = self._task_meta_path(upload_id)
        if not meta_path.exists():
            raise FileNotFoundError("Upload not found.")

        payload = json.loads(meta_path.read_text(encoding="utf-8"))
        return TaskMeta(**payload)

    def _write_task(self, task: TaskMeta) -> None:
        meta_path = self._task_meta_path(task.upload_id)
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(
            json.dumps(asdict(task), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _resize_if_needed(self, image: Image.Image) -> Image.Image:
        max_side = max(image.size)
        if max_side <= self.max_image_side:
            return image

        scale = self.max_image_side / max_side
        new_size = (
            max(1, int(image.width * scale)),
            max(1, int(image.height * scale)),
        )
        return image.resize(new_size, Image.Resampling.LANCZOS)
