const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const sources = walk(path.join(root, 'src')).filter((file) => file.endsWith('.tsx')).map((file) => [path.relative(root, file), fs.readFileSync(file, 'utf8')]);

test('every form control has an accessible name', () => {
  const unlabelled = [];
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/<(input|select|textarea)\b([^<]*?)\/?>/gs)) {
      const attributes = match[2];
      if (/aria-label|\bid=|type="hidden"/.test(attributes)) continue;
      const before = source.slice(Math.max(0, match.index - 300), match.index);
      if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue; // wrapped in its label
      unlabelled.push(`${file}:${source.slice(0, match.index).split('\n').length} <${match[1]}>`);
    }
  }
  assert.deepEqual(unlabelled, []);
});

test('every label htmlFor points at a control id in the same file', () => {
  const dangling = [];
  for (const [file, source] of sources) {
    const ids = new Set([...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    for (const [, target] of source.matchAll(/htmlFor="([^"]+)"/g)) if (!ids.has(target)) dangling.push(`${file} ${target}`);
  }
  assert.deepEqual(dangling, []);
});
