'use client';

import InfoPage from '@/components/InfoPage';

export default function ReturnsPage() {
  return (
    <InfoPage
      title="退换货政策"
      intro="我们支持7天无理由退换货，并提供正品保障。"
      sections={[
        { title: '7天无理由退换货', body: ['已支付、已发货或已完成的订单都可以在订单详情页申请退款或退货。'] },
        { title: '正品保障，假一赔十', body: ['平台销售的商品均为正品。'] },
        { title: '申请流程', body: ['提交申请后由客服审核，审核结果会显示在订单详情中。', '此处仅处理售后审核，不会自动退款；审核通过后请联系商家安排退款或退货'] },
      ]}
    />
  );
}
