// Synthetic production checks for .github/workflows/uptime.yml: read-only GETs against the public site.
// Each check retries before it counts as failed, so one slow cold start does not page anyone.
// Usage: SITE_URL=https://example.test [REPORT_FILE=report.md] node scripts/ci/uptime-check.mjs
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TIMEOUT_MS = 10_000;
const SLOW_MS = 3_000;

export const CHECKS = [
  {
    name: '健康检查',
    path: '/api/health',
    async verify(response) {
      const body = await response.json();
      const down = Object.entries(body.dependencies ?? {}).filter(([, dependency]) => dependency?.status !== 'up').map(([name]) => name);
      if (body.status !== 'ok' || down.length) return `status=${body.status}${down.length ? `，不可用：${down.join(', ')}` : ''}`;
      return null;
    },
  },
  {
    name: '首页',
    path: '/',
    async verify(response) {
      return /<title>[^<]+<\/title>/.test(await response.text()) ? null : '页面没有标题，可能不是正常渲染的首页';
    },
  },
  {
    name: '商品接口',
    path: '/api/products?limit=1',
    async verify(response) {
      const body = await response.json();
      return Array.isArray(body.products) ? null : '响应缺少 products 列表';
    },
  },
];

/** One attempt: the problem as text, or null when the check passed. */
async function attempt(base, check, fetchImpl) {
  const started = Date.now();
  try {
    const response = await fetchImpl(`${base}${check.path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
    const ms = Date.now() - started;
    if (response.status !== 200) return { problem: `HTTP ${response.status}`, ms };
    return { problem: await check.verify(response), ms };
  } catch (error) {
    const ms = Date.now() - started;
    return { problem: error?.name === 'TimeoutError' ? `超过 ${TIMEOUT_MS / 1000} 秒无响应` : `请求失败：${error?.message ?? error}`, ms };
  }
}

export async function runChecks(base, { fetchImpl = fetch, attempts = 3, retryDelayMs = 15_000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const results = [];
  for (const check of CHECKS) {
    let result;
    for (let tries = 1; tries <= attempts; tries++) {
      result = { ...(await attempt(base, check, fetchImpl)), tries };
      if (!result.problem) break;
      if (tries < attempts) await sleep(retryDelayMs);
    }
    results.push({ name: check.name, path: check.path, ...result });
  }
  return results;
}

export function report(base, results, now = new Date()) {
  const failed = results.filter(result => result.problem);
  const rows = results.map(result => `| ${result.problem ? '❌' : result.ms > SLOW_MS ? '🐢' : '✅'} ${result.name} | \`${result.path}\` | ${result.ms} ms | ${result.tries} | ${result.problem ?? (result.ms > SLOW_MS ? '偏慢' : '正常')} |`);
  return [
    `### ${failed.length ? `生产巡检失败（${failed.length}/${results.length}）` : '生产巡检正常'}`,
    '',
    `站点：${base}　时间：${now.toISOString()}`,
    '',
    '| 检查 | 路径 | 耗时 | 尝试次数 | 结果 |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

async function main() {
  const base = (process.env.SITE_URL ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(base)) {
    console.error('Set SITE_URL to the site origin, e.g. https://example.vercel.app');
    process.exit(2);
  }
  const results = await runChecks(base);
  const text = report(base, results);
  console.log(text);
  if (process.env.REPORT_FILE) writeFileSync(process.env.REPORT_FILE, text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  process.exit(results.some(result => result.problem) ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
