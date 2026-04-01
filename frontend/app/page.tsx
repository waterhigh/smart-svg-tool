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
  plan: string;
  plan_label: string;
  has_basic_access: boolean;
  has_advanced_access: boolean;
  is_lifetime_plan: boolean;
  plan_note?: string | null;
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
    () => ['Founder lifetime basic', 'Email-bound access', 'Task-isolated uploads', 'Contour + color vector modes'],
    [],
  );

  const hasFounderAccess = Boolean(currentUser?.has_basic_access);

  const uploadFile = async (file: File) => {
    if (!currentUser) {
      message.error('请先注册并登录购买时绑定的邮箱。');
      return;
    }

    if (!currentUser.has_basic_access) {
      message.error('当前账号还没有开通创始人永久基础版。');
      return;
    }

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
      message.success('图片已进入工作台，可以开始生成候选结果。');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '上传失败。';
      message.error(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const openPicker = () => {
    if (!currentUser) {
      message.info('先登录购买时绑定的邮箱，再进入工作台。');
      return;
    }

    if (!currentUser.has_basic_access) {
      message.info('当前邮箱已绑定账号，但还没有开通创始人永久基础版。');
      return;
    }

    inputRef.current?.click();
  };

  const renderAccessPanel = () => {
    if (!currentUser) {
      return (
        <div className="rounded-[30px] border border-dashed border-[rgba(24,21,17,0.18)] bg-[rgba(255,252,247,0.78)] p-8 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(228,87,46,0.12)] text-3xl text-[var(--accent)]">
            ID
          </div>
          <p className="display-face text-3xl font-bold text-[var(--text)]">先注册，再绑定权益</p>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-7 text-[var(--muted)]">
            24.9 元创始人永久基础版通过邮箱绑定。请先注册账号，支付后使用同一个邮箱登录，管理员会为该邮箱开通长期基础权益。
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Link className="ink-button ink-button-primary w-full" href="/register">
              注册购买邮箱
            </Link>
            <Link className="ink-button ink-button-muted w-full" href="/login">
              已有账号，去登录
            </Link>
          </div>

          <div className="mt-8 rounded-[24px] border border-[rgba(24,21,17,0.08)] bg-[rgba(255,247,239,0.9)] p-5 text-left">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--accent-cool)]">Founder Basic</p>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-[var(--muted)]">
              <li>绑定注册邮箱，创始人永久基础版长期有效。</li>
              <li>后续基础功能更新继续可用，不再重复收费。</li>
              <li>未来新出的高级功能会单独分层，不包含在基础版里。</li>
            </ul>
          </div>
        </div>
      );
    }

    if (!currentUser.has_basic_access) {
      return (
        <div className="rounded-[30px] border border-[rgba(24,21,17,0.14)] bg-[rgba(255,252,247,0.86)] p-8 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(46,125,115,0.12)] text-3xl text-[var(--accent-cool)]">
            EQ
          </div>
          <p className="display-face text-3xl font-bold text-[var(--text)]">邮箱已绑定，等待开通</p>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-7 text-[var(--muted)]">
            当前账号已经登录成功，但还没有开通创始人永久基础版。你可以用下面这个邮箱作为支付和授权绑定邮箱。
          </p>

          <div className="mt-8 rounded-[24px] border border-[rgba(24,21,17,0.08)] bg-[rgba(255,247,239,0.9)] p-5 text-left">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent-cool)]">Current Account</p>
            <p className="mt-3 text-lg font-semibold text-[var(--text)]">{currentUser.email}</p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">当前计划：{currentUser.plan_label}</p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              开通后，这个邮箱会获得创始人永久基础版，未来基础更新持续可用；高级功能会保留给更高等级计划。
            </p>
          </div>

          <button
            className="ink-button ink-button-primary mt-8 w-full"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(currentUser.email);
                message.success('邮箱已复制，可以直接用于支付或人工开通。');
              } catch {
                message.info(`当前绑定邮箱：${currentUser.email}`);
              }
            }}
            type="button"
          >
            复制当前绑定邮箱
          </button>
        </div>
      );
    }

    return (
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
          SVG
        </div>
        <p className="display-face text-3xl font-bold text-[var(--text)]">创始人工作台已开通</p>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-7 text-[var(--muted)]">
          当前邮箱已经拥有创始人永久基础版，可以继续使用上传、分割、矢量导出等基础能力，后续基础更新也会继续可用。
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
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--accent-cool)]">当前权益</p>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-[var(--muted)]">
            <li>绑定邮箱：{currentUser.email}</li>
            <li>当前计划：{currentUser.plan_label}</li>
            <li>基础更新继续可用，未来高级功能会单独开放。</li>
          </ul>
        </div>
      </div>
    );
  };

  return (
    <div className="app-shell">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="display-face rounded-full border border-[rgba(24,21,17,0.14)] bg-[rgba(255,250,241,0.8)] px-3 py-2 text-xs font-extrabold uppercase tracking-[0.22em] text-[var(--accent)]">
            Smart SVG
          </div>
          <div>
            <p className="display-face text-lg font-bold text-[var(--text)]">Founder Lifetime Basic</p>
            <p className="text-sm text-[var(--muted)]">24.9 元绑定注册邮箱，基础功能长期可用，后续高级功能单独分层。</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {currentUser ? (
            <>
              <div className="hidden rounded-full border border-[rgba(24,21,17,0.1)] bg-[rgba(255,250,244,0.72)] px-4 py-2 text-sm font-semibold text-[var(--muted)] sm:block">
                {currentUser.email}
              </div>
              <div
                className={`hidden rounded-full px-4 py-2 text-sm font-semibold sm:block ${
                  hasFounderAccess
                    ? 'border border-[rgba(46,125,115,0.18)] bg-[rgba(46,125,115,0.12)] text-[var(--accent-cool)]'
                    : 'border border-[rgba(228,87,46,0.18)] bg-[rgba(228,87,46,0.1)] text-[var(--accent)]'
                }`}
              >
                {currentUser.plan_label}
              </div>
              <button
                className="ink-button ink-button-muted"
                onClick={() => {
                  window.localStorage.removeItem('smart_svg_token');
                  setCurrentUser(null);
                  setWorkspaceImage(null);
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
        {!workspaceImage || !hasFounderAccess ? (
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
                把主体抠得更准，
                <br />
                把输出变成可编辑 SVG。
              </p>
              <p className="max-w-2xl text-lg leading-8 text-[var(--muted)]">
                这一版先聚焦创始人永久基础版。账号通过邮箱绑定，开通后即可长期使用当前核心工作流，后续基础更新继续享受；未来更重的高级功能将作为新层级单独提供。
              </p>

              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                <div className="rounded-[26px] border border-[rgba(24,21,17,0.1)] bg-[rgba(255,252,247,0.9)] p-5">
                  <p className="display-face text-xl font-bold">1</p>
                  <p className="mt-3 text-sm font-semibold text-[var(--text)]">邮箱绑定</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">通过注册邮箱绑定创始人永久基础版，后续登录同一个账号即可继续使用。</p>
                </div>
                <div className="rounded-[26px] border border-[rgba(24,21,17,0.1)] bg-[rgba(255,252,247,0.9)] p-5">
                  <p className="display-face text-xl font-bold">2</p>
                  <p className="mt-3 text-sm font-semibold text-[var(--text)]">基础能力长期可用</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">上传、分割、候选结果筛选和基础 SVG 输出会继续更新，不再重复收费。</p>
                </div>
                <div className="rounded-[26px] border border-[rgba(24,21,17,0.1)] bg-[rgba(255,252,247,0.9)] p-5">
                  <p className="display-face text-xl font-bold">3</p>
                  <p className="mt-3 text-sm font-semibold text-[var(--text)]">高级功能后续分层</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">未来批量处理、团队协作、更多高阶模式等功能可以独立做更高等级计划。</p>
                </div>
              </div>
            </div>

            <div className="glass-panel rounded-[32px] p-6 sm:p-8">{renderAccessPanel()}</div>
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
