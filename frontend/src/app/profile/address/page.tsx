'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addressApi, type AddressInput, type ShippingAddress } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';

const fields = [
  { name: 'receiver_name', label: '收货人', max: 50 },
  { name: 'phone', label: '联系电话', max: 20 },
  { name: 'province', label: '省份', max: 50 },
  { name: 'city', label: '城市', max: 50 },
  { name: 'district', label: '区县', max: 50 },
  { name: 'detail_address', label: '详细地址', max: 200 },
] as const;
const emptyForm: AddressInput = { receiver_name: '', phone: '', province: '', city: '', district: '', detail_address: '', is_default: false };
const addressInput = (address: ShippingAddress): AddressInput => ({
  receiver_name: address.receiver_name ?? '', phone: address.phone ?? '', province: address.province ?? '',
  city: address.city ?? '', district: address.district ?? '', detail_address: address.detail_address ?? '',
  is_default: address.is_default === true || address.is_default === 1,
});

export default function AddressPage() {
  const router = useRouter();
  const { isHydrated, isAuthenticated, token, user } = useAuthStore();
  const [result, setResult] = useState<{ key: string; addresses: ShippingAddress[]; error?: string } | null>(null);
  const [form, setForm] = useState<AddressInput>(emptyForm);
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(true);
  const request = useRef(0);
  const mutation = useRef<string | null>(null);
  const sessionKey = JSON.stringify([token, user?.user_id]);
  const currentSession = useRef(sessionKey);
  currentSession.current = sessionKey;
  const addresses = result?.key === sessionKey ? result.addresses : [];
  const loading = result?.key !== sessionKey;
  const error = result?.key === sessionKey ? result.error : undefined;
  const isBusy = busy === sessionKey;
  const isCurrent = () => {
    const state = useAuthStore.getState();
    return mounted.current && currentSession.current === sessionKey && state.isAuthenticated &&
      state.token === token && state.user?.user_id === user?.user_id && localStorage.getItem('token') === (token ?? null);
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current += 1; };
  }, []);

  const loadAddresses = async () => {
    if (!isCurrent()) return;
    const revision = ++request.current;
    setResult(null);
    try {
      const data = await addressApi.list();
      if (isCurrent() && revision === request.current) setResult({ key: sessionKey, addresses: data.addresses || [] });
    } catch (error: any) {
      if (isCurrent() && revision === request.current) setResult({ key: sessionKey, addresses: [], error: error.response?.data?.error || '加载收货地址失败' });
    }
  };

  useEffect(() => {
    setResult(null);
    setEditing(undefined);
    setForm(emptyForm);
    setFormError('');
    setBusy(null);
    mutation.current = null;
    if (!isHydrated) return;
    if (!isAuthenticated) { router.push('/login'); return; }
    loadAddresses();
    return () => { request.current += 1; };
  }, [isHydrated, isAuthenticated, token, user?.user_id, router]);

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    if (!isCurrent() || mutation.current) return;
    mutation.current = sessionKey;
    setBusy(sessionKey);
    setFormError('');
    try {
      await operation();
      if (!isCurrent()) return;
      setEditing(undefined);
      toast.success(success);
      await loadAddresses();
    } catch (error: any) {
      if (!isCurrent()) return;
      const message = error.response?.data?.error || error.response?.data?.message || '地址操作失败，请重试';
      setFormError(message);
      toast.error(message);
    } finally {
      if (isCurrent()) { mutation.current = null; setBusy(null); }
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isCurrent() || mutation.current || editing === undefined) return;
    const payload: AddressInput = { ...emptyForm, is_default: !!form.is_default };
    for (const field of fields) {
      const value = form[field.name].trim();
      if (!value) { setFormError(`请填写${field.label}`); return; }
      if (value.length > field.max) { setFormError(`${field.label}最多 ${field.max} 个字符`); return; }
      payload[field.name] = value;
    }
    const digitCount = payload.phone.replace(/\D/g, '').length;
    if (!/^\+?[\d -]+$/.test(payload.phone) || digitCount < 7 || digitCount > 15) {
      setFormError('联系电话需包含 7 至 15 位数字，可使用 +、空格或连字符'); return;
    }
    await mutate(() => editing === null ? addressApi.create(payload) : addressApi.update(editing, payload), editing === null ? '地址已添加' : '地址已更新');
  };

  if (!isHydrated || !isAuthenticated || loading) return <div className="container-custom py-12 text-gray-600">收货地址加载中...</div>;

  return (
    <div className="container-custom py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold">收货地址</h1><p className="text-sm text-gray-600 mt-2">已保存 {addresses.length} / 20 个地址</p></div>
        <Link href="/cart" className="text-primary-600 underline">返回购物车</Link>
      </div>
      {error ? <div className="card p-6 text-red-600" role="alert"><p>{error}</p><button onClick={loadAddresses} className="underline mt-2">重新加载地址</button></div> : (
        <>
          <button disabled={isBusy || addresses.length >= 20} onClick={() => { if (!isCurrent()) return; setEditing(null); setForm({ ...emptyForm, is_default: addresses.length === 0 }); setFormError(''); }} className="btn btn-primary mb-6 disabled:opacity-50">新增地址</button>
          {addresses.length === 0 && <p className="text-gray-600 mb-6">暂无收货地址，请添加后再结算</p>}
          <div className="space-y-4">
            {addresses.map(address => <div key={address.address_id} className="card p-5">
              <p className="font-medium">{address.receiver_name} <span className="text-gray-600 ml-2">{address.phone}</span>
                {(address.is_default === true || address.is_default === 1) && <span className="ml-3 text-sm text-primary-600">默认地址</span>}
              </p>
              <p className="text-gray-600 mt-2">{address.province}{address.city}{address.district}{address.detail_address}</p>
              <div className="flex gap-4 mt-4 text-sm">
                <button disabled={isBusy} onClick={() => { if (!isCurrent()) return; setEditing(address.address_id); setForm(addressInput(address)); setFormError(''); }} className="text-primary-600">编辑</button>
                {!(address.is_default === true || address.is_default === 1) && <button disabled={isBusy} onClick={() => mutate(() => addressApi.update(address.address_id, { ...addressInput(address), is_default: true }), '默认地址已更新')} className="text-primary-600">设为默认</button>}
                <button disabled={isBusy} onClick={() => { if (isCurrent() && confirm('确定删除这个收货地址吗？')) return mutate(() => addressApi.remove(address.address_id), '地址已删除'); }} className="text-red-600">删除</button>
              </div>
            </div>)}
          </div>
          {editing !== undefined && <form onSubmit={handleSubmit} className="card p-6 mt-6 space-y-4">
            <h2 className="font-bold text-lg">{editing === null ? '新增收货地址' : '编辑收货地址'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fields.map(field => <label key={field.name} className={field.name === 'detail_address' ? 'md:col-span-2' : ''}>
                <span className="block mb-2 text-sm">{field.label}</span>
                <input name={field.name} required maxLength={field.max} inputMode={field.name === 'phone' ? 'tel' : undefined} value={form[field.name]} disabled={isBusy}
                  onChange={event => setForm(previous => ({ ...previous, [field.name]: event.target.value }))} className="w-full border rounded px-3 py-2" />
              </label>)}
            </div>
            <label className="flex gap-2 items-center"><input name="is_default" type="checkbox" checked={!!form.is_default} disabled={isBusy} onChange={event => setForm(previous => ({ ...previous, is_default: event.target.checked }))} />设为默认收货地址</label>
            {formError && <p role="alert" className="text-red-600 text-sm">{formError}</p>}
            <div className="flex gap-3"><button type="submit" disabled={isBusy} className="btn btn-primary">{isBusy ? '保存中...' : '保存地址'}</button><button type="button" disabled={isBusy} onClick={() => setEditing(undefined)} className="btn btn-outline">取消</button></div>
          </form>}
          {editing === undefined && formError && <p role="alert" className="text-red-600 mt-4">{formError}</p>}
        </>
      )}
    </div>
  );
}
