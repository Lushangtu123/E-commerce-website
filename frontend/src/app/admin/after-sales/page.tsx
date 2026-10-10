'use client';

import '@/lib/admin-i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { afterSalesApi, type AfterSalesRequest } from '@/lib/api';
import { AFTER_SALES_STATUS } from '@/components/OrderAfterSales';
import { useAdminSession } from '@/hooks/use-admin-session';
import { translate, useI18n } from '@/lib/i18n';
import toast from 'react-hot-toast';
import { requestFailure } from '@/lib/api-error';
import AfterSalesProgress from '@/components/AfterSalesProgress';
import Link from 'next/link';
import { moneyToCents } from '@/lib/money';
import { validAfterSalesRequest } from '@/lib/after-sales-response';

function amountLabel(amount: AfterSalesRequest['total_amount']) {
  try { return `¥${(moneyToCents(amount!) / 100).toFixed(2)}`; } catch { return '—'; }
}

function RefundContext({ value }: { value: AfterSalesRequest }) {
  const { t } = useI18n();
  return <div className="rounded-lg bg-gray-50 p-4 space-y-2 text-sm">
    <p>{t('订单实付金额')}：{amountLabel(value.total_amount)}</p>
    <p>{t('可记录退款上限')}：{amountLabel(value.payment_method === 'demo' ? 0 : value.total_amount)}</p>
    {value.payment_method === 'demo' && <p className="text-amber-800">{t('演示订单，未实际扣款')}</p>}
  </div>;
}

