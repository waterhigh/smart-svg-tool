'use client';

import { message } from 'antd';
import { fabric } from 'fabric';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { apiUrl } from './lib/api';

type PromptMode = 'positive' | 'negative' | 'box';
type PresetKey = 'logo' | 'illustration' | 'photo';
type VectorMode = 'auto' | 'color' | 'contour';

type PromptPoint = {
  id: string;
  x: number;
  y: number;
  label: 0 | 1;
};

type BoxSelection = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type Candidate = {
  id: string;
  label: string;
  score_percent: number;
  preview_url: string;
  svg_url: string;
  offset_x: number;
  offset_y: number;
  vector_mode: string;
  width: number;
  height: number;
};

interface SvgEditorProps {
  uploadId: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  expiresAt: string;
  onReset: () => void;
}

function normalizeBox(box: BoxSelection): BoxSelection {
  return {
    x0: Math.min(box.x0, box.x1),
    y0: Math.min(box.y0, box.y1),
    x1: Math.max(box.x0, box.x1),
    y1: Math.max(box.y0, box.y1),
  };
}

export default function SvgEditor({
  uploadId,
  imageUrl,
  imageWidth,
  imageHeight,
  expiresAt,
  onReset,
}: SvgEditorProps) {
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const boxDragStart = useRef<{ x: number; y: number } | null>(null);

  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [promptMode, setPromptMode] = useState<PromptMode>('positive');
  const [points, setPoints] = useState<PromptPoint[]>([]);
  const [box, setBox] = useState<BoxSelection | null>(null);
  const [draftBox, setDraftBox] = useState<BoxSelection | null>(null);
  const [preset, setPreset] = useState<PresetKey>('photo');
  const [vectorMode, setVectorMode] = useState<VectorMode>('color');
  const [detail, setDetail] = useState(2);
  const [smoothing, setSmoothing] = useState(2);
  const [keepHoles, setKeepHoles] = useState(true);
  const [largestComponent, setLargestComponent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const isDragging = useRef(false);
  const lastPosX = useRef(0);
  const lastPosY = useRef(0);

  useEffect(() => {
    if (preset === 'logo') {
      setLargestComponent(true);
      setKeepHoles(true);
    }
  }, [preset]);

  useEffect(() => {
    if (!canvasEl.current) {
      return;
    }

    const fabricCanvas = new fabric.Canvas(canvasEl.current, {
      width: canvasEl.current.parentElement?.clientWidth || 700,
      height: canvasEl.current.parentElement?.clientHeight || 600,
      backgroundColor: 'rgba(255,250,241,0.65)',
      preserveObjectStacking: true,
    });

    fabricCanvas.on('mouse:wheel', (opt) => {
      const evt = opt.e;
      if (evt.altKey !== true) {
        return;
      }
      const delta = evt.deltaY;
      let zoom = fabricCanvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.min(20, Math.max(0.15, zoom));
      fabricCanvas.zoomToPoint({ x: evt.offsetX, y: evt.offsetY }, zoom);
      evt.preventDefault();
      evt.stopPropagation();
    });

    fabricCanvas.on('mouse:down', (opt) => {
      const evt = opt.e;
      if (evt.altKey !== true) {
        return;
      }
      isDragging.current = true;
      fabricCanvas.selection = false;
      lastPosX.current = evt.clientX;
      lastPosY.current = evt.clientY;
    });

    fabricCanvas.on('mouse:move', (opt) => {
      if (!isDragging.current) {
        return;
      }
      const event = opt.e;
      const viewport = fabricCanvas.viewportTransform;
      if (!viewport) {
        return;
      }
      viewport[4] += event.clientX - lastPosX.current;
      viewport[5] += event.clientY - lastPosY.current;
      fabricCanvas.requestRenderAll();
      lastPosX.current = event.clientX;
      lastPosY.current = event.clientY;
    });

    fabricCanvas.on('mouse:up', () => {
      if (!isDragging.current) {
        return;
      }
      fabricCanvas.setViewportTransform(
        fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0],
      );
      isDragging.current = false;
      fabricCanvas.selection = true;
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!canvasEl.current?.parentElement) {
        return;
      }
      fabricCanvas.setWidth(canvasEl.current.parentElement.clientWidth);
      fabricCanvas.setHeight(canvasEl.current.parentElement.clientHeight);
      fabricCanvas.renderAll();
    });

    if (canvasEl.current.parentElement) {
      resizeObserver.observe(canvasEl.current.parentElement);
    }

    setCanvas(fabricCanvas);

    return () => {
      resizeObserver.disconnect();
      fabricCanvas.dispose();
    };
  }, []);

  useEffect(() => {
    if (!canvas) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length === 0) {
          return;
        }
        canvas.discardActiveObject();
        activeObjects.forEach((object) => canvas.remove(object));
        canvas.requestRenderAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvas]);

  const getRelativePoint = (event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const frame = imageFrameRef.current;
    if (!frame) {
      return null;
    }

    const rect = frame.getBoundingClientRect();
    const scaleX = imageWidth / rect.width;
    const scaleY = imageHeight / rect.height;
    const x = Math.min(imageWidth, Math.max(0, (event.clientX - rect.left) * scaleX));
    const y = Math.min(imageHeight, Math.max(0, (event.clientY - rect.top) * scaleY));
    return { x, y };
  };

  const handlePromptClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (promptMode === 'box' || loading) {
      return;
    }
    const point = getRelativePoint(event);
    if (!point) {
      return;
    }
    setPoints((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        x: point.x,
        y: point.y,
        label: promptMode === 'positive' ? 1 : 0,
      },
    ]);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (promptMode !== 'box' || loading) {
      return;
    }
    const point = getRelativePoint(event);
    if (!point) {
      return;
    }
    boxDragStart.current = point;
    setDraftBox({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!boxDragStart.current || promptMode !== 'box') {
      return;
    }
    const point = getRelativePoint(event);
    if (!point) {
      return;
    }
    setDraftBox({
      x0: boxDragStart.current.x,
      y0: boxDragStart.current.y,
      x1: point.x,
      y1: point.y,
    });
  };

  const handlePointerUp = () => {
    if (!draftBox) {
      return;
    }
    const normalized = normalizeBox(draftBox);
    if (Math.abs(normalized.x1 - normalized.x0) < 6 || Math.abs(normalized.y1 - normalized.y0) < 6) {
      setDraftBox(null);
      boxDragStart.current = null;
      return;
    }
    setBox(normalized);
    setDraftBox(null);
    boxDragStart.current = null;
  };

  const extractCandidates = async () => {
    if (loading) {
      return;
    }
    if (points.length === 0 && !box) {
      message.warning('至少添加一个正点、负点，或者画一个框。');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('upload_id', uploadId);
      formData.append('points_json', JSON.stringify(points));
      if (box) {
        formData.append('box_json', JSON.stringify(box));
      }
      formData.append('preset', preset);
      formData.append('vector_mode', vectorMode);
      formData.append('detail', String(detail));
      formData.append('smoothing', String(smoothing));
      formData.append('keep_holes', String(keepHoles));
      formData.append('largest_component', String(largestComponent));

      const token = localStorage.getItem('smart_svg_token');
      const response = await fetch(apiUrl('/segment/'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}` 
        },
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || '分割失败。');
      }

      setCandidates(payload.candidates || []);
      message.success('候选结果已生成，先挑一个最合适的再加入画布。');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '分割失败。';
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const addCandidateToCanvas = (candidate: Candidate) => {
    if (!canvas) {
      return;
    }

    if (candidate.vector_mode === 'masked-image') {
      void addMaskedImageCandidateToCanvas(candidate);
      return;
    }

    fabric.loadSVGFromURL(apiUrl(candidate.svg_url), (objects, options) => {
      if (!objects || objects.length === 0) {
        message.error('候选 SVG 解析失败，请重新生成候选结果。');
        return;
      }

      const svgGroup = fabric.util.groupSVGElements(objects, options);
      svgGroup.set({
        left: candidate.offset_x,
        top: candidate.offset_y,
        perPixelTargetFind: true,
      });

      canvas.add(svgGroup);
      canvas.setActiveObject(svgGroup);
      canvas.requestRenderAll();
      message.success(`${candidate.label} 候选已加入画布。`);
    });
  };

  const addMaskedImageCandidateToCanvas = async (candidate: Candidate) => {
    if (!canvas) {
      return;
    }

    try {
      const response = await fetch(apiUrl(candidate.preview_url));
      if (!response.ok) {
        throw new Error('预览图加载失败。');
      }

      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
            return;
          }
          reject(new Error('预览图读取失败。'));
        };
        reader.onerror = () => reject(new Error('预览图读取失败。'));
        reader.readAsDataURL(blob);
      });

      fabric.Image.fromURL(
        dataUrl,
        (image) => {
          image.set({
            left: candidate.offset_x,
            top: candidate.offset_y,
            selectable: true,
          });
          canvas.add(image);
          canvas.setActiveObject(image);
          canvas.requestRenderAll();
          message.success(`${candidate.label} 候选已加入画布。`);
        },
        { crossOrigin: 'anonymous' },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '预览图加载失败。';
      message.error(errorMessage);
    }
  };

  const exportCanvas = () => {
    if (!canvas) {
      return;
    }

    const activeObject = canvas.getActiveObject();
    const download = (content: string, fileName: string) => {
      const blob = new Blob([content], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    };

    if (activeObject) {
      activeObject.clone((cloned: fabric.Object) => {
        const padding = 12;
        const tempCanvas = new fabric.StaticCanvas(null, {
          width: cloned.getScaledWidth() + padding * 2,
          height: cloned.getScaledHeight() + padding * 2,
          backgroundColor: 'transparent',
        });

        cloned.set({
          left: padding,
          top: padding,
          originX: 'left',
          originY: 'top',
        });
        tempCanvas.add(cloned);
        download(tempCanvas.toSVG(), 'selected-smart-svg.svg');
        tempCanvas.dispose();
      });
      return;
    }

    const originalBackground = canvas.backgroundColor;
    const originalViewport = canvas.viewportTransform;
    const originalWidth = canvas.getWidth();
    const originalHeight = canvas.getHeight();

    canvas.setBackgroundColor(null as never, () => {});
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.setWidth(imageWidth);
    canvas.setHeight(imageHeight);
    const svg = canvas.toSVG();

    canvas.setWidth(originalWidth);
    canvas.setHeight(originalHeight);
    if (originalViewport) {
      canvas.setViewportTransform(originalViewport);
    }
    canvas.setBackgroundColor(originalBackground as string, canvas.renderAll.bind(canvas));

    download(svg, 'full-smart-svg.svg');
  };

  const renderBox = (targetBox: BoxSelection, dashed: boolean) => {
    const left = (targetBox.x0 / imageWidth) * 100;
    const top = (targetBox.y0 / imageHeight) * 100;
    const width = ((targetBox.x1 - targetBox.x0) / imageWidth) * 100;
    const height = ((targetBox.y1 - targetBox.y0) / imageHeight) * 100;
    return (
      <div
        className={`absolute rounded-[18px] border ${dashed ? 'border-dashed border-[var(--accent-cool)] bg-[rgba(46,125,115,0.08)]' : 'border-solid border-[var(--accent)] bg-[rgba(228,87,46,0.08)]'}`}
        style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
      />
    );
  };

  return (
    <div className="grid gap-6">
      <section className="glass-panel-strong grid gap-6 rounded-[32px] p-6 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="display-face text-3xl font-bold">分割工作台</p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                上传任务：<span className="font-semibold text-[var(--text)]">{uploadId}</span>
                <br />
                过期时间：{new Date(expiresAt).toLocaleString()}
              </p>
            </div>
            <button className="ink-button ink-button-muted" onClick={onReset} type="button">
              返回上传区
            </button>
          </div>

          <div className="glass-panel rounded-[28px] p-4">
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'positive', label: '正点' },
                { key: 'negative', label: '负点' },
                { key: 'box', label: '框选' },
              ].map((item) => (
                <button
                  className={`mode-button ${promptMode === item.key ? 'mode-button-active' : ''}`}
                  key={item.key}
                  onClick={() => setPromptMode(item.key as PromptMode)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
              <button className="mode-button" onClick={() => setPoints([])} type="button">
                清空点
              </button>
              <button className="mode-button" onClick={() => setBox(null)} type="button">
                清空框
              </button>
              <button className="ink-button ink-button-primary ml-auto" onClick={extractCandidates} type="button">
                {loading ? '处理中...' : '生成候选'}
              </button>
            </div>

            <div className="mt-4 text-sm leading-6 text-[var(--muted)]">
              点一下添加正点或负点；切到框选后拖拽限定主体范围。复杂背景优先加几个负点，把不想要的区域明确排掉。
            </div>

            <div className="mt-5 overflow-hidden rounded-[28px] border border-[rgba(24,21,17,0.1)] bg-[rgba(255,253,249,0.94)] p-3">
              <div
                className="relative inline-block max-w-full cursor-crosshair"
                onClick={handlePromptClick}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                ref={imageFrameRef}
              >
                <Image
                  alt="Uploaded source"
                  className="max-h-[560px] max-w-full rounded-[20px] object-contain select-none"
                  draggable={false}
                  height={imageHeight}
                  priority
                  src={apiUrl(imageUrl)}
                  unoptimized
                  width={imageWidth}
                />

                {points.map((point) => (
                  <div
                    className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                    key={point.id}
                    style={{
                      left: `${(point.x / imageWidth) * 100}%`,
                      top: `${(point.y / imageHeight) * 100}%`,
                      backgroundColor: point.label === 1 ? 'var(--success)' : 'var(--accent)',
                    }}
                  />
                ))}

                {box && renderBox(box, false)}
                {draftBox && renderBox(normalizeBox(draftBox), true)}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="glass-panel rounded-[28px] p-5">
            <p className="display-face text-2xl font-bold">质量控制</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-[var(--text)]">
                图像预设
                <select className="control-select mt-2" onChange={(event) => setPreset(event.target.value as PresetKey)} value={preset}>
                  <option value="logo">Logo / 图标</option>
                  <option value="illustration">插画 / 贴纸</option>
                  <option value="photo">照片 / 复杂主体</option>
                </select>
              </label>

              <label className="text-sm font-semibold text-[var(--text)]">
                矢量模式
                <select className="control-select mt-2" onChange={(event) => setVectorMode(event.target.value as VectorMode)} value={vectorMode}>
                  <option value="auto">Auto</option>
                  <option value="color">Color Vector</option>
                  <option value="contour">Contour</option>
                </select>
              </label>

              <label className="text-sm font-semibold text-[var(--text)]">
                细节等级
                <input className="control-slider mt-3" max={3} min={1} onChange={(event) => setDetail(Number(event.target.value))} type="range" value={detail} />
                <p className="mt-2 text-xs font-medium text-[var(--muted)]">1 更干净，3 更保留细节</p>
              </label>

              <label className="text-sm font-semibold text-[var(--text)]">
                平滑等级
                <input className="control-slider mt-3" max={3} min={1} onChange={(event) => setSmoothing(Number(event.target.value))} type="range" value={smoothing} />
                <p className="mt-2 text-xs font-medium text-[var(--muted)]">1 更锐，3 更圆润</p>
              </label>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-[20px] border border-[rgba(24,21,17,0.08)] bg-[rgba(255,252,247,0.9)] px-4 py-3 text-sm font-semibold text-[var(--text)]">
                <input checked={keepHoles} onChange={(event) => setKeepHoles(event.target.checked)} type="checkbox" />
                保留内部孔洞
              </label>
              <label className="flex items-center gap-3 rounded-[20px] border border-[rgba(24,21,17,0.08)] bg-[rgba(255,252,247,0.9)] px-4 py-3 text-sm font-semibold text-[var(--text)]">
                <input checked={largestComponent} onChange={(event) => setLargestComponent(event.target.checked)} type="checkbox" />
                仅保留最大连通域
              </label>
            </div>
          </div>

          <div className="glass-panel rounded-[28px] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="display-face text-2xl font-bold">候选结果</p>
                <p className="mt-2 text-sm text-[var(--muted)]">先看预览，再把合适的 SVG 加进画布。</p>
              </div>
              <span className="ink-pill">{candidates.length} candidates</span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {candidates.map((candidate) => (
                <div className="candidate-card" key={candidate.id}>
                  <div className="relative aspect-[4/3] bg-[rgba(248,242,233,0.9)] p-3">
                    <Image
                      alt={candidate.label}
                      className="rounded-[18px] object-contain"
                      fill
                      sizes="(max-width: 768px) 100vw, 30vw"
                      src={apiUrl(candidate.preview_url)}
                      unoptimized
                    />
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-bold text-[var(--text)]">{candidate.label}</p>
                      <span className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                        {candidate.vector_mode}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--muted)]">SAM score {candidate.score_percent.toFixed(1)}%</p>
                    <button className="ink-button ink-button-primary w-full" onClick={() => addCandidateToCanvas(candidate)} type="button">
                      加入画布
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {candidates.length === 0 ? (
              <div className="mt-5 rounded-[24px] border border-dashed border-[rgba(24,21,17,0.15)] bg-[rgba(255,252,247,0.72)] px-5 py-8 text-sm leading-7 text-[var(--muted)]">
                还没有候选结果。先在左侧放点或框，再点击“生成候选”。
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="glass-panel-strong rounded-[32px] p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="display-face text-3xl font-bold">SVG 拼装画布</p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              `Alt + 滚轮` 缩放，`Alt + 拖动` 平移，`Delete / Backspace` 删除选中对象。
            </p>
          </div>
          <button className="ink-button ink-button-primary" onClick={exportCanvas} type="button">
            导出 SVG
          </button>
        </div>

        <div className="h-[640px] overflow-hidden rounded-[30px] border border-[rgba(24,21,17,0.12)] bg-[rgba(255,251,246,0.9)]">
          <canvas className="h-full w-full" ref={canvasEl} />
        </div>
      </section>
    </div>
  );
}
