const assert = require('node:assert/strict');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { FiImage } = require('react-icons/fi');

/** Isolate native link activation from React/session handlers and fallback-image loading. */
module.exports = async function nativeMiddleProbe({ browser, localPlatformScripts }) {
  const destination = 'http://127.0.0.1:3100/products/1';
  const results = [];
  for (const variant of ['html', 'svg', 'transparent-svg']) {
    const context = await browser.newContext();
    try {
      await localPlatformScripts(context);
      const page = await context.newPage();
      const icon = renderToStaticMarkup(createElement(FiImage, { size: 24, 'aria-hidden': true,
        style: variant === 'transparent-svg' ? { pointerEvents: 'none' } : undefined }));
      const content = `<div style="height:200px;width:200px;display:flex;align-items:center;justify-content:center">${variant === 'html' ? 'Product image' : icon}</div>`;
      await page.setContent(`<a href="${destination}" style="display:block;width:200px;height:200px">${content}</a>`);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Page.enable');
      const windows = [];
      cdp.on('Page.windowOpen', event => windows.push({ url: event.url, userGesture: event.userGesture }));
      await page.evaluate(() => {
        window.__middleProbe = [];
        for (const type of ['mousedown', 'mouseup', 'auxclick']) document.addEventListener(type, event => {
          if (event.button !== 1) return;
          const anchor = event.target.closest?.('a');
          const sample = { type, target: event.target.tagName, namespace: event.target.namespaceURI,
            trusted: event.isTrusted, prevented: event.defaultPrevented };
          window.__middleProbe.push(sample);
          setTimeout(() => Object.assign(sample, { finalPrevented: event.defaultPrevented,
            connected: event.target.isConnected, anchorConnected: anchor?.isConnected }), 0);
        });
      });
      let opened = false;
      let failure;
      try {
        const [popup] = await Promise.all([
          context.waitForEvent('page', { timeout: 5000 }),
          page.locator('a').click({ button: 'middle' }),
        ]);
        // This probe observes native target creation/commit; the main app test still checks load and content.
        await popup.waitForURL(destination, { waitUntil: 'commit', timeout: 5000 });
        opened = true;
      } catch (error) { failure = error.name; }
      const input = await page.evaluate(() => new Promise(resolve => setTimeout(() => resolve(window.__middleProbe), 0)));
      results.push({ variant, opened, failure, windows, input });
      await cdp.detach().catch(() => {});
    } finally { await context.close(); }
  }
  console.log('NATIVE_MIDDLE_PROBE', JSON.stringify(results));
  assert.equal(results[0].opened, true, 'plain HTML native link is the positive control');
};
