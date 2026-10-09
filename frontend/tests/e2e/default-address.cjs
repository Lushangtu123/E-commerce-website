const assert = require('node:assert/strict');

/** A stale tab may change the default flag without replaying another tab's shipping details. */
module.exports = async function defaultAddress({ browser, localPlatformScripts, watchConsole, errors }) {
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const api = 'http://127.0.0.1:3101/api';
    const suffix = Date.now();
    const account = { username: `address${suffix}`, email: `address${suffix}@example.test`, password: 'BrowserAddressPassword123!' };
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    assert.equal((await context.request.post(`${api}/users/register`, { data: account, headers })).status(), 201);
    const pageA = await context.newPage(), pageB = await context.newPage();
    for (const [page, label] of [[pageA, 'default-address-a'], [pageB, 'default-address-b']]) {
      page.setDefaultTimeout(30000);
      page.on('pageerror', error => errors.push(error.message));
      watchConsole(page, label);
    }
    await pageA.goto('http://127.0.0.1:3100/login');
    await pageA.getByLabel('邮箱', { exact: true }).fill(account.email);
    await pageA.getByLabel('密码', { exact: true }).fill(account.password);
    await pageA.getByRole('button', { name: '登录', exact: true }).click();
    await pageA.waitForURL('http://127.0.0.1:3100/');
    await pageA.getByText(account.username, { exact: true }).waitFor({ state: 'visible' });
    const address = { receiver_name: 'Old receiver', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: 'OLD browser street', is_default: false };
    assert.equal((await context.request.post(`${api}/addresses`, { data: { ...address, receiver_name: 'Primary receiver', detail_address: 'PRIMARY browser street', is_default: true }, headers })).status(), 201);
    const created = await context.request.post(`${api}/addresses`, { data: address, headers });
    assert.equal(created.status(), 201);
    const id = (await created.json()).address_id;
    for (const page of [pageA, pageB]) {
      await page.goto('http://127.0.0.1:3100/profile/address');
      await page.getByText('浙江省杭州市西湖区OLD browser street', { exact: true }).waitFor({ state: 'visible' });
    }
    await pageB.locator('.card').filter({ hasText: 'OLD browser street' }).getByRole('button', { name: '编辑', exact: true }).click();
    const changed = { receiver_name: 'New receiver', phone: '13900139000', detail_address: 'NEW browser street' };
    for (const [field, value] of Object.entries(changed)) await pageB.locator(`input[name="${field}"]`).fill(value);
    await pageB.getByRole('button', { name: '保存地址', exact: true }).click();
    await pageB.getByText('浙江省杭州市西湖区NEW browser street', { exact: true }).waitFor({ state: 'visible' });
    const before = (await (await context.request.get(`${api}/addresses`)).json()).addresses.find(row => row.address_id === id);
    for (const [field, value] of Object.entries(changed)) assert.equal(before[field], value, `other tab saved ${field}`);
    assert.equal(before.is_default, false);
    // No focus refetch: the first tab still visibly holds the old address when it clicks.
    assert.equal(await pageA.getByText('浙江省杭州市西湖区OLD browser street', { exact: true }).count(), 1);
    const writes = [];
    pageA.on('request', request => {
      if (request.method() === 'PUT' && request.url().startsWith(`${api}/addresses/`)) writes.push({ url: request.url(), body: request.postDataJSON() });
    });
    await pageA.locator('.card').filter({ hasText: 'OLD browser street' }).getByRole('button', { name: '设为默认', exact: true }).click();
    await pageA.getByText('浙江省杭州市西湖区NEW browser street', { exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(writes, [{ url: `${api}/addresses/${id}/default`, body: {} }]);
    const addresses = (await (await context.request.get(`${api}/addresses`)).json()).addresses;
    const actual = addresses.find(row => row.address_id === id);
    for (const [field, value] of Object.entries(changed)) assert.equal(actual[field], value, `default action preserves ${field}`);
    assert.equal(actual.is_default, true);
    assert.equal(addresses.filter(row => row.is_default).length, 1);
    console.log('PASS browser two-tab default address changes only the flag and preserves newer shipping details');
  } finally { await context.close(); }
};
