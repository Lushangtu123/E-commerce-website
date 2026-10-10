'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addressApi, type AddressInput, type ShippingAddress } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { translate, useI18n } from '@/lib/i18n';
import { requestFailure } from '@/lib/api-error';
import { useSessionQuery } from '@/hooks/use-session-query';
import { confirmAction } from '@/lib/confirm';
import { useQueryClient } from '@tanstack/react-query';
import { clearPendingAddressCreation, readPendingAddressCreation, storePendingAddressCreation, type PendingAddressCreation } from '@/lib/pending-address-creation';

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
interface CapacityRecovery {
  sessionKey: string;
  attempt: PendingAddressCreation;
  /** Only IDs from an explicit, validated canonical GET can be selected for deletion. */
  deletableIds: number[] | null;
}

async function readAddresses(): Promise<{ addresses: ShippingAddress[] }> {
  const result = await addressApi.list();
  if (!result || !Array.isArray(result.addresses) || result.addresses.some(address =>
    !address || !Number.isSafeInteger(address.address_id) || address.address_id <= 0 ||
    typeof address.receiver_name !== 'string' || typeof address.phone !== 'string' ||
    ![true, false, 0, 1].includes(address.is_default as boolean | number) ||
    ['province', 'city', 'district', 'detail_address'].some(name => {
      const value = address[name as keyof ShippingAddress];
      return value !== null && typeof value !== 'string';
    }))) throw new Error('Invalid address list');
  return result;
}

