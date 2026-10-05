/** Real collection is unavailable until a merchant provider is integrated. */
export function getPaymentSettings(): { mode: 'disabled' | 'demo'; canPay: boolean; isDemo: boolean } {
  const production = process.env.VERCEL_ENV === 'production' ||
    (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV !== 'preview');
  const demo = process.env.PAYMENT_MODE === 'demo' && !production;
  return { mode: demo ? 'demo' : 'disabled', canPay: demo, isDemo: demo };
}
