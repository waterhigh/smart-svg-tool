// frontend/src/app/SvgEditor.tsx
'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { fabric } from 'fabric';
import { Button, Card, message, Spin, Tooltip, Space } from 'antd';
import { 
  SaveOutlined,
  DeleteOutlined, 
  QuestionCircleOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation'; // 👈 新增引入

interface SvgEditorProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
}

export default function SvgEditor({ imageUrl, imageWidth, imageHeight }: SvgEditorProps) {
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  
  const [loading, setLoading] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const router = useRouter(); // 👈 初始化路由

  // 画布交互状态 refs
  const isDragging = useRef(false);
  const lastPosX = useRef(0);
  const lastPosY = useRef(0);

  // --- 删除选中对象的功能 ---
  const handleDeleteSelected = useCallback(() => {
    if (!canvas) return;
    const activeObjects = canvas.getActiveObjects();
    
    if (activeObjects.length === 0) {
        message.warning('请先选择要删除的元素');
        return;
    }

    canvas.discardActiveObject(); // 取消选择状态
    activeObjects.forEach((obj) => {
        canvas.remove(obj);
    });
    canvas.requestRenderAll(); 
    message.success('已删除选中元素');
  }, [canvas]);

  // -------------------------------------------------------------
  // 🔥 核心修复：Effect 1 - 仅负责初始化画布 (只运行一次)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!canvasEl.current) return;

    // 1. 初始化画布
    const fabricCanvas = new fabric.Canvas(canvasEl.current, {
      width: canvasEl.current.parentElement?.clientWidth || 800,
      height: canvasEl.current.parentElement?.clientHeight || 600,
      backgroundColor: '#f0f2f5',
      preserveObjectStacking: true,
    });

    // 2. 绑定 Fabric 内部事件 (滚轮、拖拽)
    fabricCanvas.on('mouse:wheel', (opt) => {
      const evt = opt.e;
      if (evt.altKey === true) {
        let delta = evt.deltaY;
        let zoom = fabricCanvas.getZoom();
        zoom *= 0.999 ** delta;
        if (zoom > 20) zoom = 20;
        if (zoom < 0.1) zoom = 0.1;
        fabricCanvas.zoomToPoint({ x: evt.offsetX, y: evt.offsetY }, zoom);
        evt.preventDefault();
        evt.stopPropagation();
      }
    });

    fabricCanvas.on('mouse:down', (opt) => {
      const evt = opt.e;
      if (evt.altKey === true) {
        isDragging.current = true;
        fabricCanvas.selection = false;
        lastPosX.current = evt.clientX;
        lastPosY.current = evt.clientY;
      }
    });
    fabricCanvas.on('mouse:move', (opt) => {
      if (isDragging.current) {
        const e = opt.e;
        const vpt = fabricCanvas.viewportTransform;
        if (vpt) {
            vpt[4] += e.clientX - lastPosX.current;
            vpt[5] += e.clientY - lastPosY.current;
            fabricCanvas.requestRenderAll();
            lastPosX.current = e.clientX;
            lastPosY.current = e.clientY;
        }
      }
    });
    fabricCanvas.on('mouse:up', () => {
      if (isDragging.current) {
        fabricCanvas.setViewportTransform(fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0]);
        isDragging.current = false;
        fabricCanvas.selection = true;
      }
    });

    // 3. 将实例保存到 state
    setCanvas(fabricCanvas);

    // 4. 响应式调整大小
    const resizeObserver = new ResizeObserver(() => {
        if(canvasEl.current && canvasEl.current.parentElement) {
            fabricCanvas.setWidth(canvasEl.current.parentElement.clientWidth);
            fabricCanvas.setHeight(canvasEl.current.parentElement.clientHeight);
            fabricCanvas.renderAll();
        }
    });
    if(canvasEl.current.parentElement) {
        resizeObserver.observe(canvasEl.current.parentElement);
    }

    return () => {
      fabricCanvas.dispose();
      resizeObserver.disconnect();
    };
  }, []);

  // -------------------------------------------------------------
  // 🔥 核心修复：Effect 2 - 负责绑定键盘事件 (依赖 canvas 更新)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!canvas) return;

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            handleDeleteSelected();
        }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [canvas, handleDeleteSelected]);


  // 处理左侧点击：调用 SAM
  const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (loading || !imgRef.current) return;

    // 🔥 1. 检查登录状态
    const token = localStorage.getItem('smart_svg_token');
    if (!token) {
        message.error('请先登录！');
        router.push('/login');
        return;
    }
    
    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = imageWidth / rect.width;
    const scaleY = imageHeight / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setLoading(true);
    message.loading({ content: 'AI 正在识别并抠图...', key: 'sam_process', duration: 0 });

    try {
        const formData = new FormData();
        formData.append('x', x.toString());
        formData.append('y', y.toString());

        // 🔥 2. 发送带 Token 的请求
        const res = await fetch('/segment/', {
            method: 'POST',
            body: formData,
            headers: {
                'Authorization': `Bearer ${token}` // 👈 关键：添加认证头
            }
        });
        
        // 🔥 3. 处理 Token 过期的情况
        if (res.status === 401) {
             message.error({ content: '登录已过期，请重新登录', key: 'sam_process' });
             router.push('/login');
             return;
        }

        if (!res.ok) {
             const err = await res.json();
             throw new Error(err.detail || '识别失败');
        }

        const data = await res.json();
        if (data.svg_url) {
            fabric.loadSVGFromURL(data.svg_url, (objects, options) => {
                const svgGroup = fabric.util.groupSVGElements(objects, options);
                svgGroup.set({
                    left: data.offset_x,
                    top: data.offset_y,
                    perPixelTargetFind: true,
                });
                
                if (canvas) {
                    canvas.add(svgGroup);
                    canvas.setActiveObject(svgGroup);
                    canvas.renderAll();
                    message.success({ content: '模块已提取！', key: 'sam_process' });
                }
            });
        }
    } catch (error: any) {
        console.error(error);
        message.error({ content: error.message || '识别失败', key: 'sam_process' });
    } finally {
        setLoading(false);
    }
  };

  // 导出 SVG (保持不变)
  const handleDownload = () => {
    if (!canvas) return;

    const activeObj = canvas.getActiveObject();
    const triggerDownload = (svgString: string, prefix: string) => {
        const blob = new Blob([svgString], {type: "image/svg+xml"});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${prefix}_smart_disassembled.svg`;
        link.click();
        URL.revokeObjectURL(url);
    };

    if (activeObj) {
        message.loading({ content: '正在导出选中模块...', key: 'export' });
        activeObj.clone((cloned: fabric.Object) => {
            const padding = 10;
            const width = cloned.getScaledWidth() + padding * 2;
            const height = cloned.getScaledHeight() + padding * 2;

            const tempCanvas = new fabric.StaticCanvas(null, {
                width: width,
                height: height,
                backgroundColor: 'transparent'
            });

            cloned.set({
                left: padding,
                top: padding,
                originX: 'left',
                originY: 'top'
            });

            if (activeObj.type === 'activeSelection') {
                tempCanvas.add(cloned);
                tempCanvas.centerObject(cloned);
            } else {
                tempCanvas.add(cloned);
            }
            
            const svgData = tempCanvas.toSVG();
            triggerDownload(svgData, 'selected');
            tempCanvas.dispose();
            message.success({ content: '选中模块已导出 (透明背景)', key: 'export' });
        });

    } else {
        message.loading({ content: '正在导出全图...', key: 'export' });
        const originalBg = canvas.backgroundColor;
        const originalVpt = canvas.viewportTransform;
        
        canvas.setBackgroundColor(null as any, () => {});
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        const currentW = canvas.getWidth();
        const currentH = canvas.getHeight();
        canvas.setWidth(imageWidth);
        canvas.setHeight(imageHeight);

        const svgData = canvas.toSVG();

        canvas.setWidth(currentW);
        canvas.setHeight(currentH);
        if (originalVpt) canvas.setViewportTransform(originalVpt);
        canvas.setBackgroundColor(originalBg as string, canvas.renderAll.bind(canvas));

        triggerDownload(svgData, 'full');
        message.success({ content: '全图已导出 (透明背景)', key: 'export' });
    }
  };

  const cardExtra = (
    <Space>
      <Tooltip title="快捷键：Delete 或 Backspace">
        <Button danger icon={<DeleteOutlined />} onClick={handleDeleteSelected}>删除选中</Button>
      </Tooltip>
      <Button type="primary" icon={<SaveOutlined />} onClick={handleDownload}>导出 SVG</Button>
    </Space>
  );

  return (
    <div className="flex h-[75vh] gap-4 items-stretch">
      <Card 
        title={
            <Space>
                <span>1. 点击提取 (已自动抹除文本)</span>
                <Tooltip title="后端已使用 OCR 技术识别并自动修复了图片中的文本区域，点击提取时不再受文字干扰。">
                    <QuestionCircleOutlined className="text-gray-400 cursor-help"/>
                </Tooltip>
            </Space>
        }
        className="w-1/2 shadow-md flex flex-col" 
        styles={{ body: { flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafafa' } }}
      >
         <div className="relative w-full h-full flex items-center justify-center cursor-crosshair overflow-auto">
            {loading && (
              <div className="absolute inset-0 bg-white/60 z-10 flex flex-col gap-2 items-center justify-center pointer-events-none">
                  <Spin size="large" />
                  <span className="text-blue-600 font-medium">AI 思考中...</span>
              </div>
            )}
            <img 
                ref={imgRef}
                src={imageUrl} 
                alt="Source" 
                className="max-w-full max-h-full object-contain select-none shadow-sm"
                onClick={handleImageClick}
                draggable={false}
            />
         </div>
      </Card>

      <Card 
        title="2. 矢量组装画布 (Alt+缩放/平移)" 
        className="w-1/2 shadow-md flex flex-col"
        styles={{ body: { padding: 0, flex: 1, position: 'relative', display: 'flex' } }}
        extra={cardExtra}
      >
        <div className="flex-1 w-full h-full bg-gray-100 relative overflow-hidden">
            <canvas ref={canvasEl} className="absolute top-0 left-0"/>
        </div>
      </Card>
    </div>
  );
}