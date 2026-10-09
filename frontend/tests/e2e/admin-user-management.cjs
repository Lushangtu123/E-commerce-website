const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async function adminUserManagement({ admin, context, adminContext, customerEmail, setExpectedWrite, setExpectedRead }) {
  const api = 'http://127.0.0.1:3101/api', headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const user = (await (await context.request.get(`${api}/users/profile`)).json()).user;
  const addresses = (await (await context.request.get(`${api}/addresses`)).json()).addresses;
  const existing = (await (await context.request.get(`${api}/orders?limit=1`)).json()).total;
  const created = await adminContext.request.post(`${api}/admin/products`, { headers, data: {
    title: '用户详情订单测试商品', price: 2, stock: 33, category_id: 1, status: 1,
  } });
  assert.equal(created.status(), 201); const productId = (await created.json()).product_id;
  for (let index = existing; index < 11; index++) {
    const order = await context.request.post(`${api}/orders`, { headers, data: {
      items: [{ product_id: productId, quantity: 3 }], shipping_address_id: addresses[0].address_id, checkout_key: randomUUID(),
    } });
    assert.equal(order.status(), 201);
  }
  const findUser = async () => {
    await admin.goto('http://127.0.0.1:3100/admin/users');
    const search = admin.getByRole('textbox', { name: '搜索用户', exact: true });
    await search.fill(customerEmail); await search.press('Enter');
    const row = admin.getByRole('row').filter({ hasText: customerEmail }); await row.waitFor({ state: 'visible' });
    return row;
  };
  await admin.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption('zh-CN');
  const row = await findUser(); await row.getByRole('link', { name: '详情', exact: true }).click();
  await admin.getByRole('heading', { name: '用户详情', exact: true }).waitFor({ state: 'visible' });
  await admin.getByText(customerEmail, { exact: true }).waitFor({ state: 'visible' });
  await admin.getByText(addresses[0].receiver_name, { exact: true }).waitFor({ state: 'visible' });
  const allOrders = () => admin.getByRole('table', { name: '全部订单', exact: true });
  await allOrders().waitFor({ state: 'visible' }); assert.equal(await allOrders().getByRole('row').count(), 11);
  assert.equal(await allOrders().getByRole('row').nth(1).getByRole('cell').nth(2).textContent(), '3');
  const newest = (await (await adminContext.request.get(`${api}/admin/users/${user.user_id}/orders`)).json()).orders[0];
  assert.equal(newest.item_count, 3);
  await admin.goto('http://127.0.0.1:3100/admin/orders');
  const quantityRow = admin.getByRole('row').filter({ hasText: newest.order_no });
  await quantityRow.waitFor({ state: 'visible' });
  assert.equal(await quantityRow.getByRole('cell').nth(5).textContent(), '3');
  await admin.goto(`http://127.0.0.1:3100/admin/users/${user.user_id}`);
  await allOrders().waitFor({ state: 'visible' });
  console.log('PASS browser both admin order tables count three purchased units in one order line');
  await admin.getByRole('button', { name: '下一页', exact: true }).click();
  await admin.getByText('第 2 页', { exact: true }).waitFor({ state: 'visible' });
  await admin.waitForFunction(() => document.querySelector('table[aria-label="全部订单"] tbody')?.children.length === 1);
  await admin.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await admin.getByRole('heading', { name: 'User details', exact: true }).waitFor({ state: 'visible' });
  await admin.getByRole('heading', { name: 'User profile', exact: true }).waitFor({ state: 'visible' });
  await admin.getByRole('table', { name: 'All orders', exact: true }).waitFor({ state: 'visible' });
  await admin.getByRole('link', { name: 'Back to users', exact: true }).click();
  await admin.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  console.log('PASS browser admin user details display real profile/address and paginate eleven orders in both languages');

  const target = await findUser(), detailEndpoint = `${api}/admin/users/${user.user_id}`, endpoint = `${detailEndpoint}/status`;
  let writes = 0, readUnavailable = true;
  const lostWrite = async route => { writes++; const response = await route.fetch(); assert.equal(response.status(), 200); return route.abort('failed'); };
  const failRead = route => readUnavailable ? route.fulfill({ status: 503, contentType: 'application/json',
    headers: { 'access-control-allow-origin': 'http://127.0.0.1:3100', 'access-control-allow-credentials': 'true' },
    body: JSON.stringify({ error: '获取用户详情失败' }),
  }) : route.continue();
  setExpectedWrite({ endpoint }); setExpectedRead({ endpoint: detailEndpoint });
  await admin.route(endpoint, lostWrite); await admin.route(detailEndpoint, failRead);
  await target.getByRole('button', { name: '禁用', exact: true }).click();
  const retry = admin.getByRole('button', { name: '重新读取用户状态', exact: true }); await retry.click({ trial: true });
  assert.equal(await target.getByRole('button', { name: '禁用', exact: true }).isDisabled(), true);
  assert.equal((await (await adminContext.request.get(detailEndpoint)).json()).user.status, 0); assert.equal(writes, 1);
  await admin.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await admin.getByText('The user update is unconfirmed. Reload the current status before continuing.', { exact: true }).waitFor({ state: 'visible' });
  readUnavailable = false; await admin.getByRole('button', { name: 'Reload user status', exact: true }).click();
  await target.getByText('Disabled', { exact: true }).waitFor({ state: 'visible' });
  await target.getByRole('button', { name: 'Enable', exact: true }).click({ trial: true });
  assert.equal(writes, 1);
  await admin.unroute(endpoint, lostWrite); await admin.unroute(detailEndpoint, failRead); setExpectedWrite(undefined); setExpectedRead(undefined);
  await target.getByRole('button', { name: 'Enable', exact: true }).click();
  await target.getByText('Active', { exact: true }).waitFor({ state: 'visible' });
  console.log('PASS browser lost user-disable reply locks actions until read-only retry recovers actual disabled state');
};
