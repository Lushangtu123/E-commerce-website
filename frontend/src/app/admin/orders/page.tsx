'use client';

import { useEffect, useRef, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import api from '@/lib/api';
import { useAdminSession } from '@/hooks/use-admin-session';
import { useI18n } from '@/lib/i18n';
import toast from 'react-hot-toast';

const NEXT_STATUS: Record<number, { status: number; text: string }> = { 0: { status: 4, text: '取消订单' }, 1: { status: 2, text: '发货' }, 2: { status: 3, text: '完成订单' } };
const STATUS = ['待支付', '已支付', '已发货', '已完成', '已取消'];

export default function AdminOrdersPage() {
  const { t, formatDate } = useI18n(), session = useAdminSession();
  const [page, setPage] = useState(1), [filters, setFilters] = useState({ orderNo: '', status: '' });
  const [result, setResult] = useState<{ key: string; orders: any[]; total: number; error?: string } | null>(null);
  const [shipment, setShipment] = useState<{ key: string; id: number; company: string; tracking: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0), mutation = useRef<object | null>(null), latestLoad = useRef<(() => Promise<void>) | null>(null);
  const key = JSON.stringify([session.token, page, filters]);
  const currentKey = useRef(key); currentKey.current = key;
  const active = () => session.active() && currentKey.current === key;
  const visible = result?.key === key && session.active() ? result : null;
  const loading = !visible, orders = visible?.orders ?? [], total = visible?.total ?? 0;
  const fetchOrders = async () => {
    if (!active()) return;
    const revision = ++request.current; setResult(null);
    try {
      const data: any = await api.get('/admin/orders', { params: { page, limit: 20, ...(filters.orderNo && { orderNo: filters.orderNo }), ...(filters.status !== '' && { status: filters.status }) } });
      if (!active() || revision !== request.current) return;
      const total = Number(data.pagination?.total) || 0;
      if (page > Math.max(1, Math.ceil(total / 20))) { setPage(Math.max(1, Math.ceil(total / 20))); return; }
      setResult({ key, orders: data.orders || [], total });
    } catch (error: any) {
      if (active() && revision === request.current) setResult({ key, orders: [], total: 0, error: error.response?.data?.error || '获取订单列表失败' });
    }
  };
  latestLoad.current = fetchOrders;
  useEffect(() => { setPage(1); setFilters({ orderNo: '', status: '' }); setShipment(null); mutation.current = null; setBusy(false); }, [session.token]);
  useEffect(() => { setShipment(null); fetchOrders(); return () => { request.current++; }; }, [key]);
  const changeFilters = (next: typeof filters) => { currentKey.current = ''; setFilters(next); setPage(1); setShipment(null); };
  const handleUpdate = async (id: number, status: number) => {
    if (!active() || mutation.current || loading || visible?.error) return;
    const order = orders.find(value => value.order_id === id);
    if (!order || NEXT_STATUS[order.status]?.status !== status) return;
    if (status === 2 && (shipment?.key !== key || shipment.id !== id)) { setShipment({ key, id, company: '', tracking: '' }); return; }
    const company = shipment?.company.trim() || '', tracking = shipment?.tracking.trim() || '';
    if (status === 2 && (!company || company.length > 60 || !tracking || tracking.length > 100 || /[\x00-\x1f\x7f]/.test(company + tracking))) { toast.error(t('请填写有效的快递公司和运单号')); return; }
    if (status === 4 && !confirm(t('确定要取消订单吗？'))) return;
    if (!active() || mutation.current) return;
    const operation = {}; mutation.current = operation; setBusy(true);
    try {
      await api.put(`/admin/orders/${id}/status`, { status, ...(status === 2 && { shipping_company: company, tracking_number: tracking }) });
      if (!session.active() || mutation.current !== operation) return;
      if (active()) { toast.success(t('订单状态已更新')); setShipment(null); }
      await latestLoad.current?.();
    } catch (error: any) { if (active() && mutation.current === operation) toast.error(t(error.response?.data?.error || '更新订单状态失败')); }
    finally { if (session.active() && mutation.current === operation) { mutation.current = null; setBusy(false); } }
  };
  return <AdminLayout><div className="space-y-6">
    <div><h1 className="text-2xl font-bold">{t('订单管理')}</h1><p className="text-gray-600 mt-1">{t('查看和管理所有订单')}</p></div>
    <div className="card p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
      <input className="input" type="text" aria-label={t('订单号')} placeholder={t('搜索订单号...')} value={filters.orderNo} onChange={event => changeFilters({ ...filters, orderNo: event.target.value })} />
      <select className="input" value={filters.status} aria-label={t('订单状态')} onChange={event => changeFilters({ ...filters, status: event.target.value })}><option value="">{t('全部状态')}</option>{STATUS.map((label, index) => <option key={index} value={String(index)}>{t(label)}</option>)}</select>
      <button className="btn btn-secondary" onClick={fetchOrders}>{t('搜索')}</button><button className="btn btn-secondary" onClick={() => changeFilters({ orderNo: '', status: '' })}>{t('重置')}</button>
    </div>
    {shipment?.key === key && active() && <form className="card p-6 space-y-4" onSubmit={event => { event.preventDefault(); void handleUpdate(shipment.id, 2); }}>
      <h2 className="font-bold text-lg">{t('填写发货信息')}</h2>
      <label className="block"><span className="block mb-2">{t('快递公司')}</span><input className="input" name="shipping_company" value={shipment.company} maxLength={60} required disabled={busy} onChange={event => { if (active() && !mutation.current) setShipment({ ...shipment, company: event.target.value }); }} /></label>
      <label className="block"><span className="block mb-2">{t('运单号')}</span><input className="input" name="tracking_number" value={shipment.tracking} maxLength={100} required disabled={busy} onChange={event => { if (active() && !mutation.current) setShipment({ ...shipment, tracking: event.target.value }); }} /></label>
      <div className="flex gap-3"><button className="btn btn-primary" disabled={busy}>{t('确认发货')}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { if (active() && !mutation.current) setShipment(null); }}>{t('取消')}</button></div>
    </form>}
    <div className="card overflow-x-auto">
      {loading ? <p className="p-8" role="status">{t('加载中...')}</p> : visible.error ? <div className="p-6" role="alert"><p className="text-red-600">{t(visible.error)}</p><button onClick={fetchOrders} className="btn btn-secondary mt-4">{t('重新加载')}</button></div> : <>
        <table className="w-full"><thead className="bg-gray-50"><tr>{['订单号', '用户', '收货信息', '物流信息', '金额', '商品数量', '状态', '下单时间', '操作'].map(label => <th key={label} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{t(label)}</th>)}</tr></thead>
        <tbody>{orders.map(order => <tr key={order.order_id} className="border-t">
          <td className="p-4 text-sm">{order.order_no}{order.payment_method === 'demo' && <p className="text-xs text-amber-800 mt-1">{t('演示订单，未实际扣款')}</p>}</td><td className="p-4 text-sm">{order.username || t('未知用户')}</td>
          <td className="p-4 text-sm min-w-[16rem]">{order.shipping_address_snapshot ? <><p>{order.shipping_address_snapshot.receiver_name} {order.shipping_address_snapshot.phone}</p><p>{order.shipping_address_snapshot.province}{order.shipping_address_snapshot.city}{order.shipping_address_snapshot.district}{order.shipping_address_snapshot.detail_address}</p></> : t('历史订单未记录收货信息')}</td>
          <td className="p-4 text-sm">{order.shipping_company && order.tracking_number ? <><p>{order.shipping_company}</p><p className="font-mono break-all">{order.tracking_number}</p></> : '—'}</td>
          <td className="p-4 text-sm font-semibold">¥{Number(order.total_amount || 0).toFixed(2)}</td><td className="p-4 text-sm">{order.item_count || 0}</td>
          <td className="p-4"><span className="rounded-full bg-blue-50 px-2 py-1 text-xs">{t(STATUS[order.status] || '未知状态')}</span></td><td className="p-4 text-sm">{formatDate(order.created_at)}</td>
          <td className="p-4 text-sm">{NEXT_STATUS[order.status] && <button className="text-blue-600 disabled:opacity-50" disabled={busy} onClick={() => handleUpdate(order.order_id, NEXT_STATUS[order.status].status)}>{t(NEXT_STATUS[order.status].text)}</button>}</td>
        </tr>)}</tbody></table>
        {orders.length === 0 && <p className="p-6 text-gray-500">{t('暂无订单')}</p>}
        <div className="p-4 border-t flex justify-between items-center"><p>{t('共 {count} 个订单', { count: total })}</p><div className="flex gap-3"><button className="btn btn-secondary" disabled={page <= 1} onClick={() => { currentKey.current = ''; setPage(page - 1); }}>{t('上一页')}</button><span>{t('第 {page} 页', { page })}</span><button className="btn btn-secondary" disabled={page >= Math.ceil(total / 20)} onClick={() => { currentKey.current = ''; setPage(page + 1); }}>{t('下一页')}</button></div></div>
      </>}
    </div>
  </div></AdminLayout>;
}
