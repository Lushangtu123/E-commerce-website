import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { expect, it } from 'vitest';

// A source scan: it covers every form, including ones no other test renders.
const root = resolve(__dirname, '..');
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const sources = walk(join(root, 'src')).filter(file => file.endsWith('.tsx')).map(file => [relative(root, file), readFileSync(file, 'utf8')] as const);

it('gives every form control an accessible name', () => {
  const unlabelled: string[] = [];
  for (const [file, source] of sources) {
    for (const match of Array.from(source.matchAll(/<(input|select|textarea)\b([^<]*?)\/?>/g))) {
      if (/aria-label|\bid=|type="hidden"/.test(match[2])) continue;
      const index = match.index ?? 0;
      const before = source.slice(Math.max(0, index - 300), index);
      if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue; // wrapped in its label
      unlabelled.push(`${file}:${source.slice(0, index).split('\n').length} <${match[1]}>`);
    }
  }
  expect(unlabelled).toEqual([]);
});

it('points every label htmlFor at a control id in the same file', () => {
  const dangling: string[] = [];
  for (const [file, source] of sources) {
    const ids = new Set(Array.from(source.matchAll(/\bid="([^"]+)"/g), match => match[1]));
    for (const [, target] of Array.from(source.matchAll(/htmlFor="([^"]+)"/g))) if (!ids.has(target)) dangling.push(`${file} ${target}`);
  }
  expect(dangling).toEqual([]);
});
