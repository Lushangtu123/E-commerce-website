'use client';

import { useRef, useState } from 'react';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useI18n } from '@/lib/i18n';
import { requestFailure } from '@/lib/api-error';

/** Downloads everything the store holds about the signed-in customer (PIPL right of access and copy). */
export default function PersonalDataExport() {
  const { t } = useI18n();
  const userId = useAuthStore(state => state.user?.user_id);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ userId: number | undefined; error?: string; success?: string } | null>(null);
  const shown = notice?.userId === userId ? notice : null;

  const download = async () => {
    if (pending.current || userId === undefined) return;
    pending.current = true; setBusy(true); setNotice(null);
    // A reply for an account that is no longer signed in is never saved.
    const sameAccount = () => useAuthStore.getState().user?.user_id === userId;
    try {
      const data = await userApi.exportData();
      if (!sameAccount()) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `personal-data-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice({ userId, success: '个人信息已导出' });
    } catch (error) {
      if (sameAccount()) setNotice({ userId, error: requestFailure(error).response?.data?.error || '导出个人信息失败，请稍后重试' });
    } finally {
      pending.current = false; setBusy(false);
    }
  };

  return (
    <section className="card p-6 space-y-3" aria-labelledby="personal-data-export-title">
      <h2 id="personal-data-export-title" className="text-lg font-bold">{t('我的个人信息')}</h2>
      <p className="text-sm text-gray-600">{t('下载账户、收货地址、订单、售后、评价、收藏、浏览与搜索记录等全部个人信息（JSON 文件）。')}</p>
      {shown?.error && <p role="alert" className="text-sm text-red-600">{t(shown.error)}</p>}
      {shown?.success && <p role="status" className="text-sm text-green-700">{t(shown.success)}</p>}
      <button type="button" className="btn btn-outline disabled:opacity-50" disabled={busy || userId === undefined} onClick={() => void download()}>
        {t(busy ? '导出中...' : '导出个人信息')}
      </button>
    </section>
  );
}
