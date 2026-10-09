const assert = require('node:assert/strict');

module.exports = async function adminSkuIndicators({ admin, adminContext }) {
  const api = 'http://127.0.0.1:3101/api/admin/products';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const created = await adminContext.request.post(api, { headers, data: {
    title: '规格可售值测试商品', title_en: 'Variant indicators fixture', price: 100, stock: 99, category_id: 1,
  } });
  assert.equal(created.status(), 201);
  const id = (await created.json()).product_id;
  const endpoint = `${api}/${id}`;
  let enabledId;
  for (const [code, price, stock, status] of [['ACTIVE', 12.5, 3, 1], ['DISABLED', 1, 200, 0]]) {
    const response = await adminContext.request.post(`${endpoint}/skus`, { headers, data: {
      sku_code: `INDICATORS-${id}-${code}`, specs: { Color: code }, price, stock, status,
    } });
    assert.equal(response.status(), 201);
    if (status) enabledId = (await response.json()).sku_id;
  }
  await admin.goto('http://127.0.0.1:3100/admin/products');
  const row = admin.getByRole('row').filter({ hasText: '规格可售值测试商品' });
  for (const text of ['规格起价 ¥12.50', '可售库存 3', '基础价格 ¥100.00', '基础库存 99']) {
    await row.getByText(text, { exact: true }).waitFor({ state: 'visible' });
  }
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  const dialog = admin.getByRole('dialog');
  assert.equal(await dialog.locator('#editProduct-price').isDisabled(), true);
  assert.equal(await dialog.locator('#editProduct-stock').isDisabled(), true);
  await dialog.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await admin.getByText('Variant price from ¥12.50', { exact: true }).waitFor({ state: 'visible' });
  await dialog.getByText('Base price (CNY)', { exact: false }).waitFor({ state: 'visible' });
  await dialog.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  await dialog.locator('#editProduct-description').fill('内容编辑保留规格库存');
  const writes = [];
  const record = request => {
    if (request.method() === 'PUT' && request.url() === endpoint) writes.push(request.postDataJSON());
  };
  admin.on('request', record);
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  admin.off('request', record);
  assert.deepEqual(writes, [{ description: '内容编辑保留规格库存' }]);
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await dialog.getByRole('link', { name: '管理规格', exact: true }).click();
  await admin.waitForURL(`http://127.0.0.1:3100/admin/products/${id}/skus`);
  const active = admin.locator('article').filter({ hasText: `INDICATORS-${id}-ACTIVE` });
  // The manager is the actual editing surface for variant price and inventory.
  await active.getByRole('button', { name: '编辑规格', exact: true }).click();
  await admin.getByLabel('售价', { exact: true }).fill('11');
  await admin.getByLabel('库存', { exact: true }).fill('8');
  await admin.getByRole('button', { name: '保存规格', exact: true }).click();
  await admin.getByText('可售库存：8', { exact: true }).waitFor({ state: 'visible' });
  await admin.goto('http://127.0.0.1:3100/admin/products');
  await row.getByText('规格起价 ¥11.00', { exact: true }).waitFor({ state: 'visible' });
  await row.getByText('可售库存 8', { exact: true }).waitFor({ state: 'visible' });
  const current = (await (await adminContext.request.get(api, { params: { keyword: '规格可售值测试商品' } })).json()).products[0];
  assert.equal(Number(current.price), 100); assert.equal(current.stock, 99);
  assert.equal(Number(current.sku_min_price), 11); assert.equal(current.sellable_stock, 8);
  assert.equal((await adminContext.request.put(`${endpoint}/skus/${enabledId}`, { headers, data: { status: 0 } })).status(), 200);
  await admin.reload();
  await row.getByText('无启用规格', { exact: true }).waitFor({ state: 'visible' });
  await row.getByText('可售库存 0', { exact: true }).waitFor({ state: 'visible' });
  console.log('PASS browser bilingual variant indicators, read-only base fields and real variant inventory editing');
};
