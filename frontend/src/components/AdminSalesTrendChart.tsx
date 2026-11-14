'use client';

import '@/lib/admin-i18n';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { SalesTrendPoint } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** Revenue and order count per day. Kept in its own module so recharts loads only with the chart. */
export default function AdminSalesTrendChart({ data }: { data: SalesTrendPoint[] }) {
  const { t, formatDate } = useI18n();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={value => formatDate(value, true, { timeZone: 'UTC' })} />
        <YAxis />
        <Tooltip labelFormatter={label => typeof label === 'string' || typeof label === 'number'
          ? formatDate(label, true, { timeZone: 'UTC' }) : label} />
        <Legend />
        <Line type="monotone" dataKey="revenue" name={t("销售额")} stroke="#3b82f6" strokeWidth={2} />
        <Line type="monotone" dataKey="order_count" name={t("订单数")} stroke="#10b981" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
