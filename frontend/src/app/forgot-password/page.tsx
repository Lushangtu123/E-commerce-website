'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { userApi } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { requestFailure } from '@/lib/api-error';

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState(''), [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{ success?: string; error?: string } | null>(null);
  const [capabilityError, setCapabilityError] = useState(false);
  const mounted = useRef(true), pending = useRef(false);
  const capabilityRequest = useRef<object | null>(null);
  const loadCapabilities = async () => {
    if (!mounted.current || capabilityRequest.current) return;
    const operation = {}; capabilityRequest.current = operation;
    setAvailable(null); setCapabilityError(false);
    const active = () => mounted.current && capabilityRequest.current === operation;
    try {
      const data = await userApi.passwordCapabilities();
      if (active()) setAvailable(data.passwordResetAvailable === true);
    } catch {
      if (active()) setCapabilityError(true);
    } finally {
      if (capabilityRequest.current === operation) capabilityRequest.current = null;
    }
  };
  useEffect(() => {
    mounted.current = true;
    void loadCapabilities();
    return () => { mounted.current = false; capabilityRequest.current = null; };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mounted.current || pending.current || available !== true) return;
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 100) { setNotice({ error: '请输入有效的邮箱地址' }); return; }
    pending.current = true; setBusy(true); setNotice(null);
    try {
      await userApi.forgotPassword(value);
      if (mounted.current) setNotice({ success: '如果该邮箱已注册，您将收到密码重置邮件；请检查收件箱和垃圾邮件' });
    } catch (error) {
      if (mounted.current) {
        if (requestFailure(error).response?.data?.code === 'PASSWORD_RESET_UNAVAILABLE') { setAvailable(false); setNotice({ error: '密码找回邮件服务暂不可用，请联系商家' }); }
        else setNotice({ error: requestFailure(error).response?.data?.error || '发送重置邮件失败，请稍后重试' });
      }
    } finally { if (mounted.current) { pending.current = false; setBusy(false); } }
  };
  return <div className="container-custom max-w-md py-12"><div className="card p-8">
    <h1 className="text-2xl font-bold mb-3">{t('找回密码')}</h1>
    <p className="text-sm text-gray-600 mb-6">{t('输入注册邮箱，我们会发送一次性密码重置链接')}</p>
    {capabilityError ? <div role="alert" className="mb-4 text-red-600">
      <p>{t('加载邮件服务状态失败，请重试')}</p>
      <button type="button" onClick={loadCapabilities} className="btn btn-secondary mt-3">{t('重新加载')}</button>
    </div> : available === null ? <p role="status" className="mb-4">{t('正在确认邮件服务...')}</p> : available === false && <p role="alert" className="text-amber-800 mb-4">{t('密码找回邮件服务暂不可用，请联系商家')}</p>}
    <form className="space-y-4" onSubmit={submit}>
      <label className="block"><span className="block mb-2">{t('邮箱')}</span><input className="input" type="email" autoComplete="email" maxLength={100} required value={email} disabled={busy} onChange={event => { if (!pending.current) setEmail(event.target.value); }} /></label>
      <button className="btn btn-primary w-full" disabled={busy || available !== true}>{t(busy ? '发送中...' : '发送重置邮件')}</button>
    </form>
    {notice?.success && <p role="status" className="mt-4 text-green-700">{t(notice.success)}</p>}
    {notice?.error && <p role="alert" className="mt-4 text-red-600">{t(notice.error)}</p>}
    <Link href="/login" className="block mt-6 text-primary-600 underline">{t('返回登录')}</Link>
  </div></div>;
}
