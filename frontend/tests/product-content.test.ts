import { describe, expect, it } from 'vitest';
import { localizedText, localizedSpecs, specSummary } from '@/lib/product-content';

describe('product content languages', () => {
  it('uses English only when it is provided and follows the selected language', () => {
    expect(localizedText('棉质衬衫', 'Cotton shirt', 'en')).toBe('Cotton shirt');
    expect(localizedText('棉质衬衫', 'Cotton shirt', 'zh-CN')).toBe('棉质衬衫');
    for (const missing of [undefined, null, '', '   ']) expect(localizedText('棉质衬衫', missing, 'en')).toBe('棉质衬衫');
    expect(localizedText(null, null, 'en')).toBe('');
  });

  it('translates each original attribute independently and retains typed values and ordering', () => {
    const specs = { 颜色: '红色', 尺寸: 42, 防水: false, 材质: '棉' };
    const translations = { 颜色: { name: 'Color', value: 'Red' }, 尺寸: { name: 'Size', value: 'invalid override' }, 防水: { name: 'Waterproof' }, 不存在: { name: 'Unused', value: 'Ignored' } };
    expect(localizedSpecs(specs, translations, 'en')).toEqual([['Color', 'Red'], ['Size', 42], ['Waterproof', false], ['材质', '棉']]);
    expect(localizedSpecs(specs, translations, 'zh-CN')).toEqual(Object.entries(specs));
    expect(specSummary(specs, translations, 'en')).toBe('Color: Red / Size: 42 / Waterproof: false / 材质: 棉');
    expect(specSummary(null, null, 'en')).toBe('');
  });

  it('does not interpret product text as a UI dictionary entry or HTML', () => {
    expect(localizedText('首页', null, 'en')).toBe('首页');
    expect(localizedText('商品', '<script>literal</script>', 'en')).toBe('<script>literal</script>');
  });
});
