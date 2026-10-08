'use client';
import type { AfterSalesRequest } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function AfterSalesProgress({ value }: { value: AfterSalesRequest }) {
  const { t, formatDate } = useI18n();
  if (value.status !== 'approved') return null;
  const state = value.completed_at ? '已结案' : value.return_submitted_at ? '已寄回，待处理' : value.type === 'return' ? '待退货' : '待人工处理';
  return <div className="rounded-lg bg-gray-50 p-4 space-y-2 text-sm">
    <p>{t('处理进度')}：<span>{t(state)}</span></p>
    {value.return_submitted_at && <><p>{t('退货快递公司')}：{value.return_company}</p><p className="wrap-break-word">{t('退货运单号')}：{value.return_tracking_number}</p><p>{t('寄回登记时间')}：{formatDate(value.return_submitted_at)}</p></>}
    {value.completed_at && <>
      <p>{t('人工退款记录')}：¥{Number(value.refund_amount ?? 0).toFixed(2)}</p>
      {value.refund_reference && <p className="whitespace-pre-wrap wrap-break-word">{t('退款凭证')}：{value.refund_reference}</p>}
      <p className="whitespace-pre-wrap wrap-break-word">{t('结案说明')}：{value.completion_note}</p>
      <p>{t('结案时间')}：{formatDate(value.completed_at)}</p>
      <p className="text-amber-800">{t('以上为商家人工处理记录，系统不会自动退款或回补库存')}</p>
    </>}
  </div>;
}
