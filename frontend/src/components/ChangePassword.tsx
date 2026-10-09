'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { userApi } from '@/lib/api';
import { passwordError } from '@/lib/password-validation';
import { useAuthStore, storedSessionId } from '@/store/useAuthStore';
import { useI18n } from '@/lib/i18n';
import { requestFailure } from '@/lib/api-error';
import { CustomerSessionChanged } from '@/lib/customer-auth-flow';

export default function ChangePassword({ onPasswordChanged, onPasswordUnconfirmed }: { onPasswordChanged?: () => void; onPasswordUnconfirmed?: () => void } = {}) {
  const { t } = useI18n(), router = useRouter();
  const { sessionId, user, isAuthenticated, isHydrated } = useAuthStore();
  const key = JSON.stringify([sessionId, user?.user_id]);
  const currentKey = useRef(key); currentKey.current = key;
  const mounted = useRef(true), mutation = useRef<object | null>(null);
  const [values, setValues] = useState({ current: '', next: '', confirm: '' });
  const [draftKey, setDraftKey] = useState(key);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ key: string; error?: string } | null>(null);
  const active = () => {
    const state = useAuthStore.getState();
    try { return mounted.current && currentKey.current === key && state.isHydrated && state.isAuthenticated && state.sessionId === sessionId && state.user?.user_id === user?.user_id && storedSessionId() === (sessionId ?? null) && JSON.parse(localStorage.getItem('user') || 'null')?.user_id === user?.user_id; }
    catch { return false; }
  };
  useEffect(() => {
    mounted.current = true; setDraftKey(key); setValues({ current: '', next: '', confirm: '' }); setNotice(null); setBusy(false); mutation.current = null;
    return () => { mounted.current = false; };
  }, [key]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!active() || mutation.current) return;
    const error = !values.current ? '请输入当前密码' : passwordError(values.next) || (values.next !== values.confirm ? '两次输入的新密码不一致' : null);
    if (error) { setNotice({ key, error }); return; }
    const operation = {}; mutation.current = operation; setBusy(true); setNotice(null);
    const finish = (confirmed: boolean) => {
      if (!active() || mutation.current !== operation) return;
      setValues({ current: '', next: '', confirm: '' });
      if (confirmed) onPasswordChanged?.();
      else onPasswordUnconfirmed?.();
      if (!active() || mutation.current !== operation) return;
      useAuthStore.getState().logout();
      router.push(confirmed ? '/login?passwordChanged=1' : '/login?passwordChangeUnconfirmed=1');
    };
    try {
      const data: unknown = await userApi.changePassword({ currentPassword: values.current, newPassword: values.next },
        () => active() && mutation.current === operation);
      if (!active() || mutation.current !== operation) return;
      finish(!!data && typeof data === 'object' && 'reauthenticate' in data && data.reauthenticate === true);
    } catch (error) {
      if (active() && mutation.current === operation) {
        if (error instanceof CustomerSessionChanged) { setNotice({ key, error: error.message }); return; }
        const failure = requestFailure(error), status = failure.response?.status;
        // A password write can commit before its reply is lost. Never resend these credentials
        // to find out: forget this sign-in and let the customer sign in or recover the password.
        if (!status || status === 408 || status === 409 || status === 429 || status >= 500) finish(false);
        else setNotice({ key, error: failure.response?.data?.error || '修改密码失败，请重试' });
      }
    } finally {
      if (active() && mutation.current === operation) { mutation.current = null; setBusy(false); }
    }
  };
  if (!isHydrated || !isAuthenticated || !active() || draftKey !== key) return null;
  const field = (name: keyof typeof values, label: string, autoComplete: string) => <label className="block"><span className="block mb-2 font-medium">{t(label)}</span><input name={name} type="password" autoComplete={autoComplete} required className="input" value={values[name]} disabled={busy} onChange={event => { if (active() && !mutation.current) { setValues(previous => ({ ...previous, [name]: event.target.value })); setNotice(null); } }} /></label>;
  return <section className="card p-6 sm:p-8 mt-6" aria-labelledby="password-heading">
    <h2 id="password-heading" className="text-xl font-bold mb-3">{t('修改密码')}</h2>
    <p className="text-gray-600 text-sm mb-6">{t('新密码至少12个字符，且不超过72字节')}</p>
    <p className="text-gray-600 text-sm mb-6">{t('修改成功后所有登录会话将失效，请重新登录')}</p>
    <form onSubmit={submit} className="space-y-4">
      {field('current', '当前密码', 'current-password')}{field('next', '新密码', 'new-password')}{field('confirm', '确认新密码', 'new-password')}
      {notice?.key === key && notice.error && <p className="text-red-600" role="alert">{t(notice.error)}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary">{t(busy ? '处理中...' : '修改密码')}</button>
    </form>
  </section>;
}
