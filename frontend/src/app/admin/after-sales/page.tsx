'use client';

import { useEffect, useRef, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { afterSalesApi, type AfterSalesRequest } from '@/lib/api';
import { AFTER_SALES_STATUS } from '@/components/OrderAfterSales';
import { useAdminSession } from '@/hooks/use-admin-session';
import { useI18n } from '@/lib/i18n';
import toast from 'react-hot-toast';

export default function AdminAfterSalesPage() {
  const { t, formatDate } = useI18n(), session = useAdminSession();
  const [page, setPage] = useState(1), [status, setStatus] = useState('requested');
  const [result, setResult] = useState<{ key: string; requests: AfterSalesRequest[]; total: number; error?: string } | null>(null);
  const [review, setReview] = useState<{ key: string; id: number; decision: 'approved' | 'rejected'; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify([session.token, page, status]), currentKey = useRef(key); currentKey.current = key;
  const request = useRef(0), mutation = useRef<object | null>(null), latestLoad = useRef<(() => Promise<void>) | null>(null);
  const active = () => session.active() && currentKey.current === key;
  const visible = result?.key === key && session.active() ? result : null;
  const load = async () => {
    if (!active()) return;
    const revision = ++request.current; setResult(null);
    try {
      const data = await afterSalesApi.list({ page, limit: 20, ...(status && { status }) });
      if (!active() || revision !== request.current) return;
      const total = Number(data.pagination?.total) || 0;
      if (page > Math.max(1, Math.ceil(total / 20))) { setPage(Math.max(1, Math.ceil(total / 20))); return; }
      setResult({ key, requests: data.requests || [], total });
    } catch (error: any) { if (active() && revision === request.current) setResult({ key, requests: [], total: 0, error: error.response?.data?.error || '加载售后申请失败，请重试' }); }
  };
  latestLoad.current = load;
  useEffect(() => { setPage(1); setStatus('requested'); setReview(null); mutation.current = null; setBusy(false); }, [session.token]);
  useEffect(() => { setReview(null); load(); return () => { request.current++; }; }, [key]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!active() || mutation.current || review?.key !== key || !visible?.requests.some(value => value.request_id === review.id && value.status === 'requested')) return;
    const note = review.note.trim();
    if (!note || note.length > 500) { toast.error(t('请填写1至500个字符的审核说明')); return; }
    const operation = {}; mutation.current = operation; setBusy(true);
    try {
      await afterSalesApi.review(review.id, { status: review.decision, note });
      if (!session.active() || mutation.current !== operation) return;
      if (active()) { toast.success(t('售后审核已保存，未执行资金退款')); setReview(null); }
      await latestLoad.current?.();
    } catch (error: any) { if (active() && mutation.current === operation) toast.error(t(error.response?.data?.error || '保存售后审核失败，请重试')); }
    finally { if (session.active() && mutation.current === operation) { mutation.current = null; setBusy(false); } }
  };
  return <AdminLayout><div className="space-y-6">
    <div><h1 className="text-2xl font-bold">{t('售后管理')}</h1><p className="mt-2 text-amber-800">{t('此处仅处理售后审核，不会自动退款；审核通过后请联系商家安排退款或退货')}</p></div>
    <div className="card p-4 flex gap-4"><select className="input max-w-xs" value={status} aria-label={t('审核状态')} onChange={event => { currentKey.current = ''; setStatus(event.target.value); setPage(1); setReview(null); }}><option value="">{t('全部状态')}</option>{Object.entries(AFTER_SALES_STATUS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select><button className="btn btn-secondary" onClick={load}>{t('重新加载')}</button></div>
    {review?.key === key && active() && <form className="card p-6 space-y-4" onSubmit={submit}><h2 className="font-bold">{t(review.decision === 'approved' ? '通过售后审核' : '拒绝售后申请')}</h2><label className="block"><span className="block mb-2">{t('审核说明')}</span><textarea className="input min-h-[100px]" maxLength={500} required disabled={busy} value={review.note} onChange={event => { if (active() && !mutation.current) setReview({ ...review, note: event.target.value }); }} /></label><div className="flex gap-3"><button className="btn btn-primary" disabled={busy}>{t('保存审核结果')}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { if (active() && !mutation.current) setReview(null); }}>{t('取消')}</button></div></form>}
    {!visible ? <p role="status">{t('加载中...')}</p> : visible.error ? <p className="card p-6 text-red-600" role="alert">{t(visible.error)}</p> : <>
      <div className="space-y-4">{visible.requests.length === 0 && <p className="card p-6">{t('暂无售后申请')}</p>}{visible.requests.map(value => <article className="card p-6 space-y-3" key={value.request_id}>
        <div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{t('订单号')}：{value.order_no || value.order_id}</p><span>{t(AFTER_SALES_STATUS[value.status])}</span></div>
        <p>{t('用户')}：{value.username || '—'}</p><p>{t('申请类型')}：{t(value.type === 'return' ? '退货申请' : '退款申请')}</p><p className="whitespace-pre-wrap wrap-break-word">{t('申请原因')}：{value.reason}</p>
        {value.review_note && <p className="whitespace-pre-wrap wrap-break-word">{t('审核说明')}：{value.review_note}</p>}<p className="text-gray-500 text-sm">{t('申请时间')}：{formatDate(value.created_at)}</p>
        {value.status === 'requested' && <div className="flex gap-3">{(['approved', 'rejected'] as const).map(decision => <button key={decision} className="btn btn-secondary" disabled={busy} onClick={() => { if (active() && !mutation.current) setReview({ key, id: value.request_id, decision, note: '' }); }}>{t(decision === 'approved' ? '通过审核' : '拒绝申请')}</button>)}</div>}
      </article>)}</div>
      <div className="flex justify-between items-center"><p>{t('共 {count} 个售后申请', { count: visible.total })}</p><div className="flex gap-3"><button className="btn btn-secondary" disabled={page <= 1} onClick={() => { currentKey.current = ''; setPage(page - 1); }}>{t('上一页')}</button><span>{t('第 {page} 页', { page })}</span><button className="btn btn-secondary" disabled={page >= Math.ceil(visible.total / 20)} onClick={() => { currentKey.current = ''; setPage(page + 1); }}>{t('下一页')}</button></div></div>
    </>}
  </div></AdminLayout>;
}
