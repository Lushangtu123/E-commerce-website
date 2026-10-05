const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, findElements } = require('./runtime.cjs');

function image(initialProps) {
  const props = { ...initialProps };
  const runtime = loadPage('src/components/ProductImage.tsx', { renderPage: (Component) => Component(props) });
  return { runtime, props };
}
const img = (tree) => findElements(tree, (element) => element.type === 'img')[0];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' ? tree : '';

test('a broken image shows the fallback and recovers when the URL is corrected', async () => {
  const { runtime, props } = image({ src: 'https://cdn.test/typo.jpg', alt: 'Preview' });
  let tree = await runtime.flush();
  assert.equal(img(tree).props.src, 'https://cdn.test/typo.jpg');
  img(tree).props.onError();
  tree = await runtime.flush();
  assert.equal(img(tree), undefined);
  assert.ok(text(tree).includes('暂无图片'));
  props.src = 'https://cdn.test/fixed.jpg';
  tree = await runtime.flush();
  assert.equal(img(tree).props.src, 'https://cdn.test/fixed.jpg');
});

test('missing images use the fallback instead of requesting a placeholder file', async () => {
  for (const src of [null, undefined, '']) {
    const tree = await image({ src, alt: 'Item' }).runtime.flush();
    assert.equal(img(tree), undefined, String(src));
  }
  // There is no public/ directory, so a hard-coded asset path would be a 404.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  const root = path.resolve(__dirname, '..');
  const publicDir = path.join(root, 'public');
  for (const file of walk(path.join(root, 'src')).filter((name) => /\.tsx?$/.test(name))) {
    for (const [, asset] of fs.readFileSync(file, 'utf8').matchAll(/['"`](\/[\w./-]+\.(?:png|jpe?g|svg|webp|gif))['"`]/g)) {
      assert.ok(fs.existsSync(path.join(publicDir, asset)), `${path.relative(root, file)} references missing ${asset}`);
    }
  }
});
