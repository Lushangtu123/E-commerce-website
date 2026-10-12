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
  // Exercise actual SQL-backed rows at a phone width; never submit an extra status write.
  const verifyMobileActions = async (row, enabled) => {
    const originalViewport = admin.viewportSize();
    const language = admin.getByRole('combobox', { name: /^(界面语言|Interface language)$/ });
    const originalLanguage = await language.inputValue();
    const toggle = admin.getByRole('button', { name: /^(切换侧栏|Toggle sidebar)$/ });
    const sidebarWasOpen = await toggle.getAttribute('aria-expanded') === 'true';
    try {
      await admin.setViewportSize({ width: 390, height: 844 });
      if (sidebarWasOpen) await admin.getByRole('button', { name: /^(关闭侧栏|Close sidebar)$/ }).click();
      for (const locale of ['zh-CN', 'en']) {
        await language.selectOption(locale);
        const action = row.getByRole('button', { name: locale === 'en' ? (enabled ? 'Disable' : 'Enable') : (enabled ? '禁用' : '启用'), exact: true });
        const detail = row.getByRole('link', { name: locale === 'en' ? 'Details' : '详情', exact: true });
        const next = admin.getByRole('button', { name: locale === 'en' ? 'Next' : '下一页', exact: true });
        const previous = admin.getByRole('button', { name: locale === 'en' ? 'Previous' : '上一页', exact: true });
        // A single searched user has only one page; both controls must remain correctly disabled.
        assert.equal(await next.isDisabled(), true); assert.equal(await previous.isDisabled(), true);
        const scroll = row.locator('xpath=ancestor::table/parent::*');
        await scroll.evaluate(element => { element.scrollLeft = 0; });
        const initial = await action.boundingBox(); assert.ok(initial.x + initial.width > 390);
        const paginationBefore = await next.boundingBox();
        const geometry = await scroll.evaluate(element => {
          const table = element.querySelector('table');
          element.scrollLeft = element.scrollWidth;
          const rect = element.getBoundingClientRect();
          return { overflow: getComputedStyle(element).overflowX, width: element.clientWidth,
            contentWidth: element.scrollWidth, moved: element.scrollLeft, left: rect.left, right: rect.right,
            paginationOutside: !element.contains(table.closest('.overflow-hidden').querySelector('.border-t')) };
        });
        assert.equal(geometry.overflow, 'auto'); assert.ok(geometry.contentWidth > geometry.width && geometry.moved > 0);
        assert.ok(geometry.left >= 0 && geometry.right <= 390); assert.equal(geometry.paginationOutside, true);
        await action.scrollIntoViewIfNeeded();
        for (const control of [action, detail]) {
          const rect = await control.boundingBox(); assert.ok(rect.x >= geometry.left && rect.x + rect.width <= geometry.right + 1);
          assert.equal(await control.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
          }), true);
          await control.click({ trial: true });
        }
        assert.deepEqual(await next.boundingBox(), paginationBefore);
        for (const control of [previous, next]) {
          const rect = await control.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= 391);
        }
      }
      console.log(`PASS browser phone-width admin user ${enabled ? 'disable' : 'enable'} and details remain reachable in both languages with fixed pagination`);
    } finally {
      await language.selectOption(originalLanguage);
      if (originalViewport) await admin.setViewportSize(originalViewport);
      if (sidebarWasOpen) await toggle.click();
    }
  };
  await admin.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption('zh-CN');
  const row = await findUser(); await verifyMobileActions(row, true);
  await row.getByRole('link', { name: '详情', exact: true }).click();
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
  await verifyMobileActions(target, false);
  assert.equal(writes, 1);
  await admin.unroute(endpoint, lostWrite); await admin.unroute(detailEndpoint, failRead); setExpectedWrite(undefined); setExpectedRead(undefined);
  await target.getByRole('button', { name: 'Enable', exact: true }).click();
  await target.getByText('Active', { exact: true }).waitFor({ state: 'visible' });
  console.log('PASS browser lost user-disable reply locks actions until read-only retry recovers actual disabled state');
};