export default function AdminAfterSalesPage() {
  const { t, formatDate } = useI18n(), session = useAdminSession();
  const [page, setPage] = useState(1), [status, setStatus] = useState('requested');
  const [result, setResult] = useState<{ key: string; requests: AfterSalesRequest[]; total: number; error?: string } | null>(null);
  const [review, setReview] = useState<{ key: string; id: number; decision: 'approved' | 'rejected'; note: string } | null>(null);
  const [completion, setCompletion] = useState<{ key: string; id: number; amount: string; reference: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const recovery = useRef<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const currentReview = useRef<typeof review>(null), currentCompletion = useRef<typeof completion>(null), currentResult = useRef<typeof result>(null);
  const updateReview = useCallback((value: typeof review) => { currentReview.current = value; setReview(value); }, []);
  const updateCompletion = useCallback((value: typeof completion) => { currentCompletion.current = value; setCompletion(value); }, []);
  const updateResult = useCallback((value: typeof result) => { currentResult.current = value; setResult(value); }, []);
  const key = JSON.stringify([session.sessionId, page, status]), currentKey = useRef(key); currentKey.current = key;
  const request = useRef(0), mutation = useRef<{ key: string } | null>(null), latestLoad = useRef<((operation?: { key: string }) => Promise<void>) | null>(null);
  const pendingLoad = useRef<{ key: string } | null>(null);
  const active = () => session.active() && currentKey.current === key;
  const visible = result?.key === key && session.active() ? result : null;
  const closing = visible?.requests.find(value => value.request_id === completion?.id);
  const blocked = unconfirmed === key;
  const load = async (reconcileOperation?: { key: string }) => {
    if (!active() || (mutation.current?.key === key && mutation.current !== reconcileOperation)) return;
    const operation = { key }; pendingLoad.current = operation;
    const revision = ++request.current; updateResult(null);
    try {
      const data = await afterSalesApi.list({ page, limit: 20, ...(status && { status }) });
      if (!active() || revision !== request.current) return;
      if (recovery.current === key && (!Array.isArray(data.requests) || !data.requests.every(validAfterSalesRequest) || !Number.isSafeInteger(data.pagination?.total) || data.pagination.total < 0)) throw new Error('invalid after-sales list');
      const total = Number(data.pagination?.total) || 0;
      if (page > Math.max(1, Math.ceil(total / 20))) { setPage(Math.max(1, Math.ceil(total / 20))); return; }
      updateResult({ key, requests: data.requests || [], total });
      if (recovery.current === key) {
        recovery.current = null; setUnconfirmed(null);
        const reviewDraft = currentReview.current;
        if (reviewDraft?.key === key && !data.requests?.some(value => value.request_id === reviewDraft.id && value.status === 'requested')) updateReview(null);
        const draft = currentCompletion.current;
        if (draft?.key === key && !data.requests?.some(value => value.request_id === draft.id && value.status === 'approved' && !value.completed_at && (value.type === 'refund' || value.return_submitted_at))) updateCompletion(null);
      }
    } catch (error) { if (active() && revision === request.current) updateResult({ key, requests: [], total: 0, error: recovery.current === key ? '操作结果尚未确认，请刷新售后进度后再操作' : requestFailure(error).response?.data?.error || '加载售后申请失败，请重试' }); }
    finally { if (pendingLoad.current === operation) pendingLoad.current = null; }
  };
  latestLoad.current = load;
  useEffect(() => { setPage(1); setStatus('requested'); updateReview(null); updateCompletion(null); mutation.current = null; setBusy(false); recovery.current = null; setUnconfirmed(null); }, [session.sessionId, updateCompletion, updateReview]);
  useEffect(() => { updateReview(null); updateCompletion(null); load(); return () => {
    request.current++;
    if (pendingLoad.current?.key === key) pendingLoad.current = null;
  }; }, [key, updateCompletion, updateReview]);
  useEffect(() => { if (session.ready && !pendingLoad.current) void latestLoad.current?.(); }, [session.ready]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!active() || mutation.current || recovery.current === key || currentReview.current !== review || currentResult.current !== visible || review?.key !== key || !visible?.requests.some(value => value.request_id === review.id && value.status === 'requested')) return;
    const note = review.note.trim();
    if (!note || note.length > 500) { toast.error(translate('请填写1至500个字符的审核说明')); return; }
    const operation = { key }; mutation.current = operation; setBusy(true);
    try {
      await afterSalesApi.review(review.id, { status: review.decision, note });
      if (!session.active() || mutation.current !== operation) return;
      if (active()) { toast.success(translate('售后审核已保存，未执行资金退款')); updateReview(null); }
      await latestLoad.current?.(operation);
    } catch (error) {
      if (session.active() && mutation.current === operation) {
        const failure = requestFailure(error), status = failure.response?.status;
        if (active()) toast.error(translate(failure.response?.data?.error || '保存售后审核失败，请重试'));
        if (!status || status === 408 || status === 429 || status >= 500 || status === 409) {
          recovery.current = key; setUnconfirmed(key); await latestLoad.current?.(operation);
        }
      }
    }
    finally { if (mutation.current === operation) { mutation.current = null; setBusy(false); } }
  };
  const complete = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = visible?.requests.find(value => value.request_id === completion?.id);
    if (!active() || mutation.current || recovery.current === key || currentCompletion.current !== completion || currentResult.current !== visible || completion?.key !== key || value?.status !== 'approved' || value.completed_at || (value.type === 'return' && !value.return_submitted_at)) return;
    const amount = completion.amount.trim(), reference = completion.reference.trim(), note = completion.note.trim();
    let cents: number, paidCents: number;
    try { cents = moneyToCents(amount); paidCents = moneyToCents(value.total_amount!); }
    catch { toast.error(translate('退款金额、凭证或结案说明无效')); return; }
    if (!note || note.length > 500 || reference.length > 100) { toast.error(translate('退款金额、凭证或结案说明无效')); return; }
    if (value.payment_method === 'demo' && cents !== 0) { toast.error(translate('演示订单未实际扣款，退款金额必须为零')); return; }
    if (cents > paidCents) { toast.error(translate('退款金额不能超过订单实付金额')); return; }
    if (cents > 0 && !reference) { toast.error(translate('实际退款必须填写退款凭证')); return; }
    const operation = { key }; mutation.current = operation; setBusy(true);
    try {
      await afterSalesApi.complete(completion.id, { refund_amount: amount, ...(reference && { refund_reference: reference }), note });
      if (!session.active() || mutation.current !== operation) return;
      if (active()) { toast.success(translate('人工处理记录已保存并结案，系统未执行资金退款')); updateCompletion(null); }
      await latestLoad.current?.(operation);
    } catch (error) {
      if (session.active() && mutation.current === operation) {
        const failure = requestFailure(error), status = failure.response?.status;
        if (active()) toast.error(translate(failure.response?.data?.error || '保存售后结案失败'));
        if (!status || status === 408 || status === 429 || status >= 500 || status === 409) {
          recovery.current = key; setUnconfirmed(key); await latestLoad.current?.(operation);
        }
      }
    }
    finally { if (mutation.current === operation) { mutation.current = null; setBusy(false); } }
  };
  return <AdminLayout><div className="space-y-6">
    <div><h1 className="text-2xl font-bold">{t('售后管理')}</h1><p className="mt-2 text-amber-800">{t('售后审核、退货运单和人工处理进度在此查看，不会自动退款')}</p></div>
    <div className="card p-4 flex gap-4"><select className="input max-w-xs" value={status} aria-label={t('审核状态')} onChange={event => { currentKey.current = ''; setStatus(event.target.value); setPage(1); updateReview(null); }}><option value="">{t('全部状态')}</option>{Object.entries(AFTER_SALES_STATUS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select><button className="btn btn-secondary" disabled={busy} onClick={() => void load()}>{t('重新加载')}</button></div>
    {review?.key === key && active() && <form className="card p-6 space-y-4" onSubmit={submit}><h2 className="font-bold">{t(review.decision === 'approved' ? '通过售后审核' : '拒绝售后申请')}</h2><label className="block"><span className="block mb-2">{t('审核说明')}</span><textarea className="input min-h-[100px]" maxLength={500} required disabled={busy || blocked} value={review.note} onChange={event => { if (active() && !mutation.current && recovery.current !== key) updateReview({ ...review, note: event.target.value }); }} /></label><div className="flex gap-3"><button className="btn btn-primary" disabled={busy || blocked}>{t('保存审核结果')}</button><button type="button" className="btn btn-secondary" disabled={busy || blocked} onClick={() => { if (active() && !mutation.current && recovery.current !== key) updateReview(null); }}>{t('取消')}</button></div></form>}
    {completion?.key === key && session.active() && <form className="card p-6 space-y-4" onSubmit={complete}>
      <h2 className="font-bold">{t('记录处理并结案')}</h2>
      {closing && <RefundContext value={closing} />}
      <p className="text-sm text-amber-800">{t('仅在人工处理完成后结案；未实际退款填零，非零金额需填写退款凭证')}</p>
      <label className="block"><span className="block mb-2">{t('实际退款金额')}</span><input className="input" inputMode="decimal" required disabled={busy || blocked} value={completion.amount} onChange={event => { if (active() && !mutation.current && recovery.current !== key) updateCompletion({ ...completion, amount: event.target.value }); }} /></label>
      <label className="block"><span className="block mb-2">{t('退款凭证')}</span><input className="input" maxLength={100} disabled={busy || blocked} value={completion.reference} onChange={event => { if (active() && !mutation.current && recovery.current !== key) updateCompletion({ ...completion, reference: event.target.value }); }} /></label>
      <label className="block"><span className="block mb-2">{t('结案说明')}</span><textarea className="input" maxLength={500} required disabled={busy || blocked} value={completion.note} onChange={event => { if (active() && !mutation.current && recovery.current !== key) updateCompletion({ ...completion, note: event.target.value }); }} /></label>
      <div className="flex gap-3"><button className="btn btn-primary" disabled={busy || blocked}>{t('保存结案记录')}</button><button type="button" className="btn btn-secondary" disabled={busy || blocked} onClick={() => { if (active() && !mutation.current && recovery.current !== key) updateCompletion(null); }}>{t('取消')}</button></div>
    </form>}
    {!visible ? <p role="status">{t('加载中...')}</p> : visible.error ? <p className="card p-6 text-red-600" role="alert">{t(visible.error)}</p> : <>
      <div className="space-y-4">{visible.requests.length === 0 && <p className="card p-6">{t('暂无售后申请')}</p>}{visible.requests.map(value => <article className="card p-6 space-y-3" key={value.request_id}>
        <div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{t('订单号')}：{value.order_no || value.order_id}</p><span>{t(AFTER_SALES_STATUS[value.status])}</span></div>
        <p>{t('用户')}：{value.username || '—'}</p><p>{t('申请类型')}：{t(value.type === 'return' ? '退货申请' : '退款申请')}</p><p className="whitespace-pre-wrap wrap-break-word">{t('申请原因')}：{value.reason}</p>
        <p>{t('用户编号')}：{value.user_id ?? '—'}</p>
        <RefundContext value={value} />
        <Link href="/admin/orders" className="text-primary-600 hover:underline">{t('查看订单列表')}</Link>
        {value.review_note && <p className="whitespace-pre-wrap wrap-break-word">{t('审核说明')}：{value.review_note}</p>}<p className="text-gray-500 text-sm">{t('申请时间')}：{formatDate(value.created_at)}</p>
        <AfterSalesProgress value={value} />
        {value.status === 'approved' && !value.completed_at && (value.type === 'refund' || value.return_submitted_at) && <button className="btn btn-secondary" disabled={busy || blocked} onClick={() => { if (active() && !mutation.current && recovery.current !== key) { updateReview(null); updateCompletion({ key, id: value.request_id, amount: '', reference: '', note: '' }); } }}>{t('记录处理并结案')}</button>}
        {value.status === 'requested' && <div className="flex gap-3">{(['approved', 'rejected'] as const).map(decision => <button key={decision} className="btn btn-secondary" disabled={busy || blocked} onClick={() => { if (active() && !mutation.current && recovery.current !== key) updateReview({ key, id: value.request_id, decision, note: '' }); }}>{t(decision === 'approved' ? '通过审核' : '拒绝申请')}</button>)}</div>}
      </article>)}</div>
      <div className="flex justify-between items-center"><p>{t('共 {count} 个售后申请', { count: visible.total })}</p><div className="flex gap-3"><button className="btn btn-secondary" disabled={page <= 1} onClick={() => { currentKey.current = ''; setPage(page - 1); }}>{t('上一页')}</button><span>{t('第 {page} 页', { page })}</span><button className="btn btn-secondary" disabled={page >= Math.ceil(visible.total / 20)} onClick={() => { currentKey.current = ''; setPage(page + 1); }}>{t('下一页')}</button></div></div>
    </>}
  </div></AdminLayout>;
}
