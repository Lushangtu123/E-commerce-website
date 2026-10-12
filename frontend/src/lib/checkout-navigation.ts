const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** Address management can return only to a cart, optionally its original direct purchase. */
export function safeCheckoutReturn(value: string | null | undefined): string {
  if (value === '/cart') return value;
  const prefix = '/cart?buy_now=';
  return value?.startsWith(prefix) && uuid.test(value.slice(prefix.length)) ? value : '/cart';
}

export function checkoutAddressHref(buyNowId: string | null): string {
  if (!buyNowId || !uuid.test(buyNowId)) return '/profile/address';
  return `/profile/address?return_to=${encodeURIComponent('/cart?buy_now=' + buyNowId)}`;
}

export function addressCheckoutReturn(): string {
  return safeCheckoutReturn(new URLSearchParams(window.location.search).get('return_to'));
}