export default function AddressPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { isHydrated, isAuthenticated, sessionId, user } = useAuthStore();
  const [form, setForm] = useState<AddressInput>(emptyForm);
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [formError, setFormError] = useState<string | { key: string; field: string; max?: number }>('');
  const formErrorText = typeof formError === 'string' ? t(formError) : t(formError.key, { field: t(formError.field), max: formError.max ?? 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const mutation = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const sessionKey = JSON.stringify([sessionId, user?.user_id]);
  const recoveryLock = useRef({ sessionKey, creation: false, verification: false, storage: true });
  const [pendingState, setPendingState] = useState<{ sessionKey: string; attempt: PendingAddressCreation | null }>();
  const [storageReady, setStorageReady] = useState<string>();
  const [storageError, setStorageError] = useState<string>();
  const [verification, setVerification] = useState<string>();
  const capacityRef = useRef<CapacityRecovery | null>(null);
  const [capacityState, setCapacityState] = useState<CapacityRecovery | null>(null);
  const query = useSessionQuery({ name: 'addresses', params: [], load: readAddresses });
  const { isCurrentSession: isCurrent } = query;
  const addresses = query.data?.addresses || [];
  const error = query.error ? requestFailure(query.error).response?.data?.error || '加载收货地址失败' : undefined;
  const loading = !query.data && !error;
  const isBusy = busy === sessionKey;
  const pending = pendingState?.sessionKey === sessionKey ? pendingState.attempt : null;
  const capacity = capacityState?.sessionKey === sessionKey && capacityState.attempt.key === pending?.key ? capacityState : null;
  const needsVerification = verification === sessionKey;
  const hasStorageError = storageError === sessionKey;
  const writeLocked = isBusy || !!pending || needsVerification || hasStorageError || storageReady !== sessionKey;
  const blocksWrite = () => recoveryLock.current.sessionKey === sessionKey &&
    (recoveryLock.current.creation || recoveryLock.current.verification || recoveryLock.current.storage);
  const lockRecovery = (kind: 'creation' | 'verification' | 'storage', locked: boolean) => {
    if (recoveryLock.current.sessionKey !== sessionKey) recoveryLock.current = { sessionKey, creation: false, verification: false, storage: true };
    recoveryLock.current[kind] = locked;
  };
  const setCapacity = (value: CapacityRecovery | null) => { capacityRef.current = value; setCapacityState(value); };

  const loadPending = () => {
    if (!isCurrent() || !sessionId || !user) return;
    setCapacity(null);
    try {
      const attempt = readPendingAddressCreation(sessionId, user.user_id);
      lockRecovery('creation', !!attempt); lockRecovery('storage', false);
      setPendingState({ sessionKey, attempt });
      setStorageError(undefined);
      if (attempt) { setEditing(null); setForm(attempt.input); }
    } catch { lockRecovery('storage', true); setStorageError(sessionKey); }
    setStorageReady(sessionKey);
  };

  // An open form and a pending action belong to the account that started them.
  useEffect(() => {
    setEditing(undefined);
    setForm(emptyForm);
    setFormError('');
    setBusy(null);
    mutation.current = null;
    recoveryLock.current = { sessionKey, creation: false, verification: false, storage: true };
    setVerification(undefined);
    loadPending();
    // These values are owned by the identity in sessionKey; loading storage never sends a POST.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  useEffect(() => {
    if (isHydrated && !isAuthenticated) router.push('/login');
  }, [isHydrated, isAuthenticated, router]);

  const refreshCanonical = async () => {
    const queryKey = ['addresses', sessionId, user?.user_id];
    // A previously started query must not later replace this read with its older snapshot.
    await queryClient.cancelQueries({ queryKey, exact: true });
    if (!isCurrent()) return false;
    const data = await readAddresses();
    if (!isCurrent()) return false;
    queryClient.setQueryData(queryKey, data);
    return data;
  };

  const confirmCapacity = (data: { addresses: ShippingAddress[] }) => {
    const current = capacityRef.current;
    if (!current || current.sessionKey !== sessionKey || !isCurrent()) return;
    setCapacity({ ...current, deletableIds: data.addresses.length >= 20 ? data.addresses.map(address => address.address_id) : [] });
    setFormError('');
  };

  const reloadAddresses = async () => {
    if (!isCurrent() || mutation.current) return;
    await query.refetch();
  };

  const verify = async () => {
    if (!isCurrent() || mutation.current || !needsVerification || recoveryLock.current.sessionKey !== sessionKey || !recoveryLock.current.verification) return;
    mutation.current = sessionKey; setBusy(sessionKey);
    try {
      const data = await refreshCanonical();
      if (data) {
        lockRecovery('verification', false);
        setVerification(undefined);
        if (capacityRef.current?.sessionKey === sessionKey) confirmCapacity(data);
        else setFormError('已重新核对最新地址，请确认操作结果');
      }
    } catch {
      if (isCurrent()) setFormError('地址结果尚未确认，请重新核对地址');
    } finally {
      if (isCurrent()) { mutation.current = null; setBusy(null); }
    }
  };

  const canDeleteForCapacity = (addressId: number) => {
    const current = capacityRef.current;
    const locks = recoveryLock.current;
    return isCurrent() && !mutation.current && current?.sessionKey === sessionKey &&
      !!current.deletableIds?.includes(addressId) && locks.sessionKey === sessionKey &&
      locks.creation && !locks.verification && !locks.storage;
  };

  const deleteForCapacity = async (addressId: number) => {
    if (!canDeleteForCapacity(addressId) || !sessionId || !user) return;
    const permission = capacityRef.current!;
    if (!await confirmAction(t('确定删除这个收货地址吗？')) || !canDeleteForCapacity(addressId) || capacityRef.current !== permission) return;
    try {
      const stored = readPendingAddressCreation(sessionId, user.user_id);
      if (!stored || stored.key !== permission.attempt.key || JSON.stringify(stored.input) !== JSON.stringify(permission.attempt.input)) throw new Error('Changed address recovery');
    } catch {
      lockRecovery('storage', true); setStorageError(sessionKey); return;
    }
    mutation.current = sessionKey; setBusy(sessionKey); setFormError('');
    setCapacity({ ...permission, deletableIds: null });
    lockRecovery('verification', true); setVerification(sessionKey);
    let completed = false;
    try {
      try {
        await addressApi.remove(addressId);
        if (!isCurrent()) return;
        completed = true;
      } catch { if (!isCurrent()) return; }
      // Whether DELETE succeeded, failed, or lost its reply, only a fresh GET can reopen this limited path.
      const data = await refreshCanonical();
      if (!data) return;
      lockRecovery('verification', false); setVerification(undefined);
      confirmCapacity(data);
      if (completed && !data.addresses.some(address => address.address_id === addressId)) toast.success(translate('地址已删除'));
    } catch {
      if (isCurrent()) setFormError('地址结果尚未确认，请重新核对地址');
    } finally {
      if (isCurrent()) { mutation.current = null; setBusy(null); }
    }
  };

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    if (!isCurrent() || mutation.current || writeLocked || blocksWrite()) return;
    mutation.current = sessionKey;
    setBusy(sessionKey);
    setFormError('');
    let completed = false;
    try {
      await operation();
      if (!isCurrent()) return;
      completed = true;
      lockRecovery('verification', true);
      setVerification(sessionKey);
      if (await refreshCanonical()) {
        lockRecovery('verification', false);
        setVerification(undefined);
        setEditing(undefined);
        toast.success(translate(success));
      }
    } catch (error) {
      if (!isCurrent()) return;
      const failure = requestFailure(error);
      const message = failure.response?.data?.error || failure.response?.data?.message || '地址操作失败，请重试';
      if (!completed && failure.response?.status === 400) {
        setFormError(message); toast.error(translate(message));
      } else {
        lockRecovery('verification', true);
        setVerification(sessionKey);
        setFormError('地址结果尚未确认，请重新核对地址');
        if (!completed) {
          try {
            if (await refreshCanonical()) {
              lockRecovery('verification', false);
              setVerification(undefined);
              setFormError('已重新核对最新地址，请确认操作结果');
            }
          } catch { /* Keep the write lock until an explicit canonical GET succeeds. */ }
        }
      }
    } finally {
      if (isCurrent()) { mutation.current = null; setBusy(null); }
    }
  };

  const createAddress = async (attempt: PendingAddressCreation) => {
    if (!isCurrent() || mutation.current || !sessionId || !user || needsVerification || hasStorageError) return;
    if (recoveryLock.current.sessionKey === sessionKey && (recoveryLock.current.verification || recoveryLock.current.storage)) return;
    if (!attempt.uncertain && blocksWrite()) return;
    if (attempt.uncertain) {
      try {
        const stored = readPendingAddressCreation(sessionId, user.user_id);
        if (!stored || stored.key !== attempt.key || JSON.stringify(stored.input) !== JSON.stringify(attempt.input)) return;
      } catch {
        lockRecovery('storage', true); setStorageError(sessionKey); return;
      }
    }
    mutation.current = sessionKey; setBusy(sessionKey); setFormError('');
    setCapacity(null);
    lockRecovery('creation', true);
    let confirmed = false;
    const sent = { ...attempt, uncertain: true };
    try {
      if (!storePendingAddressCreation(sessionId, user.user_id, sent)) {
        lockRecovery('storage', true);
        setStorageError(sessionKey); setFormError('无法保存地址恢复信息，请重新读取后再试'); return;
      }
      setPendingState({ sessionKey, attempt: sent });
      const result = await addressApi.create({ ...attempt.input, create_key: attempt.key });
      if (!isCurrent()) return;
      if (!result || !Number.isSafeInteger(result.address_id) || result.address_id <= 0 ||
        !['created', 'replayed', 'deleted'].includes(result.creation_status)) throw new Error('Invalid address creation receipt');
      confirmed = true;
      if (!await refreshCanonical()) return;
      if (!clearPendingAddressCreation(sessionId, user.user_id, attempt.key)) {
        lockRecovery('storage', true);
        setStorageError(sessionKey); setFormError('无法保存地址恢复信息，请重新读取后再试'); return;
      }
      lockRecovery('creation', false);
      setPendingState({ sessionKey, attempt: null }); setEditing(undefined);
      if (result.creation_status === 'deleted') setFormError('原新增地址已删除，可重新添加地址');
      else toast.success(translate('地址已添加'));
    } catch (error) {
      if (!isCurrent()) return;
      const failure = requestFailure(error);
      if (!confirmed && attempt.uncertain && failure.response?.status === 400 && failure.response.data?.code === 'ADDRESS_CAPACITY_REACHED') {
        setCapacity({ sessionKey, attempt: sent, deletableIds: null });
        lockRecovery('verification', true); setVerification(sessionKey);
        try {
          const data = await refreshCanonical();
          if (data) {
            lockRecovery('verification', false); setVerification(undefined); confirmCapacity(data);
          }
        } catch {
          if (isCurrent()) setFormError('地址结果尚未确认，请重新核对地址');
        }
      } else if (!confirmed && !attempt.uncertain && failure.response?.status === 400 &&
        clearPendingAddressCreation(sessionId, user.user_id, attempt.key)) {
        lockRecovery('creation', false);
        setPendingState({ sessionKey, attempt: null });
        const message = failure.response.data?.error || '地址字段无效，请修改后重试';
        setFormError(message); toast.error(translate(message));
      } else setFormError('新增地址结果尚未确认，请恢复原请求');
    } finally {
      if (isCurrent()) { mutation.current = null; setBusy(null); }
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isCurrent() || mutation.current || writeLocked || blocksWrite() || editing === undefined) return;
    const payload: AddressInput = { ...emptyForm, is_default: !!form.is_default };
    for (const field of fields) {
      const value = form[field.name].trim();
      if (!value) { setFormError({ key: '请填写{field}', field: field.label }); return; }
      if (value.length > field.max) { setFormError({ key: '{field}最多 {max} 个字符', field: field.label, max: field.max }); return; }
      payload[field.name] = value;
    }
    const digitCount = payload.phone.replace(/\D/g, '').length;
    if (!/^\+?[\d -]+$/.test(payload.phone) || digitCount < 7 || digitCount > 15) {
      setFormError('联系电话需包含 7 至 15 位数字，可使用 +、空格或连字符'); return;
    }
    if (editing === null) {
      if (typeof crypto.randomUUID !== 'function') { setFormError('无法生成地址请求号，请刷新后再试'); return; }
      await createAddress({ key: crypto.randomUUID(), input: payload, uncertain: false });
    } else await mutate(() => addressApi.update(editing, payload), '地址已更新');
  };

  if (!isHydrated || !isAuthenticated || loading) return <div className="container-custom py-12 text-gray-600">{t("收货地址加载中...")}</div>;

  return (
    <div className="container-custom py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold">{t("收货地址")}</h1><p className="text-sm text-gray-600 mt-2">{t('已保存 {count} / 20 个地址', { count: addresses.length })}</p></div>
        <Link href="/cart" className="text-primary-600 underline">{t("返回购物车")}</Link>
      </div>
      {hasStorageError && <div className="card p-6 text-red-600" role="alert"><p>{t('无法读取地址恢复信息，请重新读取后再试')}</p><button disabled={isBusy} onClick={loadPending} className="underline mt-2">{t('重新读取新增地址')}</button></div>}
      {pending && <div className="card p-6 mb-4"><p>{t('存在待确认的新增地址，请恢复原请求')}</p>
        {capacity?.deletableIds && !needsVerification && <p className="mt-2 text-amber-700" role="status">{t(capacity.deletableIds.length
          ? '地址已满，请选择删除一个旧地址，再恢复原新增请求'
          : '已释放地址空间，请恢复原新增请求')}</p>}
        <button disabled={isBusy || hasStorageError || needsVerification} onClick={() => createAddress(pending)} className="btn btn-primary mt-2">{t('恢复新增地址')}</button></div>}
      {needsVerification && <div className="card p-6 mb-4"><p>{t('地址结果尚未确认，请重新核对地址')}</p><button disabled={isBusy} onClick={verify} className="btn btn-primary mt-2">{t('重新核对地址')}</button></div>}
      {error && !needsVerification ? <div className="card p-6 text-red-600" role="alert"><p>{t(error)}</p><button disabled={isBusy} onClick={reloadAddresses} className="underline mt-2">{t("重新加载地址")}</button></div> : (
        <>
          <button disabled={writeLocked || addresses.length >= 20} onClick={() => { if (!isCurrent() || writeLocked || blocksWrite()) return; setEditing(null); setForm({ ...emptyForm, is_default: addresses.length === 0 }); setFormError(''); }} className="btn btn-primary mb-6 disabled:opacity-50">{t("新增地址")}</button>
          {addresses.length === 0 && <p className="text-gray-600 mb-6">{t("暂无收货地址，请添加后再结算")}</p>}
          <div className="space-y-4">
            {addresses.map(address => <div key={address.address_id} className="card p-5">
              <p className="font-medium">{address.receiver_name} <span className="text-gray-600 ml-2">{address.phone}</span>
                {(address.is_default === true || address.is_default === 1) && <span className="ml-3 text-sm text-primary-600">{t("默认地址")}</span>}
              </p>
              <p className="text-gray-600 mt-2">{address.province}{address.city}{address.district}{address.detail_address}</p>
              <div className="flex gap-4 mt-4 text-sm">
                <button disabled={writeLocked} onClick={() => { if (!isCurrent() || writeLocked || blocksWrite()) return; setEditing(address.address_id); setForm(addressInput(address)); setFormError(''); }} className="text-primary-600">{t("编辑")}</button>
                {!(address.is_default === true || address.is_default === 1) && <button disabled={writeLocked} onClick={() => mutate(() => addressApi.setDefault(address.address_id), '默认地址已更新')} className="text-primary-600">{t("设为默认")}</button>}
                <button disabled={writeLocked && !(capacity?.deletableIds?.includes(address.address_id) && !isBusy && !needsVerification && !hasStorageError)} onClick={async () => {
                  if (canDeleteForCapacity(address.address_id)) return deleteForCapacity(address.address_id);
                  if (isCurrent() && !writeLocked && !blocksWrite() && await confirmAction(t('确定删除这个收货地址吗？'))) return mutate(() => addressApi.remove(address.address_id), '地址已删除');
                }} className="text-red-600">{t("删除")}</button>
              </div>
            </div>)}
          </div>
          {editing !== undefined && <form onSubmit={handleSubmit} className="card p-6 mt-6 space-y-4">
            <h2 className="font-bold text-lg">{editing === null ? t('新增收货地址') : t('编辑收货地址')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fields.map(field => <label key={field.name} className={field.name === 'detail_address' ? 'md:col-span-2' : ''}>
                <span className="block mb-2 text-sm">{t(field.label)}</span>
                <input name={field.name} required maxLength={field.max} inputMode={field.name === 'phone' ? 'tel' : undefined} value={form[field.name]} disabled={writeLocked}
                  onChange={event => { if (isCurrent() && !mutation.current && !blocksWrite()) setForm(previous => ({ ...previous, [field.name]: event.target.value })); }} className="w-full border rounded-sm px-3 py-2" />
              </label>)}
            </div>
            <label className="flex gap-2 items-center"><input name="is_default" type="checkbox" checked={!!form.is_default} disabled={writeLocked} onChange={event => { if (isCurrent() && !mutation.current && !blocksWrite()) setForm(previous => ({ ...previous, is_default: event.target.checked })); }} />{t("设为默认收货地址")}</label>
            {formError && <p role="alert" className="text-red-600 text-sm">{formErrorText}</p>}
            <div className="flex gap-3"><button type="submit" disabled={writeLocked} className="btn btn-primary">{isBusy ? t('保存中...') : t('保存地址')}</button><button type="button" disabled={writeLocked} onClick={() => { if (isCurrent() && !mutation.current && !blocksWrite()) setEditing(undefined); }} className="btn btn-outline">{t("取消")}</button></div>
          </form>}
          {editing === undefined && formError && <p role="alert" className="text-red-600 mt-4">{formErrorText}</p>}
        </>
      )}
    </div>
  );
}
