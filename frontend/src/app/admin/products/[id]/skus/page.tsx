'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AdminLayout from '@/components/AdminLayout';
import { adminSKUApi, type AdminSKUList, type AdminSKU } from '@/lib/api';
import { ADMIN_SESSION_EVENT, getAdminSessionToken } from '@/lib/admin-session';
import { useI18n } from '@/lib/i18n';
import { skuDraft, parseSKUForm, skuChanges, type SKUDraft } from '@/lib/sku-form';
import { requestFailure } from '@/lib/api-error';

type Editor = { key: string; id: number | null; draft: SKUDraft };

const validMoney = (value: unknown) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
  Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 99999999.99;

function validList(value: AdminSKUList, productId: number) {
  return value?.product?.product_id === productId && typeof value.product.title === 'string' && [0, 1].includes(value.product.status) &&
    Array.isArray(value.skus) && value.skus.every(sku => sku && sku.product_id === productId && Number.isSafeInteger(sku.sku_id) &&
      sku.sku_id > 0 && sku.sku_id <= 2147483647 && typeof sku.sku_code === 'string' && [0, 1].includes(sku.status) &&
      Number.isSafeInteger(sku.stock) && sku.stock >= 0 && sku.stock <= 2147483647 && validMoney(sku.price) &&
      (sku.original_price == null || validMoney(sku.original_price)) && (sku.image == null || typeof sku.image === 'string') &&
      sku.specs && typeof sku.specs === 'object' && !Array.isArray(sku.specs) && Object.entries(sku.specs).every(([name, spec]) =>
        name.length > 0 && name.length <= 50 && ((typeof spec === 'string' && spec.length > 0 && spec.length <= 100) ||
          (typeof spec === 'number' && Number.isFinite(spec)) || typeof spec === 'boolean')));
}

