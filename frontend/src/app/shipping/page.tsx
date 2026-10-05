'use client';

import InfoPage from '@/components/InfoPage';

export default function ShippingPage() {
  return (
    <InfoPage
      title="配送说明"
      intro="全国包邮，48小时送达"
      sections={[
        { title: '订单状态', body: ['订单依次经过待支付、已支付、已发货和已完成四个状态，可在“我的订单”中查看。'] },
        { title: '物流信息', body: ['商品发货后，订单详情会显示快递公司和运单号。', '请使用快递公司官方渠道查询物流'] },
        { title: '确认收货', body: ['收到商品后，请在订单详情页点击“确认收货”。'] },
      ]}
    />
  );
}
