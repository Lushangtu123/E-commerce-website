'use client';

import '@/lib/admin-i18n';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AdminLayout from '@/components/AdminLayout';
import { useAdminQuery, useAdminSessionId } from '@/hooks/use-admin-query';
import { adminUserApi, type RecentOrder } from '@/lib/api/admin';
import { adminUserId, validAdminUserDetail, validAdminUserOrders } from '@/lib/admin-user-read';
import { requestFailure } from '@/lib/api-error';
import { useI18n } from '@/lib/i18n';
import { logger } from '@/lib/logger';

const orderStatuses = ['待付款', '待发货', '待收货', '已完成', '已取消'];

function OrdersTable({ orders, label, counts = false }: { orders: (RecentOrder & { item_count?: number })[]; label: string; counts?: boolean }) {
  const { t, formatDate } = useI18n();
  return (
    <div className="overflow-x-auto">
      <table aria-label={t(label)} className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th scope="col" className="px-5 py-3">{t('订单号')}</th>
            <th scope="col" className="px-5 py-3">{t('订单金额')}</th>
            {counts && <th scope="col" className="px-5 py-3">{t('商品数量')}</th>}
            <th scope="col" className="px-5 py-3">{t('状态')}</th>
            <th scope="col" className="px-5 py-3">{t('创建时间')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {orders.map(order => (
            <tr key={order.order_id}>
              <td className="px-5 py-4 font-medium text-gray-900">{order.order_no}</td>
              <td className="px-5 py-4">¥{Number(order.total_amount).toFixed(2)}</td>
              {counts && <td className="px-5 py-4">{order.item_count ?? '—'}</td>}
              <td className="px-5 py-4">{t(orderStatuses[order.status])}</td>
              <td className="px-5 py-4 whitespace-nowrap">{formatDate(order.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function readError(error: unknown, fallback: string, invalid: string, forbidden: string) {
  const failure = requestFailure(error);
  if (failure.response?.status === 403) return forbidden;
  if (failure.response?.status === 404) return '用户不存在';
  return failure.response?.data?.error || (failure.message === invalid ? invalid : fallback);
}

export default function AdminUserDetailPage() {
  const { t, formatDate } = useI18n();
  const params = useParams<{ id: string | string[] }>();
  const userId = adminUserId(params?.id);
  const sessionId = useAdminSessionId();
  const detailKey = JSON.stringify([sessionId, userId]);
  const currentDetail = useRef(detailKey);
  currentDetail.current = detailKey;
  const [view, setView] = useState({ key: detailKey, page: 1 });
  const page = view.key === detailKey ? view.page : 1;
  const orderKey = JSON.stringify([detailKey, page]);
  const currentOrders = useRef(orderKey);
  currentOrders.current = orderKey;
  const detailQuery = useAdminQuery({
    name: 'user-detail', params: [userId], enabled: userId !== null,
    load: async () => {
      const result = await adminUserApi.detail(userId!);
      if (!validAdminUserDetail(result, userId!)) throw new Error('用户详情数据无效，请重新加载');
      return result;
    },
  });
  const ordersQuery = useAdminQuery({
    name: 'user-orders', params: [userId, page], enabled: userId !== null && detailQuery.data !== undefined,
    load: async () => {
      const result = await adminUserApi.orders(userId!, page);
      if (!validAdminUserOrders(result, userId!, page)) throw new Error('用户订单数据无效，请重新加载');
      return result;
    },
  });
  const isCurrentDetail = () => detailQuery.isCurrentSession() && currentDetail.current === detailKey;
  const isCurrentOrders = () => isCurrentDetail() && ordersQuery.isCurrentSession() && currentOrders.current === orderKey;
  const reloadDetail = () => { if (isCurrentDetail()) void detailQuery.refetch(); };
  const reloadOrders = () => { if (isCurrentOrders()) void ordersQuery.refetch(); };
  const detailError = detailQuery.error ? readError(detailQuery.error, '获取用户详情失败', '用户详情数据无效，请重新加载', '无权查看用户详情') : null;
  const ordersError = ordersQuery.error ? readError(ordersQuery.error, '获取用户订单失败', '用户订单数据无效，请重新加载', '无权查看用户订单') : null;
  const total = ordersQuery.data?.pagination?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / 10));
  const beyondLastPage = ordersQuery.data !== undefined && page > lastPage;
  const shownOrders = beyondLastPage ? undefined : ordersQuery.data;
  const displayedOrders = useRef(shownOrders);
  displayedOrders.current = shownOrders;

  useEffect(() => {
    if (beyondLastPage) setView({ key: detailKey, page: lastPage });
  }, [beyondLastPage, detailKey, lastPage]);
  useEffect(() => {
    if (detailQuery.error) logger.error('获取用户详情失败:', detailQuery.error);
  }, [detailQuery.error]);
  useEffect(() => {
    if (ordersQuery.error) logger.error('获取用户订单失败:', ordersQuery.error);
  }, [ordersQuery.error]);

  const changePage = (next: number) => {
    if (!isCurrentOrders() || !shownOrders || displayedOrders.current !== shownOrders) return;
    const target = Math.max(1, Math.min(next, lastPage));
    if (target === page) return;
    currentOrders.current = JSON.stringify([detailKey, target]);
    setView({ key: detailKey, page: target });
  };

  const data = detailQuery.data;
  const failure = userId === null ? '用户ID无效' : !sessionId ? '请先登录管理员账号' : detailError;
  const missing = (value: string | null | undefined) => value?.trim() || t('暂无');
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{t('用户详情')}</h1>
          <Link href="/admin/users" prefetch={false} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            {t('返回用户列表')}
          </Link>
        </div>
        {failure ? (
          <div role="alert" className="rounded-lg bg-white p-8 text-center shadow-sm">
            <p className="text-red-600">{t(failure)}</p>
            {userId !== null && sessionId && <button onClick={reloadDetail} className="mt-4 rounded-lg border px-4 py-2">{t('重新加载用户详情')}</button>}
            {!sessionId && <Link href="/admin/login" className="mt-4 inline-block text-primary-600">{t('管理员登录')}</Link>}
          </div>
        ) : !data ? (
          <div role="status" className="rounded-lg bg-white p-8 text-center text-gray-600 shadow-sm">{t('正在加载用户详情...')}</div>
        ) : (
          <>
            <section className="rounded-lg bg-white p-6 shadow-sm" aria-labelledby="user-profile-title">
              <h2 id="user-profile-title" className="mb-5 text-lg font-semibold text-gray-900">{t('用户资料')}</h2>
              <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['用户名', data.user.username], ['邮箱', missing(data.user.email)], ['手机号', missing(data.user.phone)],
                  ['用户状态', t(data.user.status === 1 ? '正常' : '已禁用')], ['注册时间', formatDate(data.user.created_at)],
                  ['更新时间', formatDate(data.user.updated_at)], ['订单数', data.user.order_count ?? 0],
                  ['消费金额', `¥${Number(data.user.total_spent ?? 0).toFixed(2)}`],
                ].map(([label, value]) => (
                  <div key={label}><dt className="text-sm text-gray-500">{t(String(label))}</dt><dd className="mt-1 break-words font-medium text-gray-900">{value}</dd></div>
                ))}
              </dl>
              <p className="mt-5 text-sm text-gray-500">{t('消费金额仅统计已付款的非演示订单')}</p>
            </section>
            <section className="rounded-lg bg-white p-6 shadow-sm" aria-labelledby="user-addresses-title">
              <h2 id="user-addresses-title" className="mb-4 text-lg font-semibold text-gray-900">{t('收货地址')}</h2>
              {data.addresses.length === 0 ? <p className="text-gray-500">{t('暂无收货地址')}</p> : (
                <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {data.addresses.map(address => (
                    <li key={address.address_id} className="rounded-lg border border-gray-200 p-4">
                      <div className="flex items-center justify-between gap-2"><p className="font-medium text-gray-900">{missing(address.receiver_name)}</p>
                        {!!address.is_default && <span className="rounded bg-primary-50 px-2 py-1 text-xs text-primary-700">{t('默认地址')}</span>}
                      </div>
                      <p className="mt-2 text-sm text-gray-600">{missing(address.phone)}</p>
                      <p className="mt-2 break-words text-sm text-gray-600">{[address.province, address.city, address.district, address.detail_address].filter(part => part?.trim()).join(' ') || t('暂无')}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="overflow-hidden rounded-lg bg-white shadow-sm" aria-labelledby="user-recent-orders-title">
              <h2 id="user-recent-orders-title" className="p-6 text-lg font-semibold text-gray-900">{t('最近订单')}</h2>
              {data.recent_orders.length === 0 ? <p className="px-6 pb-6 text-gray-500">{t('暂无最近订单')}</p> : <OrdersTable orders={data.recent_orders} label="最近订单" />}
            </section>
            <section className="overflow-hidden rounded-lg bg-white shadow-sm" aria-labelledby="user-orders-title">
              <h2 id="user-orders-title" className="p-6 text-lg font-semibold text-gray-900">{t('全部订单')}</h2>
              {ordersError ? (
                <div role="alert" className="px-6 pb-6">
                  <p className="text-red-600">{t(ordersError)}</p>
                  <button onClick={reloadOrders} className="mt-4 rounded-lg border px-4 py-2">{t('重新加载用户订单')}</button>
                </div>
              ) : !shownOrders ? (
                <p role="status" className="px-6 pb-6 text-gray-600">{t('正在加载用户订单...')}</p>
              ) : (
                <>
                  {shownOrders.orders.length === 0 ? <p className="px-6 pb-6 text-gray-500">{t('暂无订单')}</p> : <OrdersTable orders={shownOrders.orders} label="全部订单" counts />}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-6 py-4">
                    <p className="text-sm text-gray-600">{t('共 {total} 条订单', { total })}</p>
                    <div className="flex items-center gap-3 text-sm">
                      <button onClick={() => changePage(page - 1)} disabled={page === 1} className="rounded-lg border px-3 py-2 disabled:opacity-50">{t('上一页')}</button>
                      <span>{t('第 {page} 页', { page })}</span>
                      <button onClick={() => changePage(page + 1)} disabled={page >= lastPage} className="rounded-lg border px-3 py-2 disabled:opacity-50">{t('下一页')}</button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
