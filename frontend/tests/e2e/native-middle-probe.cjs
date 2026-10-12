const assert = require('node:assert/strict');

/** Isolate native link activation from React/session handlers and fallback-image loading. */
module.exports = async function nativeMiddleProbe({ browser, localPlatformScripts }) {
  const destination = 'http://127.0.0.1:3100/products/1';
  const results = [];
  for (const variant of ['html', 'svg', 'transparent-svg']) {
    const context = await browser.newContext();
    try {
      await localPlatformScripts(context);
      const page = await context.newPage();
      const content = variant === 'html' ? '<div style="height:200px;width:200px">Product image</div>'
        : `<div><svg width="200" height="200" style="${variant === 'transparent-svg' ? 'pointer-events:none' : ''}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="200" height="200" fill="gray" /></svg></div>`;
      await page.setContent(`<a href="${destination}" style="display:block;width:200px;height:200px">${content}</a>`);
      await page.evaluate(() => {
        window.__middleProbe = [];
        for (const type of ['mousedown', 'mouseup', 'auxclick']) document.addEventListener(type, event => {
          if (event.button === 1) queueMicrotask(() => window.__middleProbe.push({ type, target: event.target.tagName,
            trusted: event.isTrusted, prevented: event.defaultPrevented }));
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
      results.push({ variant, opened, failure, input: await page.evaluate(() => window.__middleProbe) });
    } finally { await context.close(); }
  }
  console.log('NATIVE_MIDDLE_PROBE', JSON.stringify(results));
  assert.equal(results[0].opened, true, 'plain HTML native link is the positive control');
};