export default function AdminSKUPage() {
  const { t } = useI18n();
  const params = useParams() || {};
  const productId = typeof params.id === 'string' && /^[1-9]\d*$/.test(params.id) ? Number(params.id) : 0;
  const validId = Number.isSafeInteger(productId) && productId > 0 && productId <= 2147483647;
  const [token, setToken] = useState<string | null>(null);
  const key = JSON.stringify([token, productId]);
  const currentKey = useRef(key); currentKey.current = key;
  const mounted = useRef(true);
  const request = useRef(0);
  const [result, setResult] = useState<{ key: string; revision: number; data?: AdminSKUList; error?: string } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const mutation = useRef<object | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ key: string; error?: string; success?: string } | null>(null);
  const isCurrent = () => mounted.current && currentKey.current === key && !!token && getAdminSessionToken() === token;
  const displayed = isCurrent() && result?.key === key && result.revision === request.current;
  const data = displayed ? result.data : undefined;
  const busy = pendingKey === key;
  const isDisplayed = () => isCurrent() && result?.key === key && result.revision === request.current && !!result.data && !result.error;
  const replaceEditor = (next: Editor | null) => { editorRef.current = next; setEditor(next); };

  useEffect(() => {
    mounted.current = true;
    const sync = () => setToken(getAdminSessionToken());
    const onStorage = (event: StorageEvent) => {
      if ((event.storageArea === null || event.storageArea === localStorage) &&
        (event.key === null || event.key === 'admin_token' || event.key === 'admin_user')) sync();
    };
    sync(); window.addEventListener('storage', onStorage); window.addEventListener(ADMIN_SESSION_EVENT, sync);
    return () => { mounted.current = false; request.current++; window.removeEventListener('storage', onStorage); window.removeEventListener(ADMIN_SESSION_EVENT, sync); };
  }, []);

  const load = async (afterSave = false) => {
    if (!isCurrent() || !validId || (mutation.current && !afterSave)) return;
    const revision = ++request.current;
    setResult(null);
    try {
      const next = await adminSKUApi.list(productId);
      if (!isCurrent() || request.current !== revision) return;
      if (!validList(next, productId)) throw new Error();
      setResult({ key, revision, data: next });
    } catch (error) {
      if (isCurrent() && request.current === revision) setResult({ key, revision, error: afterSave ? '规格已保存，但列表刷新失败，请重新加载' : requestFailure(error).response?.data?.error || '获取SKU列表失败' });
    }
  };
  useEffect(() => {
    setResult(null); replaceEditor(null); mutation.current = null; setPendingKey(null); setNotice(null); load();
    return () => { request.current++; };
  }, [key]);

  const open = (sku?: AdminSKU) => {
    if (!isDisplayed() || mutation.current || editorRef.current || (sku && !data?.skus.some(row => row.sku_id === sku.sku_id))) return;
    replaceEditor({ key, id: sku?.sku_id ?? null, draft: skuDraft(sku) }); setNotice(null);
  };
  const change = (update: (draft: SKUDraft) => SKUDraft) => {
    const current = editorRef.current;
    if (!isDisplayed() || mutation.current || current?.key !== key) return;
    replaceEditor({ ...current, draft: update(current.draft) }); setNotice(null);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const current = editorRef.current;
    if (!isDisplayed() || mutation.current || current?.key !== key || (current.id !== null && !data?.skus.some(row => row.sku_id === current.id))) return;
    let payload;
    try { payload = parseSKUForm(current.draft); }
    catch (error) { setNotice({ key, error: (error as Error).message }); return; }
    const previous = data?.skus.find(row => row.sku_id === current.id);
    const changes = previous ? skuChanges(payload, previous) : null;
    if (changes && Object.keys(changes).length === 0) { setNotice({ key, success: '没有需要保存的修改' }); return; }
    const operation = {}; mutation.current = operation; setPendingKey(key); setNotice(null);
    const active = () => isCurrent() && mutation.current === operation;
    try {
      if (current.id === null) await adminSKUApi.create(productId, payload);
      else await adminSKUApi.update(productId, current.id, changes!);
      if (!active()) return;
      replaceEditor(null); setNotice({ key, success: '规格已保存' });
      await load(true);
    } catch (error) {
      if (active()) setNotice({ key, error: requestFailure(error).response?.data?.error || (current.id === null ? '创建SKU失败' : '更新SKU失败') });
    } finally {
      if (mutation.current === operation) { mutation.current = null; if (isCurrent()) setPendingKey(null); }
    }
  };

  const toggle = async (id: number) => {
    if (!isDisplayed() || mutation.current || editorRef.current) return;
    const sku = data?.skus.find(row => row.sku_id === id);
    if (!sku) return;
    const operation = {}; mutation.current = operation; setPendingKey(key); setNotice(null);
    const active = () => isCurrent() && mutation.current === operation;
    try {
      await adminSKUApi.update(productId, id, { status: sku.status === 1 ? 0 : 1 });
      if (!active()) return;
      setNotice({ key, success: sku.status === 1 ? '规格已停用' : '规格已启用' });
      await load(true);
    } catch (error) {
      if (active()) setNotice({ key, error: requestFailure(error).response?.data?.error || '更新SKU失败' });
    } finally {
      if (mutation.current === operation) { mutation.current = null; if (isCurrent()) setPendingKey(null); }
    }
  };

  const active = data?.skus.filter(sku => sku.status === 1) ?? [];
  return <AdminLayout><div className="space-y-6">
    <Link href="/admin/products" className="block w-fit text-primary-600 underline">{t('返回商品管理')}</Link>
    <div><h1 className="text-2xl font-bold text-gray-900">{t('SKU 管理')}</h1>{data && <p className="mt-2 text-gray-600">{data.product.title} · #{productId}</p>}</div>
    {notice?.key === key && isCurrent() && <div role={notice.error ? 'alert' : 'status'} className={notice.error ? 'text-red-600' : 'text-green-700'}>{t(notice.error || notice.success || '')}</div>}
    {!validId ? <p role="alert">{t('商品ID无效')}</p> : !displayed ? <p role="status">{t('加载中...')}</p> : result.error ? <div role="alert" className="bg-white rounded-lg p-6 shadow-sm"><p className="text-red-600">{t(result.error)}</p><button type="button" onClick={() => load()} className="btn btn-outline mt-3">{t('重新加载')}</button></div> : data && <>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
        {data.product.status === 0 && <p className="font-medium text-amber-800">{t('商品已下架，需上架商品后才能购买')}</p>}
        <p>{t(data.product.status === 1 ? '可售库存：{stock}' : '启用规格库存：{stock}', { stock: active.reduce((sum, sku) => sum + sku.stock, 0) })}</p>
        <p>{active.length ? t('最低售价：¥{price}', { price: Math.min(...active.map(sku => Number(sku.price))).toFixed(2) }) : t('暂无启用规格')}</p>
        <p className="text-sm text-gray-600">{t('添加首个规格后，购买使用规格价格和库存；全部停用后无法购买')}</p>
      </div>
      <button type="button" disabled={busy || !!editor} onClick={() => open()} className="btn btn-primary disabled:opacity-50">{t('新增规格')}</button>
      {editor?.key === key && <form onSubmit={save} className="bg-white p-6 rounded-lg shadow-sm space-y-5">
        <h2 className="font-bold text-lg">{t(editor.id === null ? '新增规格' : '编辑规格')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['sku_code', 'price', 'original_price', 'stock', 'image'] as const).map(name => {
            const labels = { sku_code: '规格编码', price: '售价', original_price: '原价（可选）', stock: '库存', image: '图片地址（可选）' };
            return <label key={name} htmlFor={`sku-${name}`} className="block"><span className="block mb-2 font-medium">{t(labels[name])}</span>
              <input id={`sku-${name}`} name={name} className="input" value={editor.draft[name]} disabled={busy} required={['sku_code', 'price', 'stock'].includes(name)} maxLength={name === 'sku_code' ? 50 : name === 'image' ? 255 : undefined} inputMode={name === 'stock' ? 'numeric' : ['price', 'original_price'].includes(name) ? 'decimal' : undefined} onChange={event => change(draft => ({ ...draft, [name]: event.target.value }))} />
            </label>;
          })}
          <label htmlFor="sku-status" className="block"><span className="block mb-2 font-medium">{t('状态')}</span><select id="sku-status" name="status" className="input" value={editor.draft.status} disabled={busy} onChange={event => change(draft => ({ ...draft, status: event.target.value }))}><option value="1">{t('已启用')}</option><option value="0">{t('已停用')}</option></select></label>
        </div>
        <fieldset disabled={busy} className="space-y-3"><legend className="font-medium mb-2">{t('规格属性')}</legend>
          {editor.draft.specs.map((row, index) => <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
            {(['name', 'value'] as const).map(field => <label key={field} htmlFor={`spec-${field}-${index}`} className="block"><span className="block text-sm mb-1">{t(field === 'name' ? '规格名称 {index}' : '规格值 {index}', { index: index + 1 })}</span>
              <input id={`spec-${field}-${index}`} name={`spec-${field}-${index}`} className="input" value={row[field]} required maxLength={field === 'name' ? 50 : 100} disabled={busy} onChange={event => change(draft => ({ ...draft, specs: draft.specs.map((value, position) => position === index ? { ...value, [field]: event.target.value } : value) }))} />
            </label>)}
            <button type="button" disabled={busy} className="btn btn-outline" aria-label={t('移除规格属性 {index}', { index: index + 1 })} onClick={() => change(draft => ({ ...draft, specs: draft.specs.filter((_, position) => position !== index) }))}>{t('移除')}</button>
          </div>)}
          <button type="button" disabled={busy || editor.draft.specs.length >= 20} className="btn btn-outline" onClick={() => change(draft => ({ ...draft, specs: [...draft.specs, { name: '', value: '' }] }))}>{t('添加规格属性')}</button>
        </fieldset>
        <p className="text-sm text-gray-500">{t('原价和图片地址留空可清除；规格名称不可重复，最多20项')}</p>
        <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy} className="btn btn-primary disabled:opacity-50">{t(busy ? '保存中...' : '保存规格')}</button><button type="button" disabled={busy} className="btn btn-outline" onClick={() => { if (isDisplayed() && !mutation.current) { replaceEditor(null); setNotice(null); } }}>{t('取消')}</button></div>
      </form>}
      {!data.skus.length ? <p className="bg-white p-6 rounded-lg shadow-sm">{t('暂无规格')}</p> : <div className="grid gap-4 xl:grid-cols-2">{data.skus.map(sku => <article key={sku.sku_id} className="bg-white rounded-lg shadow-sm p-5 space-y-3">
        <div className="flex justify-between gap-3"><h2 className="font-semibold break-all">{sku.sku_code}</h2><span className={sku.status === 1 ? 'text-green-700' : 'text-gray-500'}>{t(sku.status === 1 ? '已启用' : '已停用')}</span></div>
        <p className="text-sm text-gray-600 wrap-break-word">{Object.entries(sku.specs).map(([name, value]) => `${name}: ${value}`).join(' / ') || '—'}</p>
        <p>{t('售价')}：¥{Number(sku.price).toFixed(2)} · {t('库存')}：{sku.stock}</p>
        <div className="flex gap-4 flex-wrap"><button type="button" disabled={busy || !!editor} onClick={() => open(sku)} className="text-primary-600 disabled:opacity-50">{t('编辑规格')}</button>
          <button type="button" disabled={busy || !!editor} onClick={() => toggle(sku.sku_id)} className="text-primary-600 disabled:opacity-50">{t(sku.status === 1 ? '停用规格' : '启用规格')}</button></div>
      </article>)}</div>}
    </>}
  </div></AdminLayout>;
}
