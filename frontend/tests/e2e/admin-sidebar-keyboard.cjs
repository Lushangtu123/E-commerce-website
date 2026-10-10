const assert = require('node:assert/strict');

// The commerce fixture supplies an already signed-in local administrator page.
// This checks only layout controls and never submits a login or administration write.
module.exports = async function adminSidebarKeyboard({ admin }) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(admin.url()).hostname), 'local fixture page required');
  const toggle = admin.getByRole('button', { name: /^(切换侧栏|Toggle sidebar)$/ });
  const language = admin.getByRole('combobox', { name: /^(界面语言|Interface language)$/ });
  await toggle.waitFor({ state: 'visible' });
  const originalViewport = admin.viewportSize();
  const originalLocale = await language.inputValue();
  const originalOpen = await toggle.getAttribute('aria-expanded');
  const links = ['/admin/dashboard', '/admin/products', '/admin/orders', '/admin/after-sales', '/admin/coupons', '/admin/users', '/admin/logs'];

  try {
    for (const width of [1280, 768]) {
      await admin.setViewportSize({ width, height: 900 });
      for (const locale of ['zh-CN', 'en']) {
        await language.selectOption(locale);
        if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
        const sidebarId = await toggle.getAttribute('aria-controls');
        assert.ok(sidebarId, 'toggle identifies the sidebar');
        const sidebar = admin.locator(`[id="${sidebarId}"]`);
        await sidebar.waitFor({ state: 'visible' });
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        assert.deepEqual(await sidebar.getByRole('link').evaluateAll(elements => elements.map(element => element.getAttribute('href'))), links);
        const orders = sidebar.getByRole('link', { name: locale === 'en' ? 'Orders' : '订单管理', exact: true });
        await orders.focus();
        assert.equal(await orders.evaluate(element => element === document.activeElement), true, 'open navigation accepts keyboard focus');

        // The inside close control is visible below the desktop breakpoint.
        const close = width < 1024 ? sidebar.getByRole('button', { name: locale === 'en' ? 'Close sidebar' : '关闭侧栏', exact: true }) : toggle;
        await close.focus();
        await admin.keyboard.press('Enter');
        await sidebar.waitFor({ state: 'hidden' });
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(await toggle.evaluate(element => element === document.activeElement), true, 'closing restores visible focus');
        assert.equal(await sidebar.getByRole('navigation').count(), 0, 'closed navigation leaves accessibility tree');
        assert.equal(await sidebar.getByRole('link').count(), 0);
        assert.equal(await sidebar.getByRole('button').count(), 0);

        for (const key of ['Tab', 'Shift+Tab']) {
          await toggle.focus();
          for (let index = 0; index < 10; index++) {
            await admin.keyboard.press(key);
            assert.equal(await sidebar.evaluate(element => element.contains(document.activeElement)), false, 'closed sidebar never receives keyboard focus');
          }
        }

        await toggle.focus();
        await admin.keyboard.press('Enter');
        await sidebar.waitFor({ state: 'visible' });
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        assert.deepEqual(await sidebar.getByRole('link').evaluateAll(elements => elements.map(element => element.getAttribute('href'))), links, 'reopening retains navigation');
      }
    }
    console.log('PASS browser bilingual admin sidebar visibility, keyboard exclusion and focus restoration at desktop and mobile widths');
  } finally {
    await language.selectOption(originalLocale);
    if (originalOpen === 'false' && await toggle.getAttribute('aria-expanded') === 'true') {
      await admin.setViewportSize({ width: 1280, height: 900 });
      await toggle.click();
    }
    if (originalViewport) await admin.setViewportSize(originalViewport);
  }
};
