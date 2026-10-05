'use client';

import { useI18n } from '@/lib/i18n';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { requestFailure } from '@/lib/api-error';

export default function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login } = useAuthStore();
  const [passwordChanged, setPasswordChanged] = useState(false);
  useEffect(() => { setPasswordChanged(new URLSearchParams(window.location.search).get('passwordChanged') === '1'); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error(t("请填写完整信息"));
      return;
    }

    setLoading(true);
    try {
      const data = await userApi.login({ email, password });
      login(data.user, data.token);
      toast.success(t("登录成功"));
      router.push('/');
    } catch (error) {
      logger.error('登录请求失败');
      toast.error(t(requestFailure(error).response?.data?.error || "登录失败"));
    } finally {
      setLoading(false);
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
          {passwordChanged && <p role="status" className="mb-6 text-green-700">{t('密码已修改，请使用新密码登录')}</p>}
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
