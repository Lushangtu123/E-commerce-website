export interface PasswordMailConfig { apiKey: string; from: string; appOrigin: string }
export const PASSWORD_MAIL_TIMEOUT_MS = 5000;

/** Links are constructed only from operator configuration, never request Host/Origin headers. */
export function passwordMailConfig(): PasswordMailConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const appUrl = process.env.APP_URL?.trim();
  if (!apiKey || !from || !appUrl || /[\r\n]/.test(apiKey + from) || from.length > 254) return null;
  if (!/^(?:[^<>\r\n]+\s*<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from)) return null;
  try {
    const url = new URL(appUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && process.env.NODE_ENV !== 'production')) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return { apiKey, from, appOrigin: url.origin };
  } catch { return null; }
}

export async function sendPasswordResetEmail(email: string, token: string, config: PasswordMailConfig | null): Promise<void> {
  if (!config || !/^[a-f0-9]{64}$/.test(token)) throw new Error('密码找回邮件服务暂不可用');
  // A fragment avoids putting the bearer secret in web server URLs and Referer headers.
  const link = `${config.appOrigin}/reset-password#token=${token}`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(PASSWORD_MAIL_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [email], subject: '重置商城密码 / Reset your store password',
        text: `请在30分钟内打开以下链接重置密码，链接只能使用一次。如果不是您发起的请求，请忽略此邮件。\n\nOpen this single-use link within 30 minutes to reset your password. Ignore this email if you did not request it.\n\n${link}` }),
    });
    if (!response.ok) throw new Error('邮件发送失败');
  } catch { throw new Error('密码找回邮件发送失败'); }
}
