const assert = require('node:assert/strict');

/** An uncommitted lost request must remain recoverable when another tab fills the address list. */
module.exports = async function addressCapacity({ browser, localPlatformScripts, errors }) {
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const api = 'http://127.0.0.1:3101/api';
    const endpoint = `${api}/addresses`;
    const suffix = Date.now();
    const account = { username: `capacity${suffix}`, email: `capacity${suffix}@example.test`, password: 'BrowserCapacityPassword123!' };
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    assert.equal((await context.request.post(`${api}/users/register`, { data: account, headers })).status(), 201);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // Only the exact POST endpoint's deliberately lost reply and verified capacity 400 are expected.
      if (message.location().url === endpoint && /^Failed to load resource: (?:net::ERR_FAILED|the server responded with a status of 400(?: \([^)]*\))?)$/.test(message.text())) return;
      errors.push(`[address-capacity] ${message.text()}`);
    });
    await page.goto('http://127.0.0.1:3100/login');
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL('http://127.0.0.1:3100/');
    await page.getByText(account.username, { exact: true }).waitFor({ state: 'visible' });
    const details = { receiver_name: 'Pending capacity receiver', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: 'CAPACITY pending street', is_default: false };
    for (let index = 0; index < 19; index++) {
      assert.equal((await context.request.post(endpoint, { data: { ...details, receiver_name: `Old address ${index}`, detail_address: `CAPACITY old street ${index}` }, headers })).status(), 201);
    }
    await page.goto('http://127.0.0.1:3100/profile/address');
    await page.getByText('已保存 19 / 20 个地址', { exact: true }).waitFor({ state: 'visible' });
    const bodies = [];
    let recoveredId;
    await page.route(endpoint, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) return route.abort('failed'); // Never sends to MySQL.
      const response = await route.fetch();
      assert.equal(response.status(), bodies.length === 2 ? 400 : 201);
      const result = await response.json();
      if (bodies.length === 2) assert.equal(result.code, 'ADDRESS_CAPACITY_REACHED');
      else { assert.equal(result.creation_status, 'created'); recoveredId = result.address_id; }
      return route.fulfill({ response });
    });
    await page.getByRole('button', { name: '新增地址', exact: true }).click();
    for (const [name, value] of Object.entries(details)) {
      if (name !== 'is_default') await page.locator(`input[name="${name}"]`).fill(value);
    }
    await page.getByRole('button', { name: '保存地址', exact: true }).click();
    await page.getByText('新增地址结果尚未确认，请恢复原请求', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(bodies.length, 1);
    assert.match(bodies[0].create_key, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
    // A separate request shares the account cookie but never shares the pending creation UUID.
    assert.equal((await context.request.post(endpoint, { data: { ...details, receiver_name: 'Other tab receiver', detail_address: 'CAPACITY other tab street' }, headers })).status(), 201);
    const full = (await (await context.request.get(endpoint)).json()).addresses;
    assert.equal(full.length, 20);
    await page.getByRole('button', { name: '恢复新增地址', exact: true }).click();
    await page.getByText('地址已满，请选择删除一个旧地址，再恢复原新增请求', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('input[name="receiver_name"]').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '编辑', exact: true }).first().isDisabled(), true);
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await page.getByText('Your address list is full. Delete an old address, then restore the original creation request.', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
    const selected = full.find(row => row.receiver_name === 'Old address 0').address_id;
    await page.locator('.card').filter({ hasText: 'CAPACITY old street 0' }).getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '确定', exact: true }).click();
    await page.getByText('已释放地址空间，请恢复原新增请求', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: '删除', exact: true }).first().isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '新增地址', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '恢复新增地址', exact: true }).click();
    await page.getByRole('button', { name: '恢复新增地址', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(bodies.length, 3); assert.deepEqual(bodies[1], bodies[0]); assert.deepEqual(bodies[2], bodies[0]);
    const final = (await (await context.request.get(endpoint)).json()).addresses;
    assert.equal(final.length, 20);
    assert.equal(final.some(row => row.address_id === selected), false);
    assert.equal(final.filter(row => row.address_id === recoveredId).length, 1);
    const replay = await context.request.post(endpoint, { data: bodies[0], headers });
    assert.equal(replay.status(), 200);
    const receipt = await replay.json();
    assert.equal(receipt.address_id, recoveredId); assert.equal(receipt.creation_status, 'replayed');
    console.log('PASS browser bilingual address capacity recovery preserves the original UUID and inserts one real MySQL address');
  } finally { await context.close(); }
};
