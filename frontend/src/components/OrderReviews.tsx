'use client';

import { useEffect, useRef, useState } from 'react';
import { reviewApi, type PurchaseReview } from '@/lib/api';
import { useAuthStore, storedSessionId } from '@/store/useAuthStore';
import { useI18n } from '@/lib/i18n';
import { requestFailure } from '@/lib/api-error';

type Item = { product_id: number; product_name: string };
type Draft = { rating: string; content: string };
type Result = { key: string; reviews?: PurchaseReview[]; error?: string };
const initialDraft: Draft = { rating: '5', content: '' };

export default function OrderReviews({ orderId, items }: { orderId: number; items: Item[] }) {
  const { t, formatDate } = useI18n();
  const { isAuthenticated, isHydrated, sessionId, user } = useAuthStore();
  const products = Array.from(new Map(items.map(item => [item.product_id, item])).values());
  const key = JSON.stringify([sessionId, user?.user_id, orderId, products.map(item => item.product_id)]);
  const currentKey = useRef(key); currentKey.current = key;
  const mounted = useRef(true);
  const request = useRef(0);
  const mutation = useRef<object | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const currentReviews = useRef<PurchaseReview[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const draftRef = useRef<Record<number, Draft>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ key: string; productId: number; error?: string; success?: string } | null>(null);
  const isCurrent = () => {
    const state = useAuthStore.getState();
    try {
      return mounted.current && currentKey.current === key && state.isHydrated && state.isAuthenticated &&
        state.sessionId === sessionId && state.user?.user_id === user?.user_id && storedSessionId() === sessionId &&
        JSON.parse(localStorage.getItem('user') || 'null')?.user_id === user?.user_id;
    } catch { return false; }
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current++; };
  }, []);

  const load = async (afterSave = false) => {
    if (!isCurrent() || (mutation.current && !afterSave)) return;
    const generation = ++request.current;
    setResult(null); currentReviews.current = null;
    try {
      const all: PurchaseReview[] = [];
      let totalPages = 1;
      for (let page = 1; page <= totalPages; page++) {
        const data = await reviewApi.listByUser({ order_id: orderId, page, limit: 100 });
        if (!isCurrent() || generation !== request.current) return;
        if (!Array.isArray(data.reviews) || !Number.isSafeInteger(data.totalPages) || data.totalPages < 0 ||
          data.totalPages > Math.ceil(products.length / 100) || data.reviews.some(review =>
            review.user_id !== user?.user_id || review.order_id !== orderId || !products.some(item => item.product_id === review.product_id) ||
            !Number.isSafeInteger(review.review_id) || review.review_id <= 0 || !Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5 ||
            (review.content != null && typeof review.content !== 'string'))) throw new Error();
        totalPages = data.totalPages;
        all.push(...data.reviews);
      }
      currentReviews.current = all;
      setResult({ key, reviews: all });
    } catch (error) {
      if (isCurrent() && generation === request.current) setResult({ key, error: requestFailure(error).response?.data?.error || '加载订单评价失败，请重试' });
    }
  };

  useEffect(() => {
    request.current++; mutation.current = null; currentReviews.current = null;
    draftRef.current = {}; setDrafts({}); setResult(null); setBusy(null); setNotice(null);
    if (isHydrated && isAuthenticated && products.length) load();
    return () => { request.current++; };
  }, [key, isHydrated, isAuthenticated]);

  const change = (productId: number, field: keyof Draft, value: string) => {
    if (!isCurrent() || mutation.current || !currentReviews.current || currentReviews.current.some(review => review.product_id === productId)) return;
    draftRef.current = { ...draftRef.current, [productId]: { ...(draftRef.current[productId] ?? initialDraft), [field]: value } };
    setDrafts(draftRef.current); setNotice(null);
  };

  const submit = async (event: React.FormEvent, productId: number) => {
    event.preventDefault();
    if (!isCurrent() || mutation.current || !currentReviews.current || !products.some(item => item.product_id === productId) ||
      currentReviews.current.some(review => review.product_id === productId)) return;
    const draft = draftRef.current[productId] ?? initialDraft;
    const rating = Number(draft.rating);
    const content = draft.content.trim();
    if (!/^[1-5]$/.test(draft.rating) || content.length > 2000) {
      setNotice({ key, productId, error: '评分须为1至5分，评价内容最多2000个字符' }); return;
    }
    const operation = {}; mutation.current = operation; setBusy(productId); setNotice(null);
    const active = () => isCurrent() && mutation.current === operation;
    try {
      const data = await reviewApi.create({ order_id: orderId, product_id: productId, rating, content });
      if (!active()) return;
      if (!Number.isSafeInteger(data.review_id) || data.review_id <= 0) {
        await load(true);
        if (active()) setNotice({ key, productId, error: '评价响应无效，请重新加载' });
        return;
      }
      const reviews = [...(currentReviews.current ?? []), { review_id: data.review_id, user_id: user!.user_id, order_id: orderId, product_id: productId, rating, content }];
      currentReviews.current = reviews; setResult({ key, reviews });
      setNotice({ key, productId, success: '评论成功' });
    } catch (error) {
      if (!active()) return;
      if (requestFailure(error).response?.status === 409) await load(true);
      if (active()) setNotice({ key, productId, error: requestFailure(error).response?.data?.error || '创建评论失败' });
    } finally {
      if (mutation.current === operation) {
        mutation.current = null;
        if (isCurrent()) setBusy(null);
      }
    }
  };

  if (!products.length || !isHydrated || !isAuthenticated || !isCurrent()) return null;
  return (
    <section className="card p-6 mb-6" aria-labelledby="order-reviews-title">
      <h2 id="order-reviews-title" className="font-bold text-lg mb-2">{t('订单评价')}</h2>
      <p className="text-sm text-gray-600 mb-5">{t('每个订单的每种商品可评价一次，不同规格共用一条评价')}</p>
      {result?.key !== key ? <p role="status">{t('订单评价加载中...')}</p> : result.error ? (
        <div role="alert"><p className="text-red-600">{t(result.error)}</p><button type="button" className="btn btn-outline mt-3" onClick={() => load()}>{t('重新加载评价')}</button></div>
      ) : <div className="space-y-6">{products.map(item => {
        const review = result.reviews?.find(review => review.product_id === item.product_id);
        const draft = drafts[item.product_id] ?? initialDraft;
        const message = notice?.key === key && notice.productId === item.product_id ? notice : null;
        return <div key={item.product_id} className="border-t pt-5">
          <h3 className="font-medium mb-3">{item.product_name}</h3>
          {review ? <div>
            <p className="text-green-700">{t('已评价')} · {t('{rating}分', { rating: review.rating })}</p>
            {review.content && <p className="mt-2 whitespace-pre-wrap wrap-break-word text-gray-700">{review.content}</p>}
            {review.created_at && <p className="mt-2 text-xs text-gray-500">{formatDate(review.created_at)}</p>}
          </div> : <form onSubmit={event => submit(event, item.product_id)} className="space-y-3">
            <label className="block" htmlFor={`review-rating-${item.product_id}`}><span className="block mb-1 text-sm font-medium">{t('评分')}</span>
              <select id={`review-rating-${item.product_id}`} className="input max-w-xs" value={draft.rating} disabled={busy !== null} onChange={event => change(item.product_id, 'rating', event.target.value)}>
                {[5, 4, 3, 2, 1].map(rating => <option key={rating} value={rating}>{t('{rating}分', { rating })}</option>)}
              </select>
            </label>
            <label className="block" htmlFor={`review-content-${item.product_id}`}><span className="block mb-1 text-sm font-medium">{t('评价内容（可选）')}</span>
              <textarea id={`review-content-${item.product_id}`} className="input min-h-24" rows={3} maxLength={2000} value={draft.content} disabled={busy !== null} onChange={event => change(item.product_id, 'content', event.target.value)} />
            </label>
            <button type="submit" disabled={busy !== null} className="btn btn-primary disabled:opacity-50">{t(busy === item.product_id ? '提交中...' : '提交评价')}</button>
          </form>}
          {message?.error && <p role="alert" className="mt-3 text-sm text-red-600">{t(message.error)}</p>}
          {message?.success && <p role="status" className="mt-3 text-sm text-green-700">{t(message.success)}</p>}
        </div>;
      })}</div>}
    </section>
  );
}
