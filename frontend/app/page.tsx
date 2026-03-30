'use client';

import { message } from 'antd';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import SvgEditor from './SvgEditor';
import { apiUrl } from './lib/api';

type WorkspaceImage = {
  uploadId: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  expiresAt: string;
};

type CurrentUser = {
  email: string;
} | null;

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [workspaceImage, setWorkspaceImage] = useState<WorkspaceImage | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser>(null);

  useEffect(() => {
    const token = window.localStorage.getItem('smart_svg_token');
    if (!token) {
      return;
    }

    fetch(apiUrl('/me'), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('expired');
        }
        const user = await response.json();
        setCurrentUser(user);
      })
      .catch(() => {
        window.localStorage.removeItem('smart_svg_token');
        setCurrentUser(null);
      });
  }, []);

  const featurePills = useMemo(
    () => ['Task-isolated uploads', 'Positive / negative prompts', 'Box-guided masks', 'Contour + color vector modes'],
    [],
  );

  const uploadFile = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      message.error('仅支持 PNG / JPG / WEBP 图片。');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = window.localStorage.getItem('smart_svg_token');
      const response = await fetch(apiUrl('/upload/'), {
        method: 'POST',
        body: formData,
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : undefined,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || '上传失败。');
      }

      setWorkspaceImage({
        uploadId: payload.upload_id,
        imageUrl: payload.image_url,
        imageWidth: payload.image_width,
        imageHeight: payload.image_height,
        expiresAt: payload.expires_at,
      });
      message.success('图片已进入工作台，可以开始精修分割。');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '上传失败。';
      message.error(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const openPicker = () => {
    inputRef.current?.click();
  };

  return (
    <div className="app-shell">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="display-face rounded-full border border-[rgba(24,21,17,0.14)] bg-[rgba(255,250,241,0.8)] px-3 py-2 text-xs font-extrabold uppercase tracking-[0.22em] text-[var(--accent)]">
            Smart SVG
          </div>
          <div>
            <p className="display-face text-lg font-bold text-[var(--text)]">Precision Cutout Workspace</p>
            <p className="text-sm text-[var(--muted)]">先试用，再登录；上传任务彼此隔离。</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {currentUser ? (
            <>
              <div className="hidden rounded-full border border-[rgba(24,21,17,0.1)] bg-[rgba(255,250,244,0.72)] px-4 py-2 text-sm font-semibold text-[var(--muted)] sm:block">
                {currentUser.email}
              </div>
              <button
                className="ink-button ink-button-muted"
                onClick={() => {
                  window.localStorage.removeItem('smart_svg_token');
                  setCurrentUser(null);
                  message.success('已退出登录。');
                }}
                type="button"
              >
                退出
              </button>
            </>
          ) : (
            <>
              <Link className="ink-button ink-button-muted" href="/login">
                登录
              </Link>
              <Link className="ink-button ink-button-primary" href="/register">
                注册
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 pb-12 sm:px-8">
        {!workspaceImage ? (
          <section className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="glass-panel-strong overflow-hidden rounded-[32px] p-8 sm:p-10">
              <div className="mb-8 flex flex-wrap gap-2">
                {featurePills.map((pill) => (
                  <span className="ink-pill" key={pill}>
                    {pill}
                  </span>
                ))}
              </div>

              <p className="mb-4 display-face text-5xl font-extrabold leading-[0.95] tracking-[-0.04em] text-[var(--text)] sm:text-7xl">
                切得更准，
                <br />
                画得更净。
              </p>
              <p className="max-w-2xl text-lg leading-8 text-[var(--muted)]">
                新版工作流把图片拆成任务级隔离，支持正负点击、框选约束、候选结果筛选，以及轮廓模式 / 彩色矢量模式双路线。
              </p>

              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                <div className="rounded-[26px] border border-[rgba(24,21,17,0.1)] bg-[rgba(255,252,247,0.9)] p-5">
                  <p className="display-face text-xl font-bold">1</p>
                  <p className="mt-3 text-sm font-semibold text-[var(--text)]">上传后生成 `upload_id`</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">同一服务内不会再串图，多次点击和多人使用都按任务隔离。</p>
                </div>
                <div className="rounded-[26px] border border-[rgba(24,21,17,0.1)] bg-[rgba(255,252,247,0.9)] p-5">
                  <p className="display-face text-xl font-bold">2</p>
                  <p className="mt-3 text-sm font-semibold text-[var(--text)]">候选 mask + 后处理</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">保守、完整、平衡三个候选结果，统一走去噪、补洞、平滑处理。</p>
                </div>
                <div className="rounded-[26px] border border-[rgba(24,21,17,0.1)] bg-[rgba(255,252,247,0.9)] p-5">
                  <p className="display-face text-xl font-bold">3</p>
                  <p className="mt-3 text-sm font-semibold text-[var(--text)]">SVG 双路线</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Logo 用 contour 更干净，插画和复杂主体走 color vector 保留色块。</p>
                </div>
              </div>
            </div>

            <div className="glass-panel rounded-[32px] p-6 sm:p-8">
              <div
                className={`relative rounded-[30px] border border-dashed p-8 text-center transition-colors ${
                  isDragging ? 'border-[rgba(228,87,46,0.55)] bg-[rgba(228,87,46,0.08)]' : 'border-[rgba(24,21,17,0.18)] bg-[rgba(255,252,247,0.78)]'
                }`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  const file = event.dataTransfer.files[0];
                  if (file) {
                    void uploadFile(file);
                  }
                }}
              >
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(228,87,46,0.12)] text-3xl text-[var(--accent)]">
                  ✦
                </div>
                <p className="display-face text-3xl font-bold text-[var(--text)]">立即试用</p>
                <p className="mx-auto mt-4 max-w-sm text-sm leading-7 text-[var(--muted)]">
                  支持拖拽上传，也可以点按钮选择文件。首次体验不要求登录，登录只用于保留账号入口。
                </p>

                <button
                  className="ink-button ink-button-primary mt-8 w-full"
                  disabled={isUploading}
                  onClick={openPicker}
                  type="button"
                >
                  {isUploading ? '上传中...' : '选择图片并进入工作台'}
                </button>
                <input
                  accept=".png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void uploadFile(file);
                    }
                    event.currentTarget.value = '';
                  }}
                  ref={inputRef}
                  type="file"
                />

                <div className="mt-8 rounded-[24px] border border-[rgba(24,21,17,0.08)] bg-[rgba(255,247,239,0.9)] p-5 text-left">
                  <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--accent-cool)]">推荐输入</p>
                  <ul className="mt-4 space-y-3 text-sm leading-6 text-[var(--muted)]">
                    <li>Logo / 图标：优先走 contour mode，边更硬、更省节点。</li>
                    <li>插画 / 贴纸：建议 illustration 预设，兼顾闭合与色块保留。</li>
                    <li>照片主体：用 photo 预设，再补负点击去掉背景粘连。</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <SvgEditor
            expiresAt={workspaceImage.expiresAt}
            imageHeight={workspaceImage.imageHeight}
            imageUrl={workspaceImage.imageUrl}
            imageWidth={workspaceImage.imageWidth}
            onReset={() => setWorkspaceImage(null)}
            uploadId={workspaceImage.uploadId}
          />
        )}
      </main>
    </div>
  );
}
