const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const backend = path.resolve(root, '../backend');
const children = [];
let browser;
let lastLogs = '';
function start(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.on('error', error => { child.startupError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { lastLogs = (lastLogs + chunk.toString()).slice(-5000); });
  return child;
}
async function ready(url, child) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (child.startupError) throw child.startupError;
    if (child.exitCode !== null) throw new Error('Local test server exited before readiness');
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Local test server readiness timeout');
}
// Console errors are collected from every page. Only the deliberate old-password login may
// log its expected 401 response and the login form's handled failure.
const consoleErrors = [];
let expectedLoginFailure = false;
const expectedLoginErrors = [/status of 401 \(Unauthorized\)/, /^登录请求失败/];
function watchConsole(page, label) {
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (expectedLoginFailure && expectedLoginErrors.some(pattern => pattern.test(text))) return;
    consoleErrors.push(`[${label}] ${new URL(page.url()).pathname}: ${text.slice(0, 300)}`);
  });
}
async function visibleText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible' });
}
(async () => {
  const fixture = start(process.execPath, ['scripts/e2e-server.cjs'], backend, {});
  await ready('http://127.0.0.1:3101/api/products', fixture);
  const frontend = start(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3100', '-H', '127.0.0.1'], root, {
    NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3101/api', ECOMMERCE_SERVERLESS_API: 'false',
    NODE_ENV: 'development', VERCEL: '', VERCEL_ENV: '', NEXT_TELEMETRY_DISABLED: '1',
  });
  await ready('http://127.0.0.1:3100/register', frontend);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  watchConsole(page, 'customer');
  page.on('dialog', dialog => dialog.accept());
  await page.goto('http://127.0.0.1:3100/register');
  await page.locator('input[name="username"]').fill(`browser${Date.now()}`);
  const customerEmail = `browser${Date.now()}@example.test`;
  await page.locator('input[name="email"]').fill(customerEmail);
  await page.locator('input[name="password"]').fill('BrowserCustomer123!');
  await page.locator('input[name="confirmPassword"]').fill('BrowserCustomer123!');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:3100/');
  console.log('PASS browser registration');
  await page.goto('http://127.0.0.1:3100/profile/address');
  await page.getByRole('button', { name: '新增地址', exact: true }).click();
  for (const [field, value] of Object.entries({ receiver_name: '浏览器测试收件人', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '仅测试地址1号' })) {
    await page.locator(`input[name="${field}"]`).fill(value);
  }
  await page.getByRole('button', { name: '保存地址', exact: true }).click();
  await visibleText(page, '仅测试地址1号');
  await page.goto('http://127.0.0.1:3100/products/1');
  await page.getByRole('button', { name: '加入购物车', exact: true }).click();
  await visibleText(page, '已加入购物车');
  await page.goto('http://127.0.0.1:3100/cart');
  await page.getByRole('button', { name: /^结算 \(1\)$/ }).click();
  await page.waitForURL(/\/orders\/\d+$/);
  const orderUrl = page.url();
  await page.getByRole('button', { name: '模拟支付', exact: true }).click();
  await visibleText(page, '演示订单');
  await visibleText(page, '已支付');
  console.log('PASS browser checkout and explicit demo payment');
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  admin.setDefaultTimeout(30000);
  admin.on('pageerror', error => errors.push(error.message));
  watchConsole(admin, 'admin');
  await admin.goto('http://127.0.0.1:3100/admin/login');
  await admin.locator('input[type="text"]').fill('admin');
  await admin.locator('input[type="password"]').fill('BrowserFixtureAdmin123!');
  await admin.getByRole('button', { name: '登录', exact: true }).click();
  await admin.waitForURL(/\/admin\/dashboard$/);
  await admin.goto('http://127.0.0.1:3100/admin/orders');
  await admin.getByRole('button', { name: '发货', exact: true }).first().click();
  await admin.getByLabel('快递公司').fill('测试快递');
  await admin.getByLabel('运单号').fill('E2E-TRACK-123');
  await admin.getByRole('button', { name: '确认发货', exact: true }).click();
  await page.goto(orderUrl);
  await visibleText(page, 'E2E-TRACK-123');
  await page.getByRole('button', { name: '确认收货', exact: true }).click();
  await visibleText(page, '已完成');
  console.log('PASS browser admin shipment and customer receipt');
  await page.getByLabel('申请原因').fill('仅浏览器测试的售后原因');
  await page.getByRole('button', { name: '提交申请', exact: true }).click();
  await visibleText(page, '待审核');
  await admin.goto('http://127.0.0.1:3100/admin/after-sales');
  await visibleText(admin, '仅浏览器测试的售后原因');
  await admin.getByRole('button', { name: '通过审核', exact: true }).first().click();
  await admin.getByLabel('审核说明').fill('仅审核通过，不产生真实退款');
  await admin.getByRole('button', { name: '保存审核结果', exact: true }).click();
  await page.goto(orderUrl);
  await visibleText(page, '审核通过');
  await visibleText(page, '不会自动退款');
  console.log('PASS browser after-sales request and admin approval without refund');
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results/commerce-after-sales.png'), fullPage: true });
  await page.goto('http://127.0.0.1:3100/forgot-password');
  await visibleText(page, '密码找回邮件服务暂不可用');
  assert.equal(await page.getByRole('button', { name: '发送重置邮件', exact: true }).isDisabled(), true);
  await page.goto('http://127.0.0.1:3100/profile/settings');
  await page.getByLabel('当前密码', { exact: true }).fill('BrowserCustomer123!');
  await page.getByLabel('新密码', { exact: true }).fill('BrowserUpdated456!');
  await page.getByLabel('确认新密码', { exact: true }).fill('BrowserUpdated456!');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.waitForURL(/\/login\?passwordChanged=1$/);
  await page.locator('input[type="email"]').fill(customerEmail);
  await page.locator('input[type="password"]').fill('BrowserCustomer123!');
  expectedLoginFailure = true;
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await visibleText(page, '邮箱或密码错误');
  expectedLoginFailure = false;
  await page.locator('input[type="password"]').fill('BrowserUpdated456!');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:3100/');
  console.log('PASS browser password change revokes session');
  assert.deepEqual(errors, [], 'browser runtime errors');
  assert.deepEqual(consoleErrors, [], 'browser console errors');
  console.log('PASS browser console has no unexpected errors');
  await adminContext.close();
  await context.close();
})().catch(async error => {
  console.error(error); console.error(lastLogs); process.exitCode = 1;
  if (browser) {
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    let index = 0;
    for (const context of browser.contexts()) for (const page of context.pages()) {
      await page.screenshot({ path: path.join(root, 'test-results', `commerce-failure-${index++}.png`), fullPage: true }).catch(() => {});
    }
  }
}).finally(async () => {
  if (browser) await browser.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 8000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
});
