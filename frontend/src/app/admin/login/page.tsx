'use client';

import '@/lib/admin-i18n';
import { translate, useI18n } from '@/lib/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { getAdminSessionId, startAdminSession } from '@/lib/admin-session';
import { adminApi } from '@/lib/api';
import { adminAuthAttempt, AdminAuthAbandoned, AdminAuthUnconfirmed, type AdminAuthAttempt } from '@/lib/admin-auth-flow';
import { requestFailure } from '@/lib/api-error';
import AdminTwoFactorStep, { type AdminTwoFactorView } from '@/components/AdminTwoFactorStep';

export default function AdminLoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  // After the password: the second factor, or binding an authenticator first. Recovery codes are shown once.
  const [step, setStep] = useState<{ kind: 'password' } | AdminTwoFactorView>({ kind: 'password' });
  const mounted = useRef(true), mutation = useRef<object | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; mutation.current = null; };
  }, []);

  /** Runs one step at a time; a step started before a newer one never reports. */
  const run = async (work: (alive: () => boolean) => Promise<void>) => {
    if (!mounted.current || mutation.current) return;
    const operation = {}; mutation.current = operation;
    const alive = () => mounted.current && mutation.current === operation;
    setLoading(true);
    try { await work(alive); }
    finally { if (alive()) { mutation.current = null; setLoading(false); } }
  };

  const fail = (error: unknown, fallback: string) => {
    const failure = requestFailure(error).response;
    // An expired or superseded challenge means starting again from the password.
    if (failure?.status === 401 && failure.data?.error === '验证已过期，请重新输入密码') setStep({ kind: 'password' });
    logger.error('管理员登录请求失败');
    toast.error(translate(failure?.data?.error || fallback));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async alive => {
      try {
        const answer = await adminApi.login(formData);
        if (!alive()) return;
        setFormData(previous => ({ ...previous, password: '' }));
        if (answer.two_factor === 'verify') { setStep({ kind: 'verify', challenge: answer.challenge }); return; }
        const setup = await adminApi.twoFactorSetup(answer.challenge);
        if (alive()) setStep({ kind: 'setup', challenge: answer.challenge, setup });
      } catch (error) {
        if (alive()) fail(error, '登录失败');
      }
    });
  };

  /** The step that issues the session goes through the shared sign-in lock and publication. */
  const completeTwoFactor = (code: string) => {
    if (step.kind !== 'verify' && step.kind !== 'setup') return;
    const current = step;
    void run(async alive => {
      let attempt: AdminAuthAttempt | undefined;
      let publishedSessionId: string | null = null;
      try {
        attempt = adminAuthAttempt(alive, data => { publishedSessionId = startAdminSession(data.admin); });
        const result = await adminApi.completeTwoFactor(current.kind === 'verify' ? 'verify' : 'activate',
          { challenge: current.challenge, code }, attempt);
        if (!alive() || !publishedSessionId || getAdminSessionId() !== publishedSessionId) return;
        if (result.recovery_codes?.length) { setStep({ kind: 'recovery', codes: result.recovery_codes }); return; }
        if (typeof result.recovery_codes_remaining === 'number' && result.recovery_codes_remaining <= 3) {
          toast.error(translate('恢复码只剩 {count} 个，请尽快重置两步验证以生成新的恢复码', { count: result.recovery_codes_remaining }));
        }
        toast.success(translate('登录成功'));
        router.push('/admin/dashboard');
      } catch (error) {
        if (!alive() || error instanceof AdminAuthAbandoned) return;
        if (error instanceof AdminAuthUnconfirmed) {
          if (error.report) toast.error(translate(error.message));
          return;
        }
        if (!attempt?.current()) return;
        fail(error, '验证失败');
      }
    });
  };

  const finishRecovery = () => {
    toast.success(translate('登录成功'));
    router.push('/admin/dashboard');
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="flex justify-end mb-4"><LanguageSwitcher /></div>
        {/* Logo和标题 */}
        <div className="text-center mb-8">
          <div className="inline-block p-4 bg-white rounded-full shadow-lg mb-4">
            <svg className="w-12 h-12 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">{t("管理员登录")}</h1>
          <p className="text-gray-300">{t("电商平台后台管理系统")}</p>
        </div>

        {/* 登录表单 */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {step.kind !== 'password' ? (
            <AdminTwoFactorStep key={step.kind} step={step} loading={loading} onSubmitCode={completeTwoFactor} onFinish={finishRecovery}
              onRestart={() => { if (!mutation.current) setStep({ kind: 'password' }); }} />
          ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 用户名 */}
            <div>
              <label htmlFor="admin-username" className="block text-sm font-medium text-gray-700 mb-2">
                {t("用户名")}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <input
                  id="admin-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder={t("请输入用户名")}
                />
              </div>
            </div>

            {/* 密码 */}
            <div>
              <label htmlFor="admin-password" className="block text-sm font-medium text-gray-700 mb-2">
                {t("密码")}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder={t("请输入密码")}
                />
              </div>
            </div>

            {/* 登录按钮 */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-primary-700 focus:outline-hidden focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t("登录中...")}
                </span>
              ) : (
                t("登录")
              )}
            </button>
          </form>
          )}

          {/* 部署账号提示 */}
          {step.kind === 'password' && (
            <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-sm text-gray-700">{t("请使用部署时配置的管理员账号和密码登录。")}</p>
            </div>
          )}

          {/* 返回首页 */}
          <div className="mt-6 text-center">
            <Link
              href="/"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              {t("← 返回商城首页")}
            </Link>
          </div>
        </div>

        {/* 底部信息 */}
        <div className="mt-8 text-center text-gray-400 text-sm">
          <p>{t("© {year} 电商平台. All rights reserved.", { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </div>
  );
}
