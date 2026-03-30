from __future__ import annotations

import logging
from base64 import b64encode
from io import BytesIO
from dataclasses import dataclass
from threading import Lock
from typing import Any

import cv2
import numpy as np
import torch
import vtracer
from PIL import Image
from segment_anything import SamPredictor, sam_model_registry

from .config import settings
from .task_store import TaskMeta, TaskStore


def _odd(value: int) -> int:
    value = max(1, int(value))
    return value if value % 2 == 1 else value + 1


@dataclass(frozen=True)
class PresetConfig:
    key: str
    label: str
    default_vector_mode: str
    close_kernel: int
    open_kernel: int
    blur_kernel: int
    min_component_ratio: float
    max_hole_ratio: float
    padding: int
    filter_speckle: int
    color_precision: int
    layer_difference: int
    corner_threshold: int
    length_threshold: int
    max_iterations: int
    splice_threshold: int
    path_precision: int
    keep_largest_component: bool


PRESETS: dict[str, PresetConfig] = {
    "logo": PresetConfig(
        key="logo",
        label="Logo / Icon",
        default_vector_mode="color",
        close_kernel=3,
        open_kernel=1,
        blur_kernel=3,
        min_component_ratio=0.00002,
        max_hole_ratio=0.0002,
        padding=14,
        filter_speckle=6,
        color_precision=6,
        layer_difference=18,
        corner_threshold=52,
        length_threshold=11,
        max_iterations=8,
        splice_threshold=30,
        path_precision=7,
        keep_largest_component=True,
    ),
    "illustration": PresetConfig(
        key="illustration",
        label="Illustration / Sticker",
        default_vector_mode="color",
        close_kernel=5,
        open_kernel=3,
        blur_kernel=5,
        min_component_ratio=0.00004,
        max_hole_ratio=0.00035,
        padding=12,
        filter_speckle=4,
        color_precision=7,
        layer_difference=12,
        corner_threshold=45,
        length_threshold=8,
        max_iterations=10,
        splice_threshold=38,
        path_precision=5,
        keep_largest_component=False,
    ),
    "photo": PresetConfig(
        key="photo",
        label="Photo / Complex Subject",
        default_vector_mode="masked-image",
        close_kernel=7,
        open_kernel=3,
        blur_kernel=7,
        min_component_ratio=0.00006,
        max_hole_ratio=0.00045,
        padding=10,
        filter_speckle=2,
        color_precision=8,
        layer_difference=8,
        corner_threshold=38,
        length_threshold=6,
        max_iterations=12,
        splice_threshold=45,
        path_precision=4,
        keep_largest_component=False,
    ),
}


