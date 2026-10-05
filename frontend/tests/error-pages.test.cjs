const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, findElements } = require('./runtime.cjs');

const text = (tree) => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';

function errorPage(file, error) {
  const logged = [];
  const retries = [];
  const runtime = loadPage(file, {
    props: { error, retry: () => retries.push(1) },
    imports: {
      '@/lib/logger': { logger: { error: (...args) => logged.push(args) } },
      './globals.css': {},
    },
  });
  return { runtime, logged, retries };
}

for (const file of ['src/app/error.tsx', 'src/app/global-error.tsx']) {
  test(`${file} offers retry and home, logs the error and shows its digest`, async () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    const { runtime, logged, retries } = errorPage(file, error);
    const tree = await runtime.flush();
    assert.ok(text(tree).includes('页面出错了'));
    assert.ok(text(tree).includes('错误编号：abc123'));
    const retry = findElements(tree, (element) => element.type === 'button')[0];
    retry.props.onClick();
    assert.equal(retries.length, 1);
    assert.equal(logged.length, 1);
    assert.equal(logged[0][1], error);
    assert.ok(findElements(tree, (element) => element.props.href === '/').length === 1);
  });
}

test('the global error page renders its own document and hides the digest when there is none', async () => {
  const tree = await errorPage('src/app/global-error.tsx', new Error('boom')).runtime.flush();
  assert.equal(tree.type, 'html');
  assert.equal(tree.props.lang, 'zh-CN');
  assert.ok(!text(tree).includes('错误编号'));
});
