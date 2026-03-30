'use client';

import { message } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { apiUrl } from '../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);

    try {
      const formData = new URLSearchParams();
      formData.append('username', email);
      formData.append('password', password);

      const response = await fetch(apiUrl('/token'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || '登录失败。');
      }

      window.localStorage.setItem('smart_svg_token', payload.access_token);
      message.success('登录成功。');
      router.push('/');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '登录失败。';
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="glass-panel-strong grid w-full max-w-5xl overflow-hidden rounded-[36px] lg:grid-cols-[0.9fr_1.1fr]">
        <section className="bg-[linear-gradient(180deg,rgba(228,87,46,0.94),rgba(175,56,25,0.92))] p-8 text-[#fff6ed] sm:p-12">
          <p className="ink-pill border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.1)] text-[#fff6ed]">
            Account Access
          </p>
          <p className="display-face mt-8 text-5xl font-extrabold leading-[0.95] tracking-[-0.04em]">
            登录后，
            <br />
            保留账号入口。
          </p>
          <p className="mt-6 max-w-md text-sm leading-7 text-[rgba(255,246,237,0.84)]">
            主流程现在支持先试用再登录。账号暂时用于注册和后续扩展，上传与分割不再被登录墙拦住。
          </p>
        </section>

        <section className="p-8 sm:p-12">
          <p className="display-face text-3xl font-bold">登录 Smart SVG Tool</p>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
            输入你注册时使用的邮箱和密码。
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block text-sm font-semibold text-[var(--text)]">
              邮箱
              <input
                className="control-input mt-2"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </label>

            <label className="block text-sm font-semibold text-[var(--text)]">
              密码
              <input
                className="control-input mt-2"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                required
                type="password"
                value={password}
              />
            </label>

            <button className="ink-button ink-button-primary w-full" disabled={loading} type="submit">
              {loading ? '登录中...' : '登录'}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between gap-3 text-sm text-[var(--muted)]">
            <Link className="font-semibold text-[var(--accent)]" href="/">
              返回工作台
            </Link>
            <Link className="font-semibold text-[var(--accent-cool)]" href="/register">
              没有账号？去注册
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
