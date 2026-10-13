'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { translate, useI18n } from '@/lib/i18n';
import { requestFailure } from '@/lib/api-error';
import { CustomerSessionChanged } from '@/lib/customer-auth-flow';

/** Account deletion (PIPL art. 47). The server keeps orders and after-sales records as e-commerce law requires. */
export default function DeleteAccount() {
  const { t } = useI18n(), router = useRouter();
  const userId = useAuthStore(state => state.user?.user_id);
  const pending = useRef(false);
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ userId: number | undefined; message: string } | null>(null);
  const shownError = error && error.userId === userId ? error.message : null;

  const leave = (path: string) => {
    setPassword('');
    useAuthStore.getState().logout();
    router.push(path);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || userId === undefined) return;
    if (!confirmed) { setError({ userId, message: '请确认已了解注销的后果' }); return; }
    if (!password) { setError({ userId, message: '请输入密码' }); return; }
    pending.current = true; setBusy(true); setError(null);
    const sameAccount = () => useAuthStore.getState().user?.user_id === userId;
    try {
      await userApi.deleteAccount(password, sameAccount);
      if (!sameAccount()) return;
      toast.success(translate('账号已注销'));
      leave('/');
    } catch (failure) {
      if (!sameAccount()) return;
      if (failure instanceof CustomerSessionChanged) { setError({ userId, message: failure.message }); return; }
      const status = requestFailure(failure).response?.status;
      // Without a definite answer the deletion may already have committed: never resend the password.
      if (!status || status === 408 || status === 502 || status === 504) {
        toast.error(translate('注销结果尚未确认，请尝试重新登录；无法登录说明账号已注销'));
        leave('/login');
        return;
      }
      setError({ userId, message: requestFailure(failure).response?.data?.error || '注销账号失败，请稍后重试' });
    } finally {
      pending.current = false; setBusy(false);
    }
  };

  return (
    <section className="card p-6 sm:p-8 mt-6 border border-red-200" aria-labelledby="delete-account-heading">
      <h2 id="delete-account-heading" className="text-xl font-bold mb-3 text-red-700">{t('注销账号')}</h2>
      <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 mb-4">
        <li>{t('将删除收货地址、购物车、收藏、浏览与搜索记录和未使用的优惠券，且无法恢复。')}</li>
        <li>{t('订单与售后记录按《电子商务法》保留三年，评价保留但不再显示你的用户名。')}</li>
        <li>{t('有未完成的订单或售后时不能注销；注销后所有设备上的登录都会失效。')}</li>
      </ul>
      <form onSubmit={submit} className="space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmed} disabled={busy} onChange={event => { setConfirmed(event.target.checked); setError(null); }} />
          <span>{t('我已了解注销后无法恢复')}</span>
        </label>
        <label className="block">
          <span className="block mb-2 font-medium">{t('输入当前密码以确认注销')}</span>
          <input name="delete-password" type="password" autoComplete="current-password" className="input" value={password} disabled={busy}
            onChange={event => { setPassword(event.target.value); setError(null); }} />
        </label>
        {shownError && <p role="alert" className="text-sm text-red-600">{t(shownError)}</p>}
        <button type="submit" disabled={busy || userId === undefined} className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
          {t(busy ? '处理中...' : '注销账号')}
        </button>
      </form>
    </section>
  );
}