class SegmentationService:
    def __init__(self, task_store: TaskStore) -> None:
        self.task_store = task_store
        self.logger = logging.getLogger("smart_svg.segmentation")
        self._sam_model: Any | None = None
        self._lock = Lock()
        self.ready = False
        self.last_error: str | None = None
        self.device = self._resolve_device()

    def load(self) -> None:
        if self.ready:
            return

        checkpoint_path = settings.sam_checkpoint_path
        if not checkpoint_path.exists():
            self.last_error = f"Missing SAM checkpoint: {checkpoint_path}"
            self.logger.error(self.last_error)
            return

        try:
            model = sam_model_registry[settings.sam_model_type](
                checkpoint=str(checkpoint_path)
            )
            model.to(device=self.device)
            self._sam_model = model
            self.ready = True
            self.last_error = None
            self.logger.info(
                "SAM model loaded",
                extra={"device": self.device, "checkpoint": str(checkpoint_path)},
            )
        except Exception as exc:  # noqa: BLE001
            self.last_error = str(exc)
            self.logger.exception("Failed to load SAM model")

    def segment(
        self,
        task: TaskMeta,
        points: list[dict[str, Any]],
        box: dict[str, float] | None,
        preset_name: str,
        vector_mode: str,
        detail: int,
        smoothing: int,
        keep_holes: bool,
        largest_component: bool | None,
    ) -> list[dict[str, Any]]:
        if not self.ready or self._sam_model is None:
            raise RuntimeError(self.last_error or "SAM model is not ready.")

        preset = PRESETS.get(preset_name, PRESETS["illustration"])
        detail = max(1, min(3, detail))
        smoothing = max(1, min(3, smoothing))
        effective_vector_mode = (
            preset.default_vector_mode if vector_mode == "auto" else vector_mode
        )
        keep_largest_component = (
            preset.keep_largest_component
            if largest_component is None
            else largest_component
        )

        with Image.open(task.working_file) as pil_image:
            image_rgba = pil_image.convert("RGBA")
            image_rgb = np.array(image_rgba.convert("RGB"))

        raw_masks, scores = self._predict_masks(image_rgb, points, box)
        unique_candidates = self._build_candidates(
            raw_masks=raw_masks,
            scores=scores,
            image_shape=image_rgb.shape[:2],
            preset=preset,
            detail=detail,
            smoothing=smoothing,
            keep_holes=keep_holes,
            keep_largest_component=keep_largest_component,
        )

        if not unique_candidates:
            raise ValueError("No usable mask candidates were produced.")

        segment_id, segment_dir = self.task_store.create_segment_dir(task.upload_id)
        response_candidates: list[dict[str, Any]] = []

        for index, candidate in enumerate(unique_candidates, start=1):
            normalized_score = max(0.0, min(1.0, float(candidate["score"])))
            cropped_rgba, cropped_mask, bbox = self._crop_cutout(
                image_rgba,
                candidate["mask"],
                padding=preset.padding + (detail - 2) * 2,
            )

            preview_path = segment_dir / f"candidate_{index}.png"
            svg_path = segment_dir / f"candidate_{index}.svg"
            cropped_rgba.save(preview_path, format="PNG")

            resolved_mode = effective_vector_mode
            try:
                if resolved_mode == "contour":
                    svg_markup = self._mask_to_contour_svg(
                        cropped_mask,
                        cropped_rgba,
                        smoothing=smoothing,
                        detail=detail,
                    )
                    svg_path.write_text(svg_markup, encoding="utf-8")
                elif resolved_mode == "masked-image":
                    svg_markup = self._rgba_to_embedded_image_svg(cropped_rgba)
                    svg_path.write_text(svg_markup, encoding="utf-8")
                else:
                    vtracer.convert_image_to_svg_py(
                        str(preview_path),
                        str(svg_path),
                        colormode="color",
                        hierarchical="stacked",
                        mode="spline",
                        **self._build_vtracer_params(preset, detail, smoothing),
                    )
            except Exception:  # noqa: BLE001
                self.logger.exception(
                    "Vectorization failed, falling back to contour mode",
                    extra={"upload_id": task.upload_id, "segment_id": segment_id},
                )
                resolved_mode = "contour"
                svg_markup = self._mask_to_contour_svg(
                    cropped_mask,
                    cropped_rgba,
                    smoothing=smoothing,
                    detail=detail,
                )
                svg_path.write_text(svg_markup, encoding="utf-8")

            response_candidates.append(
                {
                    "id": f"{segment_id}_{index}",
                    "label": candidate["label"],
                    "score": round(normalized_score, 4),
                    "score_percent": round(normalized_score * 100, 1),
                    "area": int(candidate["area"]),
                    "preview_url": self.task_store.to_media_url(preview_path),
                    "svg_url": self.task_store.to_media_url(svg_path),
                    "offset_x": bbox[0],
                    "offset_y": bbox[1],
                    "width": cropped_rgba.width,
                    "height": cropped_rgba.height,
                    "vector_mode": resolved_mode,
                }
            )

        return response_candidates

    def _resolve_device(self) -> str:
        if settings.sam_device != "auto":
            return settings.sam_device
        return "cuda" if torch.cuda.is_available() else "cpu"

    def _predict_masks(
        self,
        image_rgb: np.ndarray,
        points: list[dict[str, Any]],
        box: dict[str, float] | None,
    ) -> tuple[np.ndarray, np.ndarray]:
        point_coords = None
        point_labels = None
        if points:
            point_coords = np.array(
                [[float(point["x"]), float(point["y"])] for point in points],
                dtype=np.float32,
            )
            point_labels = np.array(
                [1 if int(point["label"]) > 0 else 0 for point in points],
                dtype=np.int32,
            )

        box_array = None
        if box:
            box_array = np.array(
                [
                    float(box["x0"]),
                    float(box["y0"]),
                    float(box["x1"]),
                    float(box["y1"]),
                ],
                dtype=np.float32,
            )

        with self._lock:
            predictor = SamPredictor(self._sam_model)
            predictor.set_image(image_rgb)
            masks, scores, _ = predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=box_array,
                multimask_output=True,
            )

        return masks, scores

    def _build_candidates(
        self,
        raw_masks: np.ndarray,
        scores: np.ndarray,
        image_shape: tuple[int, int],
        preset: PresetConfig,
        detail: int,
        smoothing: int,
        keep_holes: bool,
        keep_largest_component: bool,
    ) -> list[dict[str, Any]]:
        processed_candidates: list[dict[str, Any]] = []
        for mask, score in zip(raw_masks, scores, strict=False):
            refined_mask = self._postprocess_mask(
                mask=mask,
                image_shape=image_shape,
                preset=preset,
                detail=detail,
                smoothing=smoothing,
                keep_holes=keep_holes,
                keep_largest_component=keep_largest_component,
            )
            area = int(refined_mask.sum())
            if area <= 24:
                continue
            processed_candidates.append(
                {"mask": refined_mask, "score": float(score), "area": area}
            )

        processed_candidates.sort(key=lambda item: item["score"], reverse=True)

        unique_candidates: list[dict[str, Any]] = []
        for candidate in processed_candidates:
            is_duplicate = any(
                self._mask_iou(candidate["mask"], existing["mask"]) > 0.97
                for existing in unique_candidates
            )
            if not is_duplicate:
                unique_candidates.append(candidate)
            if len(unique_candidates) == 3:
                break

        if not unique_candidates:
            return []

        areas = [candidate["area"] for candidate in unique_candidates]
        area_order = np.argsort(np.array(areas))
        labels = ["Balanced"] * len(unique_candidates)
        if len(unique_candidates) > 1:
            labels[int(area_order[0])] = "Tight"
            labels[int(area_order[-1])] = "Complete"
            if len(unique_candidates) == 3:
                middle_index = next(
                    idx
                    for idx in range(3)
                    if idx not in (int(area_order[0]), int(area_order[-1]))
                )
                labels[middle_index] = "Balanced"

        for candidate, label in zip(unique_candidates, labels, strict=False):
            candidate["label"] = label

        return unique_candidates

    def _postprocess_mask(
        self,
        mask: np.ndarray,
        image_shape: tuple[int, int],
        preset: PresetConfig,
        detail: int,
        smoothing: int,
        keep_holes: bool,
        keep_largest_component: bool,
    ) -> np.ndarray:
        binary = (mask.astype(np.uint8) * 255).copy()
        image_area = image_shape[0] * image_shape[1]

        close_kernel = _odd(preset.close_kernel + (smoothing - 2) * 2)
        open_kernel = _odd(max(1, preset.open_kernel + (2 - detail) * 2))

        if close_kernel > 1:
            binary = cv2.morphologyEx(
                binary,
                cv2.MORPH_CLOSE,
                np.ones((close_kernel, close_kernel), dtype=np.uint8),
            )

        if open_kernel > 1:
            binary = cv2.morphologyEx(
                binary,
                cv2.MORPH_OPEN,
                np.ones((open_kernel, open_kernel), dtype=np.uint8),
            )

        min_component_area = max(
            64,
            int(image_area * preset.min_component_ratio * (1.2 - (detail - 1) * 0.2)),
        )
        binary = self._remove_small_components(binary, min_component_area)

        if keep_largest_component:
            binary = self._keep_largest_component(binary)

        max_hole_area = max(
            48,
            int(image_area * preset.max_hole_ratio * (0.7 + smoothing * 0.25)),
        )
        if keep_holes:
            binary = self._fill_small_holes(binary, max_hole_area)
        else:
            binary = self._fill_all_holes(binary)

        blur_kernel = _odd(max(1, preset.blur_kernel + (smoothing - 2) * 2))
        if blur_kernel > 1:
            binary = cv2.GaussianBlur(binary, (blur_kernel, blur_kernel), 0)
            _, binary = cv2.threshold(binary, 127, 255, cv2.THRESH_BINARY)

        return binary.astype(bool)

    def _crop_cutout(
        self,
        image_rgba: Image.Image,
        mask: np.ndarray,
        padding: int,
    ) -> tuple[Image.Image, np.ndarray, tuple[int, int, int, int]]:
        mask_uint8 = mask.astype(np.uint8) * 255
        mask_image = Image.fromarray(mask_uint8, mode="L")
        bbox = mask_image.getbbox()
        if bbox is None:
            raise ValueError("The selected mask is empty.")

        left = max(0, bbox[0] - padding)
        top = max(0, bbox[1] - padding)
        right = min(image_rgba.width, bbox[2] + padding)
        bottom = min(image_rgba.height, bbox[3] + padding)

        crop_box = (left, top, right, bottom)
        masked_image = Image.new("RGBA", image_rgba.size, (0, 0, 0, 0))
        masked_image.paste(image_rgba, (0, 0), mask_image)
        cropped_rgba = masked_image.crop(crop_box)
        cropped_mask = (mask_uint8[top:bottom, left:right] > 0).astype(np.uint8)
        return cropped_rgba, cropped_mask, crop_box

    def _build_vtracer_params(
        self,
        preset: PresetConfig,
        detail: int,
        smoothing: int,
    ) -> dict[str, int]:
        return {
            "filter_speckle": max(0, preset.filter_speckle + (2 - detail) * 2),
            "color_precision": max(2, preset.color_precision + (detail - 2)),
            "layer_difference": max(2, preset.layer_difference + (2 - detail) * 3),
            "corner_threshold": max(
                10, preset.corner_threshold - (smoothing - 2) * 6
            ),
            "length_threshold": max(
                2, preset.length_threshold + (2 - detail) * 3
            ),
            "max_iterations": max(
                4, preset.max_iterations + (detail - 2) * 2
            ),
            "splice_threshold": max(
                10, preset.splice_threshold - (smoothing - 2) * 4
            ),
            "path_precision": max(
                1, preset.path_precision + (2 - detail) + (smoothing - 2)
            ),
        }

    def _mask_to_contour_svg(
        self,
        mask: np.ndarray,
        image_rgba: Image.Image,
        smoothing: int,
        detail: int,
    ) -> str:
        mask_uint8 = mask.astype(np.uint8) * 255
        contours, _ = cv2.findContours(
            mask_uint8,
            cv2.RETR_CCOMP,
            cv2.CHAIN_APPROX_NONE,
        )
        if not contours:
            raise ValueError("No contour could be extracted from the mask.")

        rgba_array = np.array(image_rgba)
        selected_pixels = rgba_array[mask.astype(bool)]
        if selected_pixels.size == 0:
            fill_rgb = (17, 24, 39)
            fill_alpha = 1.0
        else:
            fill_rgb = tuple(
                int(round(value))
                for value in selected_pixels[:, :3].mean(axis=0).tolist()
            )
            fill_alpha = float(selected_pixels[:, 3].mean() / 255.0)

        epsilon_scale = max(
            0.002,
            0.01 - (detail - 1) * 0.002 + (smoothing - 2) * 0.002,
        )
        path_segments: list[str] = []

        for contour in contours:
            if len(contour) < 3:
                continue
            perimeter = cv2.arcLength(contour, True)
            epsilon = max(0.8, perimeter * epsilon_scale)
            approx = cv2.approxPolyDP(contour, epsilon, True)
            points = approx.reshape(-1, 2)
            if len(points) < 3:
                continue
            commands = [f"M {points[0][0]:.2f} {points[0][1]:.2f}"]
            commands.extend(f"L {x:.2f} {y:.2f}" for x, y in points[1:])
            commands.append("Z")
            path_segments.append(" ".join(commands))

        if not path_segments:
            raise ValueError("Contour simplification removed all paths.")

        fill_hex = "#{:02x}{:02x}{:02x}".format(*fill_rgb)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{image_rgba.width}" height="{image_rgba.height}" '
            f'viewBox="0 0 {image_rgba.width} {image_rgba.height}">'
            f'<path d="{" ".join(path_segments)}" fill="{fill_hex}" '
            f'fill-opacity="{fill_alpha:.3f}" fill-rule="evenodd" />'
            "</svg>"
        )

    def _rgba_to_embedded_image_svg(self, image_rgba: Image.Image) -> str:
        png_buffer = BytesIO()
        image_rgba.save(png_buffer, format="PNG")
        png_base64 = b64encode(png_buffer.getvalue()).decode("ascii")
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{image_rgba.width}" height="{image_rgba.height}" '
            f'viewBox="0 0 {image_rgba.width} {image_rgba.height}">'
            f'<image width="{image_rgba.width}" height="{image_rgba.height}" '
            f'href="data:image/png;base64,{png_base64}" />'
            "</svg>"
        )

    def _remove_small_components(self, binary: np.ndarray, min_area: int) -> np.ndarray:
        component_count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
        cleaned = np.zeros_like(binary)
        for index in range(1, component_count):
            if stats[index, cv2.CC_STAT_AREA] >= min_area:
                cleaned[labels == index] = 255
        return cleaned

    def _keep_largest_component(self, binary: np.ndarray) -> np.ndarray:
        component_count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
        if component_count <= 1:
            return binary

        largest_index = max(
            range(1, component_count),
            key=lambda index: stats[index, cv2.CC_STAT_AREA],
        )
        cleaned = np.zeros_like(binary)
        cleaned[labels == largest_index] = 255
        return cleaned

    def _fill_all_holes(self, binary: np.ndarray) -> np.ndarray:
        flood = binary.copy()
        height, width = binary.shape[:2]
        mask = np.zeros((height + 2, width + 2), dtype=np.uint8)
        cv2.floodFill(flood, mask, (0, 0), 255)
        inverse = cv2.bitwise_not(flood)
        return cv2.bitwise_or(binary, inverse)

    def _fill_small_holes(self, binary: np.ndarray, max_hole_area: int) -> np.ndarray:
        inverse = cv2.bitwise_not(binary)
        component_count, labels, stats, _ = cv2.connectedComponentsWithStats(inverse, 8)
        filled = binary.copy()
        border_labels = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(
            labels[:, -1]
        )
        for index in range(1, component_count):
            if index in border_labels:
                continue
            if stats[index, cv2.CC_STAT_AREA] <= max_hole_area:
                filled[labels == index] = 255
        return filled

    def _mask_iou(self, first: np.ndarray, second: np.ndarray) -> float:
        intersection = np.logical_and(first, second).sum()
        union = np.logical_or(first, second).sum()
        if union == 0:
            return 0.0
        return float(intersection / union)
