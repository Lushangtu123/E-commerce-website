'use client';

import '@/lib/admin-i18n';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { translate, useI18n } from '@/lib/i18n';
import type { AdminTwoFactorSetup } from '@/lib/api';

export type AdminTwoFactorView =
  | { kind: 'verify'; challenge: string }
  | { kind: 'setup'; challenge: string; setup: AdminTwoFactorSetup }
  | { kind: 'recovery'; codes: string[] };

interface Props {
  step: AdminTwoFactorView;
  loading: boolean;
  onSubmitCode: (code: string) => void;
  onFinish: () => void;
  onRestart: () => void;
}

const inputClass = 'block w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono tracking-widest';
const primaryClass = 'w-full bg-primary-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-primary-700 focus:outline-hidden focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed';
const secondaryClass = 'flex-1 border border-gray-300 text-gray-700 py-2 px-3 rounded-lg text-sm hover:bg-gray-50 transition-colors';

/** Renders the otpauth URI locally; the secret never leaves the browser for a QR service. */
function useQrDataUrl(uri: string | null) {
  const [qr, setQr] = useState<{ uri: string; url: string } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    import('qrcode-generator').then(({ default: qrcode }) => {
      const code = qrcode(0, 'M');
      code.addData(uri);
      code.make();
      if (!cancelled) setQr({ uri, url: code.createDataURL(5, 2) });
    }).catch(() => { /* The secret below still lets the administrator bind by hand. */ });
    return () => { cancelled = true; };
  }, [uri]);
  return qr && qr.uri === uri ? qr.url : null;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(translate('已复制'));
  } catch {
    toast.error(translate('复制失败，请手动选择文本复制'));
  }
}

export default function AdminTwoFactorStep({ step, loading, onSubmitCode, onFinish, onRestart }: Props) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const qr = useQrDataUrl(step.kind === 'setup' ? step.setup.otpauth_uri : null);

  if (step.kind === 'recovery') {
    const text = step.codes.join('\n');
    const download = () => {
      const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'admin-recovery-codes.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t('保存恢复码')}</h2>
          <p className="mt-1 text-sm text-gray-600">
            {t('手机丢失或无法使用验证器时，可以用恢复码代替动态码登录。每个恢复码只能使用一次，并且只显示这一次，请保存在安全的地方。')}
          </p>
          <p className="mt-1 text-sm text-gray-600">{t('这组恢复码会替换之前的全部恢复码。')}</p>
        </div>
        <ul aria-label={t('恢复码')} className="grid grid-cols-1 gap-2 p-4 bg-gray-50 border border-gray-200 rounded-lg font-mono text-sm text-gray-900">
          {step.codes.map(value => <li key={value}>{value}</li>)}
        </ul>
        <div className="flex gap-3">
          <button type="button" className={secondaryClass} onClick={() => void copy(text)}>{t('复制恢复码')}</button>
          <button type="button" className={secondaryClass} onClick={download}>{t('下载恢复码')}</button>
        </div>
        <button type="button" className={primaryClass} onClick={onFinish}>{t('我已保存，进入后台')}</button>
      </div>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = code.trim();
    if (value) onSubmitCode(value);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {step.kind === 'setup' ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('绑定验证器')}</h2>
            <p className="mt-1 text-sm text-gray-600">
              {t('管理后台要求两步验证。请用验证器应用（如 Google Authenticator、Microsoft Authenticator）扫描二维码，或手动输入密钥。')}
            </p>
          </div>
          <div className="flex justify-center">
            {qr
              ? <img src={qr} alt={t('验证器二维码')} width={200} height={200} className="w-48 h-48" />
              : <div className="w-48 h-48 bg-gray-100 rounded-lg" aria-hidden="true" />}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">{t('密钥')}</p>
            <div className="mt-1 flex items-center gap-2">
              <code data-testid="totp-secret" className="flex-1 break-all p-2 bg-gray-50 border border-gray-200 rounded-sm text-sm">
                {step.setup.secret.match(/.{1,4}/g)?.join(' ')}
              </code>
              <button type="button" className="text-sm text-primary-600 hover:text-primary-700" onClick={() => void copy(step.setup.secret)}>
                {t('复制')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t('两步验证')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('输入验证器应用中的 6 位动态码，或一个未使用的恢复码。')}</p>
        </div>
      )}
      <div>
        <label htmlFor="admin-two-factor-code" className="block text-sm font-medium text-gray-700 mb-2">{t('验证码')}</label>
        <input
          id="admin-two-factor-code"
          type="text"
          autoComplete="one-time-code"
          inputMode={step.kind === 'setup' ? 'numeric' : 'text'}
          autoFocus
          required
          maxLength={64}
          value={code}
          onChange={event => setCode(event.target.value)}
          className={inputClass}
          placeholder={step.kind === 'setup' ? '123456' : t('动态码或恢复码')}
        />
      </div>
      <button type="submit" disabled={loading} className={primaryClass}>
        {loading ? t('验证中...') : step.kind === 'setup' ? t('完成绑定并登录') : t('验证并登录')}
      </button>
      <div className="text-center">
        <button type="button" disabled={loading} onClick={onRestart} className="text-sm text-gray-600 hover:text-gray-900 disabled:text-gray-400">
          {t('返回重新输入密码')}
        </button>
      </div>
    </form>
  );
}
