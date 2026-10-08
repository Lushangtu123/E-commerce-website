'use client';

import InfoPage from '@/components/InfoPage';

export default function ReturnsPage() {
  return (
    <InfoPage
      title="退换货政策"
      intro="了解售后申请、审核及后续处理流程。"
      sections={[
        { title: '申请条件', body: ['已支付、已发货或已完成的订单都可以在订单详情页申请退款或退货。'] },
        { title: '退换货须知', body: ['退换货条件与处理方式需由商家确认，请在申请前查看商品说明。'] },
        { title: '申请流程', body: ['提交申请后由客服审核，审核结果会显示在订单详情中。', '售后审核、退货运单和人工处理进度在此查看，不会自动退款'] },
      ]}
    />
  );
}
