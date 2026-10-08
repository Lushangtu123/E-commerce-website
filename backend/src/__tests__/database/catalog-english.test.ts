import fs from 'fs';
import path from 'path';

test('纯英文目录恰好覆盖seed现有商品，标题和描述可用于新插入及受控回填', () => {
  const { catalogEnglish } = require('../../database/catalog-english');
  // Read source data only: importing seed would bring database dependencies into a translation lookup.
  const source = fs.readFileSync(path.join(__dirname, '../../database/seed.ts'), 'utf8');
  const productSource = source.match(/export const products = \[([\s\S]*?)\n\];/)![1];
  const titles = [...productSource.matchAll(/title:\s*'([^']+)'/g)].map(match => match[1]);
  expect(Object.keys(catalogEnglish).sort()).toEqual(titles.sort());
  expect(titles).toHaveLength(10);
  for (const entry of Object.values(catalogEnglish) as Array<{ title_en: string; description_en: string }>) {
    expect(entry.title_en.length).toBeGreaterThan(0);
    expect(entry.title_en.length).toBeLessThanOrEqual(200);
    expect(entry.description_en.length).toBeGreaterThan(0);
  }
  expect(catalogEnglish['新鲜进口车厘子 2斤装'].title_en).toBe('Fresh Imported Cherries, 1kg');
});
