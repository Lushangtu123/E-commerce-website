'use client';

import { useI18n } from '@/lib/i18n';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const { password, confirmPassword } = formData;
    const username = formData.username.trim();
    const email = formData.email.trim();

    if (!username || !email || !password || !confirmPassword) {
      toast.error(t("请填写完整信息"));
      return;
    }

    if (password !== confirmPassword) {
      toast.error(t("两次密码不一致"));
      return;
    }

    if (password.length < 6) {
      toast.error(t("密码长度不能少于6位"));
      return;
    }

    if (new TextEncoder().encode(password).length > 72) {
      toast.error(t('密码不能超过72个UTF-8字节'));
      return;
    }

    setLoading(true);
    try {
      const data: any = await userApi.register({ username, email, password });
      login(data.user, data.token);
      toast.success(t("注册成功"));
      router.push('/');
    } catch (error: any) {
      logger.error('注册失败:', error);
      toast.error(t(error.response?.data?.error || "注册失败"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900">{t("注册账号")}</h2>
          <p className="mt-2 text-gray-600">{t("创建您的账号，开始购物之旅")}</p>
        </div>

        <div className="card p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("用户名")}</label>
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                className="input"
                placeholder={t("请输入用户名")}
                maxLength={50}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("邮箱")}</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="input"
                placeholder={t("请输入邮箱")}
                maxLength={100}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("密码")}</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                className="input"
                placeholder={t("请输入密码（至少6位）")}
                minLength={6}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t("确认密码")}</label>
              <input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                className="input"
                placeholder={t("请再次输入密码")}
                minLength={6}
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
