'use client';

import InfoPage from '@/components/InfoPage';

export default function HelpPage() {
  return (
    <InfoPage
      title="帮助中心"
      intro="下单、优惠券和售后的常见问题。"
      sections={[
        { title: '如何下单？', body: ['浏览商品并加入购物车，在购物车中选择收货地址和可用优惠券后提交订单。'] },
        { title: '订单多久需要支付？', body: ['订单提交后请在 30 分钟内完成支付，超时未支付的订单会自动取消，库存和优惠券会退回。'] },
        { title: '如何使用优惠券？', body: ['在优惠券中心领取优惠券，结算时选择满足使用条件的优惠券即可抵扣。'] },
        { title: '如何申请售后？', body: ['在订单详情页提交退款或退货申请，审核结果会显示在订单中。审核通过后请联系客服安排退款或退货。'] },
      ]}
    />
  );
}
