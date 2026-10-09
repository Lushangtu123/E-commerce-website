'use client';

import { translate, useI18n } from '@/lib/i18n';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { requestFailure } from '@/lib/api-error';
import { customerAuthAttempt, CustomerAuthAbandoned, CustomerAuthUnconfirmed, type CustomerAuthAttempt } from '@/lib/customer-auth-flow';

export default function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login } = useAuthStore();
  const mounted = useRef(true), mutation = useRef<object | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<'changed' | 'unconfirmed' | null>(null);
  useEffect(() => {
    mounted.current = true;
    const query = new URLSearchParams(window.location.search);
    setPasswordNotice(query.get('passwordChangeUnconfirmed') === '1' ? 'unconfirmed' : query.get('passwordChanged') === '1' ? 'changed' : null);
    return () => { mounted.current = false; mutation.current = null; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mounted.current || mutation.current) return;

    if (!email || !password) {
      toast.error(translate("请填写完整信息"));
      return;
    }

    const operation = {}; mutation.current = operation;
    const alive = () => mounted.current && mutation.current === operation;
    let attempt: CustomerAuthAttempt | undefined;
    let publishedSessionId: string | null = null;
    setLoading(true);
    try {
      attempt = customerAuthAttempt(alive, data => { publishedSessionId = login(data.user); });
      await userApi.login({ email, password }, attempt);
      // login confirms storage in the cookie queue; only its still-published state may announce success.
      if (alive() && publishedSessionId && useAuthStore.getState().sessionId === publishedSessionId) {
        toast.success(translate('登录成功'));
        router.push('/');
      }
    } catch (error) {
      if (!alive() || error instanceof CustomerAuthAbandoned) return;
      if (error instanceof CustomerAuthUnconfirmed) {
        if (error.report) toast.error(translate(error.reason === 'cleanup' ? '登录状态清理尚未确认，请恢复浏览器存储后重试'
          : error.reason === 'storage' ? '无法保存登录状态，请恢复浏览器存储后重新登录' : '登录结果尚未确认，请重新登录'));
        return;
      }
      if (!attempt?.current()) return;
      logger.error('登录请求失败');
      toast.error(translate(requestFailure(error).response?.data?.error || "登录失败"));
    } finally {
      if (alive()) { mutation.current = null; setLoading(false); }
    }
  };

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t("登录账号")}</h1>
          <p className="mt-2 text-gray-600">{t("欢迎回来！请登录您的账号")}</p>
        </div>

        <div className="card p-8">
          {passwordNotice === 'changed' && <p role="status" className="mb-6 text-green-700">{t('密码已修改，请使用新密码登录')}</p>}
          {passwordNotice === 'unconfirmed' && <p role="alert" className="mb-6 text-amber-700">{t('修改密码结果尚未确认，请先尝试用新密码登录；若无法登录，请使用密码找回')}</p>}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-2">
                {t("邮箱")}</label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder={t("请输入邮箱")}
                required
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-2">
                {t("密码")}</label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder={t("请输入密码")}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn btn-primary"
            >
              {loading ? t("登录中...") : t("登录")}
            </button>
          </form>
          <Link href="/forgot-password" className="block mt-4 text-primary-600 underline">{t('忘记密码？')}</Link>

          <div className="mt-6 text-center">
            <p className="text-gray-600">
              {t("还没有账号？")}<Link href="/register" className="text-primary-600 hover:text-primary-700 font-medium ml-1">
                {t("立即注册")}</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
