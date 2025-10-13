'use client';

import { useState, useEffect } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [salesTrend, setSalesTrend] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const token = localStorage.getItem('admin_token');
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      // 获取统计数据
      const [statsRes, ordersRes, productsRes, trendRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/dashboard/stats`, { headers }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/dashboard/recent-orders?limit=5`, { headers }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/dashboard/top-products?days=7&limit=5`, { headers }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/dashboard/sales-trend?days=7`, { headers })
      ]);

      const statsData = await statsRes.json();
      const ordersData = await ordersRes.json();
      const productsData = await productsRes.json();
      const trendData = await trendRes.json();

      setStats(statsData);
      setRecentOrders(ordersData);
      setTopProducts(productsData);
      setSalesTrend(trendData);
    } catch (error) {
      console.error('获取数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ icon, title, value, growth, color }: any) => (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-gray-500 text-sm mb-1">{title}</p>
          <h3 className="text-2xl font-bold text-gray-800">{value}</h3>
          {growth !== undefined && (
            <div className="flex items-center mt-2">
              <span className={`text-sm font-medium ${growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {growth >= 0 ? '↑' : '↓'} {Math.abs(growth)}%
              </span>
              <span className="text-gray-400 text-xs ml-2">较昨日</span>
            </div>
          )}
        </div>
        <div className={`${color} p-4 rounded-full`}>
          {icon}
        </div>
      </div>
    </div>
  );

  const getStatusBadge = (status: number) => {
    const statusMap: any = {
      0: { text: '待支付', class: 'bg-yellow-100 text-yellow-700' },
      1: { text: '已支付', class: 'bg-blue-100 text-blue-700' },
      2: { text: '待发货', class: 'bg-purple-100 text-purple-700' },
      3: { text: '已发货', class: 'bg-indigo-100 text-indigo-700' },
      4: { text: '已完成', class: 'bg-green-100 text-green-700' },
      5: { text: '已取消', class: 'bg-gray-100 text-gray-700' }
    };
    const s = statusMap[status] || statusMap[0];
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.class}`}>{s.text}</span>;
  };

  if (!mounted || loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">加载中...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">仪表盘</h1>
          <p className="text-gray-600 mt-1">欢迎回来，查看您的业务概况</p>
        </div>

        {/* 核心指标卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            icon={<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>}
            title="今日订单"
            value={stats?.today_orders || 0}
            growth={stats?.order_growth}
            color="bg-blue-500"
          />
          <StatCard
            icon={<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
            title="今日销售额"
            value={`¥${stats?.today_revenue ? Number(stats.today_revenue).toFixed(2) : '0.00'}`}
            growth={stats?.revenue_growth}
            color="bg-green-500"
          />
          <StatCard
            icon={<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>}
            title="新增用户"
            value={stats?.new_users || 0}
            color="bg-purple-500"
          />
          <StatCard
            icon={<svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
            title="在售商品"
            value={stats?.active_products || 0}
            color="bg-orange-500"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 销售趋势图 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">销售趋势（最近7天）</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={salesTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="销售额" stroke="#3b82f6" strokeWidth={2} />
                <Line type="monotone" dataKey="order_count" name="订单数" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* 热门商品 */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">热门商品（最近7天）</h3>
            <div className="space-y-3">
              {topProducts.map((product, index) => (
                <div key={product.product_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center flex-1">
                    <span className="text-lg font-bold text-gray-400 w-6">#{index + 1}</span>
                    <span className="ml-3 text-sm font-medium text-gray-900 truncate">{product.title}</span>
                  </div>
                  <div className="text-right ml-4">
                    <p className="text-sm font-semibold text-gray-900">销量: {product.total_sales || 0}</p>
                    <p className="text-xs text-gray-500">¥{product.total_revenue ? Number(product.total_revenue).toFixed(2) : '0.00'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 最近订单 */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">最近订单</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">订单号</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用户</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">金额</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">时间</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {recentOrders.map((order) => (
                  <tr key={order.order_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{order.order_no}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{order.username || '未知用户'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">¥{order.total_amount ? parseFloat(order.total_amount).toFixed(2) : '0.00'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{getStatusBadge(order.status)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(order.created_at).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

