'use client';

import { useEffect, useRef, useState } from 'react';
import { afterSalesApi, type AfterSalesRequest } from '@/lib/api';
import { useAuthStore, storedSessionId } from '@/store/useAuthStore';
import { useI18n } from '@/lib/i18n';
import { requestFailure } from '@/lib/api-error';
import AfterSalesProgress from '@/components/AfterSalesProgress';

export const AFTER_SALES_STATUS = { requested: '待审核', approved: '审核通过', rejected: '审核拒绝', withdrawn: '已撤回' };

export default function OrderAfterSales({ orderId }: { orderId: number }) {
  const { t, formatDate } = useI18n();
  const { sessionId, user, isAuthenticated } = useAuthStore();
  const key = JSON.stringify([sessionId, user?.user_id, orderId]);
  const currentKey = useRef(key); currentKey.current = key;
  const mounted = useRef(true), request = useRef(0), mutation = useRef<object | null>(null);
  const [result, setResult] = useState<{ key: string; value: AfterSalesRequest | null; error?: string } | null>(null);
  const [type, setType] = useState<'refund' | 'return'>('refund');
  const [reason, setReason] = useState('');
  const [parcel, setParcel] = useState({ company: '', tracking_number: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ key: string; error?: string; success?: string } | null>(null);
  const active = () => {
    const state = useAuthStore.getState();
    try { return mounted.current && currentKey.current === key && state.isAuthenticated && state.sessionId === sessionId && state.user?.user_id === user?.user_id && storedSessionId() === (sessionId ?? null); }
    catch { return false; }
  };
  const load = async () => {
    if (!active() || mutation.current) return;
    const revision = ++request.current; setResult(null);
    try {
      const data = await afterSalesApi.get(orderId);
      if (active() && revision === request.current) setResult({ key, value: data.after_sales });
    } catch (error) {
      if (active() && revision === request.current) setResult({ key, value: null, error: requestFailure(error).response?.data?.error || '加载售后申请失败，请重试' });
    }
  };
  useEffect(() => {
    mounted.current = true; setResult(null); setReason(''); setParcel({ company: '', tracking_number: '' }); setType('refund'); setNotice(null); setBusy(false); mutation.current = null;
    if (isAuthenticated) load();
    return () => { mounted.current = false; request.current++; };
  }, [key, isAuthenticated]);
  const mutate = async (withdraw: boolean) => {
    if (!active() || mutation.current || result?.key !== key || result.error) return;
    if (withdraw ? result.value?.status !== 'requested' : !!result.value) return;
    const trimmed = reason.trim();
    if (!withdraw && (!trimmed || trimmed.length > 500)) { setNotice({ key, error: '请填写1至500个字符的申请原因' }); return; }
    const operation = {}; mutation.current = operation; setBusy(true); setNotice(null);
    try {
      const data = withdraw ? await afterSalesApi.withdraw(orderId) : await afterSalesApi.create(orderId, { type, reason: trimmed });
      if (!active() || mutation.current !== operation) return;
      setResult({ key, value: data.after_sales }); setReason('');
      setNotice({ key, success: withdraw ? '售后申请已撤回' : '售后申请已提交，等待审核' });
    } catch (error) {
      if (active() && mutation.current === operation) setNotice({ key, error: requestFailure(error).response?.data?.error || '处理售后申请失败，请重试' });
    } finally {
      if (active() && mutation.current === operation) { mutation.current = null; setBusy(false); }
    }
  };
  const submitTracking = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = result?.key === key ? result.value : null;
    if (!active() || mutation.current || result?.error || value?.status !== 'approved' || value.type !== 'return' || value.return_submitted_at || value.completed_at) return;
    const company = parcel.company.trim(), tracking_number = parcel.tracking_number.trim();
    if (!company || company.length > 60 || !tracking_number || tracking_number.length > 100) { setNotice({ key, error: '退货快递公司或运单号无效' }); return; }
    const operation = {}; mutation.current = operation; setBusy(true); setNotice(null);
    try {
      const data = await afterSalesApi.tracking(orderId, { company, tracking_number });
      if (!active() || mutation.current !== operation) return;
      setResult({ key, value: data.after_sales }); setParcel({ company: '', tracking_number: '' }); setNotice({ key, success: '退货运单已保存' });
    } catch (error) {
      if (active() && mutation.current === operation) setNotice({ key, error: requestFailure(error).response?.data?.error || '保存退货运单失败' });
    } finally { if (active() && mutation.current === operation) { mutation.current = null; setBusy(false); } }
  };
  if (!isAuthenticated || !active()) return null;
  const value = result?.key === key ? result.value : null;
  return <section className="card p-6 mb-6" aria-labelledby="after-sales-heading">
    <h2 id="after-sales-heading" className="font-bold text-lg mb-3">{t('售后申请')}</h2>
    <p className="text-sm text-amber-800 mb-4">{t('售后审核、退货运单和人工处理进度在此查看，不会自动退款')}</p>
    {result?.key !== key ? <p role="status">{t('加载中...')}</p> : result.error ? <div role="alert"><p className="text-red-600">{t(result.error)}</p><button className="btn btn-secondary mt-3" onClick={load}>{t('重新加载')}</button></div> : value ? <div className="space-y-3">
      <p>{t('申请类型')}：{t(value.type === 'return' ? '退货申请' : '退款申请')}</p>
      <p>{t('审核状态')}：{t(AFTER_SALES_STATUS[value.status])}</p>
      <p className="whitespace-pre-wrap wrap-break-word">{t('申请原因')}：{value.reason}</p>
      {value.review_note && <p className="whitespace-pre-wrap wrap-break-word">{t('审核说明')}：{value.review_note}</p>}
      <p className="text-sm text-gray-500">{t('申请时间')}：{formatDate(value.created_at)}</p>
      <AfterSalesProgress value={value} />
      {value.status === 'approved' && value.type === 'return' && !value.return_submitted_at && !value.completed_at && <form className="space-y-3" onSubmit={submitTracking}>
        <p className="text-sm text-amber-800">{t('请先与商家确认退货地址和方式；运单提交后如需更正请联系商家')}</p>
        <label className="block"><span className="block mb-2">{t('退货快递公司')}</span><input className="input" maxLength={60} required disabled={busy} value={parcel.company} onChange={event => { if (active() && !mutation.current) setParcel({ ...parcel, company: event.target.value }); }} /></label>
        <label className="block"><span className="block mb-2">{t('退货运单号')}</span><input className="input" maxLength={100} required disabled={busy} value={parcel.tracking_number} onChange={event => { if (active() && !mutation.current) setParcel({ ...parcel, tracking_number: event.target.value }); }} /></label>
        <button className="btn btn-primary" disabled={busy}>{t('提交退货运单')}</button>
      </form>}
      {value.status === 'requested' && <button disabled={busy} onClick={() => mutate(true)} className="btn btn-secondary">{t('撤回申请')}</button>}
    </div> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void mutate(false); }}>
      <label className="block"><span className="block mb-2">{t('申请类型')}</span><select className="input" value={type} disabled={busy} onChange={event => { if (active() && !mutation.current) setType(event.target.value as 'refund' | 'return'); }}><option value="refund">{t('退款申请')}</option><option value="return">{t('退货申请')}</option></select></label>
      <label className="block"><span className="block mb-2">{t('申请原因')}</span><textarea className="input min-h-[100px]" value={reason} maxLength={500} required disabled={busy} onChange={event => { if (active() && !mutation.current) setReason(event.target.value); }} /></label>
      <button className="btn btn-primary" disabled={busy}>{t(busy ? '处理中...' : '提交申请')}</button>
    </form>}
    {notice?.key === key && notice.error && <p role="alert" className="mt-4 text-red-600">{t(notice.error)}</p>}
    {notice?.key === key && notice.success && <p role="status" className="mt-4 text-green-700">{t(notice.success)}</p>}
  </section>;
}
