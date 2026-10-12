const assert = require('node:assert/strict');

// Diagnose the native popup boundary without retrying or replacing the user gesture.
async function traceMiddleClick(context, page, perform) {
  const safeUrl = value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return '<uncommitted>'; } };
  // Diagnostics are best effort and bounded; an unresponsive tab must retain the original error.
  const sample = async probe => {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(probe).catch(() => ({ unavailable: true })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ unavailable: true }), 1000); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  const trace = [];
  const popups = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  cdp.on('Page.windowOpen', event => trace.push({ event: 'windowOpen', url: safeUrl(event.url), userGesture: event.userGesture }));
  const onPage = popup => {
    popups.push(popup);
    trace.push({ event: 'page', url: safeUrl(popup.url()) });
    popup.on('framenavigated', frame => { if (frame === popup.mainFrame()) trace.push({ event: 'navigation', url: safeUrl(frame.url()) }); });
    for (const event of ['domcontentloaded', 'load']) popup.on(event, () => trace.push({ event, url: safeUrl(popup.url()) }));
    popup.on('close', () => trace.push({ event: 'close' }));
    popup.on('crash', () => trace.push({ event: 'crash' }));
  };
  const onFailure = request => {
    if (request.isNavigationRequest()) trace.push({ event: 'navigationFailure', url: safeUrl(request.url()), error: request.failure()?.errorText });
  };
  context.on('page', onPage); context.on('requestfailed', onFailure);
  await page.evaluate(() => {
    window.__ecommerceMiddleClickTrace = [];
    if (window.__ecommerceMiddleClickObserver) return;
    window.__ecommerceMiddleClickObserver = true;
    for (const type of ['mousedown', 'mouseup', 'auxclick']) document.addEventListener(type, event => {
      if (event.button !== 1) return;
      const anchor = event.target.closest?.('a');
      const sample = { type, button: event.button, trusted: event.isTrusted, prevented: event.defaultPrevented,
        href: anchor?.getAttribute('href')?.split(/[?#]/, 1)[0], target: event.target.tagName, namespace: event.target.namespaceURI };
      window.__ecommerceMiddleClickTrace.push(sample);
      setTimeout(() => Object.assign(sample, { finalPrevented: event.defaultPrevented,
        connected: event.target.isConnected, anchorConnected: anchor?.isConnected }), 0);
    });
  });
  try { return await perform(); }
  catch (error) {
    const targets = await sample(() => cdp.send('Target.getTargets'));
    const input = await sample(() => page.evaluate(() => window.__ecommerceMiddleClickTrace));
    const documents = await Promise.all(context.pages().map(async tab => ({
      url: safeUrl(tab.url()),
      ...await sample(() => tab.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        return { readyState: document.readyState, heading: document.querySelector('h1')?.textContent,
          domContentLoadedEventEnd: navigation?.domContentLoadedEventEnd, loadEventEnd: navigation?.loadEventEnd };
      })),
    })));
    const lifecycleReplay = await Promise.all(popups.map(async popup => {
      let popupCdp;
      const events = [];
      const state = await sample(async () => {
        popupCdp = await context.newCDPSession(popup);
        try {
          popupCdp.on('Page.lifecycleEvent', event => events.push(event.name));
          await popupCdp.send('Page.enable');
          // Chromium replays lifecycle milestones when they are enabled after a committed load.
          await popupCdp.send('Page.setLifecycleEventsEnabled', { enabled: true });
          await popupCdp.send('Runtime.evaluate', { expression: 'document.readyState' });
          return { events };
        } finally { await popupCdp.detach().catch(() => {}); }
      });
      return { url: safeUrl(popup.url()), ...state };
    }));
    console.error('NATIVE_MIDDLE_CLICK_DIAGNOSTICS', JSON.stringify({ source: safeUrl(page.url()), input, trace,
      pages: context.pages().map(popup => safeUrl(popup.url())), documents, lifecycleReplay,
      targets: (targets.targetInfos || []).filter(target => target.type === 'page').map(target => ({ url: safeUrl(target.url), attached: target.attached })) }));
    throw error;
  } finally {
    context.off('page', onPage); context.off('requestfailed', onFailure);
    // A closed source page may already detach CDP; cleanup must retain the navigation failure.
    await cdp.detach().catch(() => {});
  }
}

