const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async function adminInventoryRecovery({ admin, context, adminContext, setExpectedWrite }) {
  const api = 'http://127.0.0.1:3101/api', headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const addresses = await (await context.request.get(`${api}/addresses`)).json();
  for (const variant of [false, true]) {
    const title = variant ? '库存恢复规格商品' : '库存恢复普通商品';
    const created = await adminContext.request.post(`${api}/admin/products`, { headers, data: {
      title, price: 10, stock: 2, category_id: 1, status: 1,
    } });
    assert.equal(created.status(), 201);
    const productId = (await created.json()).product_id;
    let skuId;
    if (variant) {
      const sku = await adminContext.request.post(`${api}/admin/products/${productId}/skus`, { headers, data: {
        sku_code: `RECOVERY-${productId}`, price: 10, stock: 2, status: 1, specs: { Color: 'Blue' },
      } });
      assert.equal(sku.status(), 201); skuId = (await sku.json()).sku_id;
    }
    const endpoint = variant ? `${api}/admin/products/${productId}/skus/${skuId}` : `${api}/admin/products/${productId}`;
    await admin.goto(`http://127.0.0.1:3100/admin/products${variant ? `/${productId}/skus` : ''}`);
    if (variant) await admin.getByRole('button', { name: '编辑规格', exact: true }).click();
    else await admin.getByRole('row').filter({ hasText: title }).getByRole('button', { name: '编辑', exact: true }).click();
    await admin.getByLabel('库存', { exact: true }).fill('5');
    let writes = 0;
    const lostReplyAfterSale = async route => {
      writes++;
      const saved = await route.fetch(); assert.equal(saved.status(), 200);
      // A shopper buys after the admin commit, before the lost response is observed.
      const order = await context.request.post(`${api}/orders`, { headers, data: {
        items: [{ product_id: productId, quantity: 1, ...(variant && { sku_id: skuId }) }],
        shipping_address_id: addresses.addresses[0].address_id, checkout_key: randomUUID(),
      } });
      assert.equal(order.status(), 201);
      return route.abort('failed');
    };
    setExpectedWrite({ endpoint }); await admin.route(endpoint, lostReplyAfterSale);
    await admin.getByRole('button', { name: variant ? '保存规格' : '保存修改', exact: true }).click();
    await admin.getByText(variant
      ? '已重新加载当前规格数据，请核对后重新编辑；此前提交结果仍无法确认'
      : '已重新加载当前商品数据，请核对后重新编辑；此前提交结果仍无法确认', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await admin.getByRole('button', { name: variant ? '保存规格' : '保存修改', exact: true }).count(), 0);
    if (variant) await admin.getByRole('button', { name: '编辑规格', exact: true }).click();
    else await admin.getByRole('row').filter({ hasText: title }).getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await admin.getByLabel('库存', { exact: true }).inputValue(), '4');
    await admin.getByRole('button', { name: variant ? '保存规格' : '保存修改', exact: true }).click();
    // Saving an unchanged fresh draft never replays the retired absolute stock update.
    assert.equal(writes, 1);
    const read = variant ? await adminContext.request.get(`${api}/admin/products/${productId}/skus`)
      : await context.request.get(`${api}/products/${productId}`);
    const current = await read.json();
    assert.equal(variant ? current.skus.find(sku => sku.sku_id === skuId).stock : current.product.stock, 4);
    await admin.unroute(endpoint, lostReplyAfterSale); setExpectedWrite(undefined);
    console.log(`PASS browser ${variant ? 'SKU' : 'product'} committed stock with lost reply retires draft and preserves real purchase deduction`);
  }
};
