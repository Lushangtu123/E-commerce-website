import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import ProductImage from '@/components/ProductImage';

it('shows the fallback for a broken image and recovers when the URL is corrected', () => {
  const view = render(<ProductImage src="https://cdn.test/typo.jpg" alt="Preview" />);
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.test/typo.jpg');

  fireEvent.error(screen.getByRole('img'));
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText('暂无图片')).toBeInTheDocument();

  view.rerender(<ProductImage src="https://cdn.test/fixed.jpg" alt="Preview" />);
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.test/fixed.jpg');
});

it('loads only the priority image eagerly and first', () => {
  const lazy = render(<ProductImage src="https://cdn.test/a.jpg" alt="A" />);
  expect(lazy.container.querySelector('img')).toHaveAttribute('loading', 'lazy');
  expect(lazy.container.querySelector('img')).toHaveAttribute('fetchpriority', 'auto');
  lazy.unmount();

  const first = render(<ProductImage src="https://cdn.test/a.jpg" alt="A" priority />);
  expect(first.container.querySelector('img')).toHaveAttribute('loading', 'eager');
  expect(first.container.querySelector('img')).toHaveAttribute('fetchpriority', 'high');
});

it.each([null, undefined, ''])('uses the fallback instead of requesting an image for src=%s', (src) => {
  render(<ProductImage src={src} alt="Item" />);
  expect(document.querySelector('img')).toBeNull();
});

it('references only image assets that exist in public/', () => {
  // A hard-coded path to a file that is not in public/ would be a 404.
  const root = resolve(__dirname, '..');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  const missing: string[] = [];
  for (const file of walk(join(root, 'src')).filter(name => /\.tsx?$/.test(name))) {
    for (const [, asset] of Array.from(readFileSync(file, 'utf8').matchAll(/['"`](\/[\w./-]+\.(?:png|jpe?g|svg|webp|gif))['"`]/g))) {
      if (!existsSync(join(root, 'public', asset))) missing.push(`${relative(root, file)} references ${asset}`);
    }
  }
  expect(missing).toEqual([]);
});