/** Real cookies and SQL-backed saved products; keyboard and middle clicks exercise native Next Links. */
module.exports = async function customerProductLinks({ browser, localPlatformScripts, watchConsole, errors }) {
  const origin = 'http://127.0.0.1:3100', api = 'http://127.0.0.1:3101/api';
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const context = await browser.newContext();
  try {
    await localPlatformScripts(context);
    const username = `links${Date.now()}`;
    const account = { username, email: `${username}@example.test`, password: 'BrowserProductLinks123!' };
    const registered = await context.request.post(`${api}/users/register`, { headers, data: account });
    assert.equal(registered.status(), 201);
    assert.equal((await context.request.post(`${api}/favorites`, { headers, data: { product_id: 1 } })).status(), 200);
    assert.equal((await context.request.post(`${api}/browse/record`, { headers, data: { product_id: 1 } })).status(), 200);
    const productResponse = await context.request.get(`${api}/products/1`);
    assert.equal(productResponse.status(), 200);
    const product = (await productResponse.json()).product;

    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message)); watchConsole(page, 'customer-product-links');
    const forbiddenWrites = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() !== 'GET' && request.method() !== 'OPTIONS' &&
          (/^\/api\/cart(?:\/|$)/.test(url.pathname) || /^\/api\/favorites(?:\/|$)/.test(url.pathname) ||
          request.method() === 'DELETE' && /^\/api\/browse\/history(?:\/|$)/.test(url.pathname))) {
        forbiddenWrites.push(`${request.method()} ${url.pathname}`);
      }
    });
    await page.goto(`${origin}/login`);
    await page.getByLabel('邮箱', { exact: true }).fill(account.email);
    await page.getByLabel('密码', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`${origin}/`);

    for (const kind of ['favorites', 'history']) {
      const locale = kind === 'favorites' ? 'zh-CN' : 'en';
      await page.getByRole('combobox', { name: /^(界面语言|Interface language)$/ }).selectOption(locale);
      const title = locale === 'en' ? product.title_en || product.title : product.title;
      const collectionUrl = `${origin}/${kind}`;
      const openCollection = async () => {
        await page.goto(collectionUrl);
        await page.getByRole('heading', { level: 2, name: title, exact: true }).waitFor({ state: 'visible' });
        assert.equal(await page.locator('a[href="/products/1"]').count(), 2, 'image and heading expose independent detail links');
      };
      // Both controls remain real anchors with their own tab stop, rather than scripted key handlers.
      for (const index of [0, 1]) {
        await openCollection();
        const link = page.locator('a[href="/products/1"]').nth(index);
        assert.equal(await link.evaluate(node => node.tabIndex), 0);
        assert.equal(await link.locator('button').count(), 0, 'cart and removal controls are outside each link');
        await link.focus(); await page.keyboard.press('Enter');
        await page.waitForURL(`${origin}/products/1`);
        await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor({ state: 'visible' });
      }
      console.log(`PASS browser ${kind} image and title anchors open product detail with keyboard Enter (${locale})`);

      await openCollection();
      const opened = await traceMiddleClick(context, page, async () => {
        const [popup] = await Promise.all([
          context.waitForEvent('page'),
          page.locator('a[href="/products/1"]').first().click({ button: 'middle' }),
        ]);
        popup.setDefaultTimeout(30000);
        popup.on('pageerror', error => errors.push(error.message)); watchConsole(popup, `customer-product-links-${kind}-tab`);
        await popup.waitForURL(`${origin}/products/1`);
        await popup.getByRole('heading', { level: 1, name: title, exact: true }).waitFor({ state: 'visible' });
        return popup;
      });
      assert.equal(page.url(), collectionUrl, 'opening a background tab retains the collection page');
      await opened.close();
      console.log(`PASS browser ${kind} middle click opens a native product tab and keeps the collection page`);
    }
    assert.deepEqual(forbiddenWrites, [], 'link activation never adds to cart or removes saved products');
    const favorites = await context.request.get(`${api}/favorites/my`);
    assert.equal(favorites.status(), 200);
    assert.equal((await favorites.json()).favorites.filter(row => row.product_id === 1).length, 1);
    const history = await context.request.get(`${api}/browse/history`);
    assert.equal(history.status(), 200);
    assert.equal((await history.json()).history.filter(row => row.product_id === 1).length, 1);
    const cart = await context.request.get(`${api}/cart`);
    assert.equal(cart.status(), 200);
    assert.deepEqual((await cart.json()).items, []);
  } finally { await context.close(); }
};
