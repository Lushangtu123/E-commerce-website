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
import { passwordError } from '@/lib/password-validation';
import { customerAuthAttempt, CustomerAuthAbandoned, CustomerAuthUnconfirmed } from '@/lib/customer-auth-flow';

export default function RegisterPage() {
  const { t } = useI18n();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { login } = useAuthStore();
  const mounted = useRef(true), mutation = useRef<object | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; mutation.current = null; };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mounted.current || mutation.current) return;

    const { password, confirmPassword } = formData;
    const username = formData.username.trim();
    const email = formData.email.trim();

    if (!username || !email || !password || !confirmPassword) {
      toast.error(translate("请填写完整信息"));
      return;
    }

    if (password !== confirmPassword) {
      toast.error(translate("两次密码不一致"));
      return;
    }

    const invalidPassword = passwordError(password);
    if (invalidPassword) {
      toast.error(translate(invalidPassword));
      return;
    }

    const operation = {}; mutation.current = operation;
    const alive = () => mounted.current && mutation.current === operation;
    const attempt = customerAuthAttempt(alive, data => {
      login(data.user);
      toast.success(translate("注册成功"));
      router.push('/');
    });
    if (!attempt.current()) { mutation.current = null; return; }
    setLoading(true);
    try {
      await userApi.register({ username, email, password }, attempt);
    } catch (error) {
      if (!alive() || error instanceof CustomerAuthAbandoned) return;
      if (error instanceof CustomerAuthUnconfirmed) {
        if (error.report) toast.error(translate('注册结果尚未确认，请先尝试登录或找回密码'));
        return;
      }
      if (!attempt.current()) return;
      logger.error('注册请求失败');
      toast.error(translate(requestFailure(error).response?.data?.error || "注册失败"));
    } finally {
      if (alive()) { mutation.current = null; setLoading(false); }
    }
  };

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t("注册账号")}</h1>
          <p className="mt-2 text-gray-600">{t("创建您的账号，开始购物之旅")}</p>
        </div>

        <div className="card p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="register-username" className="block text-sm font-medium text-gray-700 mb-2">
                {t("用户名")}</label>
              <input
                id="register-username"
                type="text"
                name="username"
                autoComplete="username"
                value={formData.username}
                onChange={handleChange}
                className="input"
                placeholder={t("请输入用户名")}
                maxLength={50}
                required
              />
            </div>

            <div>
              <label htmlFor="register-email" className="block text-sm font-medium text-gray-700 mb-2">
                {t("邮箱")}</label>
              <input
                id="register-email"
                type="email"
                name="email"
                autoComplete="email"
                value={formData.email}
                onChange={handleChange}
                className="input"
                placeholder={t("请输入邮箱")}
                maxLength={100}
                required
              />
            </div>

            <div>
              <label htmlFor="register-password" className="block text-sm font-medium text-gray-700 mb-2">
                {t("密码")}</label>
              <input
                id="register-password"
                type="password"
                name="password"
                autoComplete="new-password"
                value={formData.password}
                onChange={handleChange}
                className="input"
                placeholder={t("请输入密码（至少12位）")}
                minLength={12}
                required
              />
            </div>

            <div>
              <label htmlFor="register-confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                {t("确认密码")}</label>
              <input
                id="register-confirmPassword"
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                value={formData.confirmPassword}
                onChange={handleChange}
                className="input"
                placeholder={t("请再次输入密码")}
                minLength={12}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn btn-primary"
            >
              {loading ? t("注册中...") : t("注册")}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-600">
              {t("已有账号？")}<Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium ml-1">
                {t("立即登录")}</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
