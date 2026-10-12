const assert = require('node:assert/strict');

/** Malformed progress/categories stay recoverable reads against the already-created local SQL fixtures. */
module.exports = async function afterSalesCategoryReadSafety({ page, admin, orderUrl, afterSalesWriteEndpoint, setExpectedRead }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const adminEndpoint = `${api}/admin/after-sales`, categoryEndpoint = `${api}/products/categories`;
  const adminListUrl = `${adminEndpoint}?page=1&limit=20&status=approved`;
  const getJSON = async (target, url) => {
    const response = await target.context().request.get(url); assert.equal(response.status(), 200); return response.json();
  };
  const customerBefore = await getJSON(page, afterSalesWriteEndpoint);
  const adminBefore = await getJSON(admin, adminListUrl);
  const categoriesBefore = await getJSON(admin, categoryEndpoint);
  const productsBefore = await getJSON(admin, `${api}/admin/products?page=1&limit=20`);
  const closed = customerBefore.after_sales;
  assert.ok(closed.completed_at && closed.status === 'approved' && closed.return_submitted_at);
  assert.ok(adminBefore.requests.some(row => row.request_id === closed.request_id));
  assert.ok(categoriesBefore.length > 0);
  const writes = [];
  const recordWrite = request => {
    if (request.url().startsWith(api + '/') && !['GET', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  };
  page.on('request', recordWrite); admin.on('request', recordWrite);
  try {
    const variants = [
      ['object progress note', row => ({ ...row, completion_note: { unexpected: 'object' } })],
      ['missing recorded refund amount', row => { const invalid = { ...row }; delete invalid.refund_amount; return invalid; }],
      ['invalid closure date', row => ({ ...row, completed_at: 'not-a-date' })],
    ];
    for (const [target, endpoint, isCustomer] of [[page, afterSalesWriteEndpoint, true], [admin, adminEndpoint, false]]) {
      for (const [label, corrupt] of variants) {
        let reads = 0;
        const matches = url => url.origin + url.pathname === endpoint;
        const countRead = request => { if (request.method() === 'GET' && request.url().split('?')[0] === endpoint) reads++; };
        const invalid = route => route.request().method() === 'GET' ? route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify(isCustomer ? { after_sales: corrupt(closed) } : {
            ...adminBefore, requests: adminBefore.requests.map(row => row.request_id === closed.request_id ? corrupt(row) : row),
          }),
        }) : route.continue();
        target.on('request', countRead); setExpectedRead({ endpoint }); await target.route(matches, invalid);
        try {
          if (isCustomer) await target.goto(orderUrl);
          await target.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption('zh-CN');
          if (!isCustomer) {
            assert.equal(await target.getByLabel('审核状态', { exact: true }).inputValue(), 'approved');
            await target.getByRole('button', { name: '重新加载', exact: true }).click();
          }
          const alert = target.locator('main').getByRole('alert').filter({ hasText: '加载售后申请失败，请重试' });
          await alert.waitFor({ state: 'visible' });
          assert.equal(await target.getByText('已结案', { exact: true }).count(), 0, 'invalid progress must not appear as a valid closure');
          assert.equal(await target.getByText('暂无售后申请', { exact: true }).count(), 0);
          for (const name of ['提交申请', '撤回申请', '提交退货运单', '记录处理并结案', '通过审核']) {
            assert.equal(await target.getByRole('button', { name, exact: true }).count(), 0);
          }
          await target.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
          const englishAlert = target.locator('main').getByRole('alert').filter({ hasText: 'Unable to load after-sales requests. Try again.' });
          await englishAlert.waitFor({ state: 'visible' }); assert.equal(reads, 1); assert.deepEqual(writes, []);
          await target.unroute(matches, invalid);
          const restoredResponse = target.waitForResponse(response => response.request().method() === 'GET' && response.url().split('?')[0] === endpoint);
          await target.getByRole('button', { name: isCustomer ? 'Refresh after-sales progress' : 'Retry', exact: true }).click();
          const restored = await restoredResponse; assert.equal(restored.status(), 200);
          const actual = await restored.json();
          assert.deepEqual(isCustomer ? actual.after_sales : actual.requests.find(row => row.request_id === closed.request_id),
            isCustomer ? closed : adminBefore.requests.find(row => row.request_id === closed.request_id));
          await englishAlert.waitFor({ state: 'detached' });
          await target.getByText('Closed', { exact: true }).first().waitFor({ state: 'visible' });
          await target.getByText(closed.completion_note, { exact: false }).first().waitFor({ state: 'visible' });
          assert.equal(reads, 2, 'one malformed read and one explicit real SQL retry'); assert.deepEqual(writes, []);
          await target.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
          console.log(`PASS browser ${isCustomer ? 'customer' : 'admin'} after-sales ${label} shows bilingual error and one-GET SQL recovery without writes`);
        } finally { await target.unroute(matches, invalid); target.off('request', countRead); setExpectedRead(undefined); }
      }
    }
    for (const mode of ['add', 'edit']) {
      let reads = 0;
      const countRead = request => { if (request.method() === 'GET' && request.url() === categoryEndpoint) reads++; };
      const invalid = route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      admin.on('request', countRead); setExpectedRead({ endpoint: categoryEndpoint, prefix: '获取分类失败:' });
      await admin.route(categoryEndpoint, invalid);
      try {
        await admin.goto(`${origin}/admin/products`);
        await admin.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption('zh-CN');
        await admin.locator('main tbody tr').first().waitFor({ state: 'visible' });
        await admin.getByRole('button', { name: mode === 'add' ? '添加商品' : '编辑', exact: true }).first().click();
        const dialog = admin.getByRole('dialog');
        const alert = dialog.getByRole('alert').filter({ hasText: '获取分类失败，请重新加载' });
        await alert.waitFor({ state: 'visible' });
        const title = dialog.getByLabel(/^商品标题/), category = dialog.getByLabel(/^分类/);
        const draft = `Unsaved category read ${mode} draft`;
        const selected = await category.inputValue();
        await title.fill(draft);
        assert.equal(await category.isDisabled(), true); assert.equal(reads, 1); assert.deepEqual(writes, []);
        await dialog.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
        const englishAlert = dialog.getByRole('alert').filter({ hasText: 'Categories could not be loaded. Please reload.' });
        await englishAlert.waitFor({ state: 'visible' });
        assert.equal(await dialog.getByLabel(/^Product title/).inputValue(), draft);
        assert.equal(await dialog.getByLabel(/^Category/).inputValue(), selected);
        await admin.unroute(categoryEndpoint, invalid);
        const freshResponse = admin.waitForResponse(response => response.request().method() === 'GET' && response.url() === categoryEndpoint);
        await englishAlert.getByRole('button', { name: 'Reload categories', exact: true }).click();
        const restored = await freshResponse; assert.equal(restored.status(), 200); assert.deepEqual(await restored.json(), categoriesBefore);
        await englishAlert.waitFor({ state: 'detached' });
        const restoredCategory = dialog.getByLabel(/^Category/);
        assert.equal(await restoredCategory.isEnabled(), true);
        assert.equal(await restoredCategory.inputValue(), selected);
        assert.equal(await dialog.getByLabel(/^Product title/).inputValue(), draft);
        assert.deepEqual(await restoredCategory.locator('option').evaluateAll(options => options.map(option => option.value)), ['', ...categoriesBefore.map(row => String(row.category_id))]);
        assert.equal(reads, 2); assert.deepEqual(writes, []);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
        await admin.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
        console.log(`PASS browser admin product ${mode} category malformed 200 retains bilingual draft and restores real SQL options through one GET without saving`);
      } finally { await admin.unroute(categoryEndpoint, invalid); admin.off('request', countRead); setExpectedRead(undefined); }
    }
    assert.deepEqual(writes, []);
    assert.deepEqual(await getJSON(page, afterSalesWriteEndpoint), customerBefore);
    assert.deepEqual(await getJSON(admin, adminListUrl), adminBefore);
    assert.deepEqual(await getJSON(admin, `${api}/admin/products?page=1&limit=20`), productsBefore);
    assert.deepEqual(await getJSON(admin, categoryEndpoint), categoriesBefore);
  } finally { page.off('request', recordWrite); admin.off('request', recordWrite); setExpectedRead(undefined); }
};
