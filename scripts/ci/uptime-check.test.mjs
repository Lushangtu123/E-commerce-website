// node --test scripts/ci/uptime-check.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKS, report, runChecks } from './uptime-check.mjs';

const healthy = {
  '/api/health': () => Response.json({ status: 'ok', dependencies: { mysql: { status: 'up' }, redis: { status: 'up' } } }),
  '/': () => new Response('<html><head><title>电商平台</title></head></html>'),
  '/api/products?limit=1': () => Response.json({ products: [{ product_id: 1 }] }),
};
const site = (routes, calls = []) => async url => {
  const path = url.replace('https://shop.test', '');
  calls.push(path);
  return (routes[path] ?? (() => new Response('missing', { status: 404 })))();
};
const options = (fetchImpl) => ({ fetchImpl, retryDelayMs: 0, sleep: async () => {} });

test('a healthy site passes every check on the first try', async () => {
  const results = await runChecks('https://shop.test', options(site(healthy)));
  assert.deepEqual(results.map(result => [result.name, result.problem, result.tries]), CHECKS.map(check => [check.name, null, 1]));
  assert.match(report('https://shop.test', results), /生产巡检正常/);
});

test('a dependency that is down fails the health check after its retries', async () => {
  const calls = [];
  const results = await runChecks('https://shop.test', options(site({
    ...healthy, '/api/health': () => Response.json({ status: 'degraded', dependencies: { mysql: { status: 'down' }, redis: { status: 'up' } } }, { status: 503 }),
  }, calls)));
  assert.equal(results[0].problem, 'HTTP 503');
  assert.equal(results[0].tries, 3);
  assert.equal(calls.filter(path => path === '/api/health').length, 3);
  assert.match(report('https://shop.test', results), /生产巡检失败（1\/3）/);
});

test('a 200 health answer that reports a dependency down still fails', async () => {
  const results = await runChecks('https://shop.test', options(site({
    ...healthy, '/api/health': () => Response.json({ status: 'ok', dependencies: { mysql: { status: 'down' } } }),
  })));
  assert.match(results[0].problem, /不可用：mysql/);
});

test('a transient failure that recovers on retry passes', async () => {
  let first = true;
  const results = await runChecks('https://shop.test', options(site({
    ...healthy, '/': () => { if (first) { first = false; return new Response('', { status: 502 }); } return healthy['/'](); },
  })));
  assert.equal(results[1].problem, null);
  assert.equal(results[1].tries, 2);
});

test('network errors, redirects and malformed bodies are reported', async () => {
  const results = await runChecks('https://shop.test', options(site({
    '/api/health': () => { throw new TypeError('fetch failed'); },
    '/': () => new Response(null, { status: 307, headers: { location: '/login' } }),
    '/api/products?limit=1': () => Response.json({ items: [] }),
  })));
  assert.deepEqual(results.map(result => result.problem), ['请求失败：fetch failed', 'HTTP 307', '响应缺少 products 列表']);
});
