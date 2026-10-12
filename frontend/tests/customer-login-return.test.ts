import { describe, expect, it } from 'vitest';
import { customerAuthHref, customerLoginHref, customerReturnPath, safeCustomerReturnPath } from '@/lib/customer-login-return';

describe('customer authentication destinations', () => {
  it.each(['/cart?coupon_id=42&source=my-coupons', '/products/22?sku_id=7', '/orders/12#shipping', '/profile/address', '/products?q=%E6%89%8B%E6%9C%BA'])('preserves the safe destination %s', path => {
    expect(safeCustomerReturnPath(path)).toBe(path);
    window.history.replaceState(null, '', `/login?next=${encodeURIComponent(path)}`);
    expect(customerReturnPath()).toBe(path);
    expect(customerAuthHref('/register', path)).toBe(`/register?next=${encodeURIComponent(path)}`);
  });

  it.each([null, '', 'https://outside.test', '//outside.test', '/\\outside.test', '/%2f%2foutside.test', '/%252f%252foutside.test',
    'javascript:alert(1)', '/login', '/login?next=/cart', '/register', '/admin', '/admin/orders', '/ADMIN/orders', '/%61dmin/orders',
    '/products/../admin', '/products/%2e%2e/admin', '/%2561dmin', '/api/orders', '/orders\n', '/orders%0a', '/%FF', '/x'.repeat(1100),
  ])('falls back to home for unsafe or looping destination %s', path => {
    expect(safeCustomerReturnPath(path)).toBe('/');
    expect(customerAuthHref('/login', path ?? '')).toBe('/login');
    window.history.replaceState(null, '', `/login?next=${encodeURIComponent(path ?? '')}`);
    expect(customerReturnPath()).toBe('/');
  });

  it('captures the live customer pathname and query once for sign-in', () => {
    window.history.replaceState(null, '', '/cart?coupon_id=42&source=my-coupons#address');
    expect(customerLoginHref()).toBe('/login?next=%2Fcart%3Fcoupon_id%3D42%26source%3Dmy-coupons');
    window.history.replaceState(null, '', '/orders/12?tab=tracking');
    expect(customerLoginHref()).toBe('/login?next=%2Forders%2F12%3Ftab%3Dtracking');
  });
});
