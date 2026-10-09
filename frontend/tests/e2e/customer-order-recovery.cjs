const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

/** Real SQL writes with only the browser response lost; no mutation is replayed. */
module.exports = async function customerOrderRecovery({ page, context, adminContext, setExpectedWrite, setExpectedRead }) {
  const api = 'http://127.0.0.1:3101/api';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const addresses = await (await context.request.get(`${api}/addresses`)).json();
  const addressId = addresses.addresses[0].address_id;
  const createdProduct = await adminContext.request.post(`${api}/admin/products`, { headers, data: {
    title: '订单恢复测试商品', price: 10, stock: 10, category_id: 1, status: 1,
  } });
  assert.equal(createdProduct.status(), 201);
  const productId = (await createdProduct.json()).product_id;
  const createOrder = async () => {
    const response = await context.request.post(`${api}/orders`, { headers, data: {
      items: [{ product_id: productId, quantity: 1 }], shipping_address_id: addressId, checkout_key: randomUUID(),
    } });
    assert.equal(response.status(), 201);
    return (await response.json()).order_id;
  };
  for (const [action, label, status] of [['cancel', '取消订单', 4], ['pay', '模拟支付', 1], ['confirm', '确认收货', 3]]) {
    const id = await createOrder();
    if (action === 'confirm') {
      assert.equal((await context.request.post(`${api}/orders/${id}/pay`, { headers })).status(), 200);
      assert.equal((await adminContext.request.put(`${api}/admin/orders/${id}/status`, { headers, data: {
        status: 2, shipping_company: 'Browser recovery carrier', tracking_number: `RECOVERY-${id}`,
      } })).status(), 200);
    }
    const detail = `${api}/orders/${id}`, endpoint = `${detail}/${action}`;
    let writes = 0, readUnavailable = true;
    await page.goto(`http://127.0.0.1:3100/orders/${id}`);
    await page.getByRole('button', { name: label, exact: true }).click({ trial: true });
    const lostWrite = async route => {
      writes++;
      const result = await route.fetch(); assert.equal(result.status(), 200);
      return route.abort('failed');
    };
    const unavailableRead = route => readUnavailable ? route.fulfill({ status: 503,
      headers: { 'access-control-allow-origin': 'http://127.0.0.1:3100', 'access-control-allow-credentials': 'true' },
      contentType: 'application/json', body: JSON.stringify({ error: '获取订单详情失败' }),
    }) : route.continue();
    setExpectedWrite({ endpoint }); setExpectedRead({ endpoint: detail, prefix: '加载订单失败:' });
    await page.route(endpoint, lostWrite); await page.route(detail, unavailableRead);
    await page.getByRole('button', { name: label, exact: true }).click();
    if (action === 'cancel') await page.getByRole('alertdialog').getByRole('button', { name: '确定', exact: true }).click();
    const retry = page.getByRole('button', { name: '重新核对订单', exact: true });
    await retry.click({ trial: true });
    assert.equal(await page.getByRole('button', { name: label, exact: true }).isDisabled(), true);
    assert.equal(writes, 1);
    readUnavailable = false; await retry.click();
    await page.getByText(status === 4 ? '已取消' : status === 1 ? '已支付' : '已完成', { exact: true }).first().waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0);
    assert.equal((await (await context.request.get(detail)).json()).order.status, status);
    assert.equal(writes, 1);
    await page.unroute(endpoint, lostWrite); await page.unroute(detail, unavailableRead);
    setExpectedWrite(undefined); setExpectedRead(undefined);
    console.log(`PASS browser customer ${action} lost reply locks actions and read retry recovers real SQL status`);
  }
};
