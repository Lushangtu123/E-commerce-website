const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, findElements } = require('./runtime.cjs');

test('product cards disable exhausted base and SKU products when MySQL aggregate stock is a string', async () => {
  for (const has_sku of [true, false]) {
    for (const stock of ['0', 0, '2']) {
      const runtime = loadPage('src/components/ProductCard.tsx', { props: { product: { product_id: 1, title: 'Shirt', price: 15, stock, has_sku } } });
      const tree = await runtime.flush({ isAuthenticated: true });
      const button = findElements(tree, element => element.type === 'button')[0];
      assert.equal(button.props.disabled, Number(stock) === 0, `stock=${stock} / has_sku=${has_sku}`);
    }
  }
});
