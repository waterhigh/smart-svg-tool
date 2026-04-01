'use client';

import { message } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { apiUrl } from '../lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      message.error('两次输入的密码不一致。');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(apiUrl('/users/'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || '注册失败。');
      }

      message.success('注册成功，请登录。');
      router.push('/login');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '注册失败。';
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="glass-panel-strong grid w-full max-w-5xl overflow-hidden rounded-[36px] lg:grid-cols-[0.86fr_1.14fr]">
        <section className="bg-[linear-gradient(180deg,rgba(46,125,115,0.94),rgba(28,88,81,0.92))] p-8 text-[#ecfffb] sm:p-12">
          <p className="ink-pill border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.1)] text-[#ecfffb]">
            Create Account
          </p>
          <p className="display-face mt-8 text-5xl font-extrabold leading-[0.95] tracking-[-0.04em]">
            先注册邮箱，
            <br />
            再绑定创始人永久基础版。
          </p>
          <p className="mt-6 max-w-md text-sm leading-7 text-[rgba(236,255,251,0.84)]">
            购买权益时请使用你准备长期使用的邮箱。后续创始人永久基础版会直接绑定到这个账号，未来基础更新继续可用。
          </p>
        </section>

        <section className="p-8 sm:p-12">
          <p className="display-face text-3xl font-bold">创建账号</p>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
            建议直接使用你的支付邮箱注册。等管理员为该邮箱开通后，登录就能获得创始人永久基础版权限。
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
                minLength={6}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 6 位"
                required
                type="password"
                value={password}
              />
            </label>

            <label className="block text-sm font-semibold text-[var(--text)]">
              确认密码
              <input
                className="control-input mt-2"
                minLength={6}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再输入一次密码"
                required
                type="password"
                value={confirmPassword}
              />
            </label>

            <button className="ink-button ink-button-primary w-full" disabled={loading} type="submit">
              {loading ? '注册中...' : '立即注册'}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between gap-3 text-sm text-[var(--muted)]">
            <Link className="font-semibold text-[var(--accent)]" href="/">
              返回首页
            </Link>
            <Link className="font-semibold text-[var(--accent-cool)]" href="/login">
              已有账号？去登录
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
