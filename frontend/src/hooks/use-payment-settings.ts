'use client';

import { useEffect, useState } from 'react';
import { paymentApi } from '@/lib/api';

// A failure or partial response must never enable the demonstration mutation.
export function usePaymentSettings(enabled = true) {
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) { setDemo(false); setLoading(true); return; }
    let active = true;
    (async () => {
      try {
        const settings = await paymentApi.getSettings();
        if (active) setDemo(settings.mode === 'demo' && settings.canPay === true && settings.isDemo === true);
      } catch { if (active) setDemo(false); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [enabled]);
  return { canPay: demo && !loading, isDemo: demo, loading };
}
