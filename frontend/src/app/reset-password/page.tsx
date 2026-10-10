'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { userApi } from '@/lib/api';
import { passwordError } from '@/lib/password-validation';
import { useI18n } from '@/lib/i18n';
import { useAuthStore, storedSessionId } from '@/store/useAuthStore';
import { requestFailure } from '@/lib/api-error';

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null), [ready, setReady] = useState(false);
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{ error?: string; success?: string } | null>(null);
  const mounted = useRef(true), pending = useRef(false);
  const captured = useRef(false), finished = useRef(false);
  useEffect(() => {
    mounted.current = true;
    // Strict Mode replays effects after cleanup. Capture once so that replay
    // does not replace the credential with null after its fragment is removed.
    if (!captured.current) {
      captured.current = true;
      const match = /^#token=([a-f0-9]{64})$/.exec(window.location.hash);
      if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      setToken(match?.[1] ?? null); setReady(true);
    }
    return () => { mounted.current = false; };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mounted.current || pending.current || finished.current || !token) return;
    const error = passwordError(password) || (password !== confirmation ? '两次输入的新密码不一致' : null);
    if (error) { setNotice({ error }); return; }
    pending.current = true; setBusy(true); setNotice(null);
    const previousSession = useAuthStore.getState();
    const finish = (confirmed: boolean) => {
      if (!mounted.current) return;
      // This capability is single-use. A late or malformed reply cannot prove it
      // unused, and even an obsolete submit handler must never send it again.
      finished.current = true;
      setToken(null); setPassword(''); setConfirmation('');
      const current = useAuthStore.getState();
      try {
        if (previousSession.sessionId && current.sessionId === previousSession.sessionId && current.user?.user_id === previousSession.user?.user_id && storedSessionId() === previousSession.sessionId) current.logout();
      } catch { /* Storage denial must not change the reset outcome or clear a replacement session. */ }
      setNotice(confirmed ? { success: '密码已重置，所有旧会话已失效，请使用新密码登录' }
        : { error: '重置密码结果尚未确认，请先尝试用新密码登录；若无法登录，请重新申请重置邮件' });
    };
    try {
      const data: unknown = await userApi.resetPassword({ token, newPassword: password });
      finish(!!data && typeof data === 'object' && 'reauthenticate' in data && data.reauthenticate === true);
    } catch (error) {
      if (mounted.current) {
        const failure = requestFailure(error), status = failure.response?.status;
        if (!status || status === 408 || status === 409 || status === 429 || status >= 500) finish(false);
        else {
          if (status === 400 && (failure.response?.data?.code === 'INVALID_RESET_TOKEN' || failure.response?.data?.error === '密码重置链接无效或已过期')) {
            finished.current = true; setToken(null); setPassword(''); setConfirmation('');
          }
          setNotice({ error: failure.response?.data?.error || '重置密码失败，请重新申请重置邮件' });
        }
      }
    } finally { if (mounted.current) { pending.current = false; setBusy(false); } }
  };
  return <div className="container-custom max-w-md py-12"><div className="card p-8">
    <h1 className="text-2xl font-bold mb-3">{t('重置密码')}</h1>
    {!ready ? <p role="status">{t('加载中...')}</p> : notice?.success ? <p role="status" className="text-green-700">{t(notice.success)}</p> : !token ? <p role="alert" className="text-red-600">{t(notice?.error || '重置链接无效或已过期，请重新申请')}</p> : <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-gray-600">{t('新密码至少12个字符，且不超过72字节')}</p>
      <label className="block"><span className="block mb-2">{t('新密码')}</span><input className="input" type="password" autoComplete="new-password" required minLength={12} disabled={busy} value={password} onChange={event => { if (!pending.current) setPassword(event.target.value); }} /></label>
      <label className="block"><span className="block mb-2">{t('确认新密码')}</span><input className="input" type="password" autoComplete="new-password" required disabled={busy} value={confirmation} onChange={event => { if (!pending.current) setConfirmation(event.target.value); }} /></label>
      <button className="btn btn-primary w-full" disabled={busy}>{t(busy ? '处理中...' : '设置新密码')}</button>
    </form>}
    {token && notice?.error && <p role="alert" className="mt-4 text-red-600">{t(notice.error)}</p>}
    <div className="flex justify-between mt-6"><Link href="/login" className="text-primary-600 underline">{t('返回登录')}</Link><Link href="/forgot-password" className="text-primary-600 underline">{t('重新申请重置邮件')}</Link></div>
  </div></div>;
}
