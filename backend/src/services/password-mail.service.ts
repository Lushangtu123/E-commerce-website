import SMTPConnection from 'nodemailer/lib/smtp-connection';
import MailComposer from 'nodemailer/lib/mail-composer';

interface ResendMailConfig { provider?: 'resend'; apiKey: string; from: string; appOrigin: string }
interface GmailMailConfig { provider: 'gmail'; user: string; appPassword: string; from: string; appOrigin: string }
export type PasswordMailConfig = ResendMailConfig | GmailMailConfig;
export const PASSWORD_MAIL_TIMEOUT_MS = 5000;

/** Only a definite refusal permits replacing a possibly delivered reset link. */
export class PasswordMailError extends Error {
  constructor(readonly deliveryOutcome: 'rejected' | 'unknown', message = '密码找回邮件发送失败') {
    super(message);
    this.name = 'PasswordMailError';
  }
}

/** Links are constructed only from operator configuration, never request Host/Origin headers. */
export function passwordMailConfig(): PasswordMailConfig | null {
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) return null;
  try {
    const url = new URL(appUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && process.env.NODE_ENV !== 'production')) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    const provider = process.env.EMAIL_PROVIDER?.trim() || 'resend';
    if (provider === 'gmail') {
      const rawUser = process.env.GMAIL_USER || '';
      const rawPassword = process.env.GMAIL_APP_PASSWORD || '';
      if (/[\r\n]/.test(rawUser + rawPassword)) return null;
      const user = rawUser.trim().toLowerCase();
      const appPassword = rawPassword.replace(/ /g, '');
      if (!/^[a-z0-9][a-z0-9.]{0,63}@gmail\.com$/.test(user) || !/^[a-zA-Z0-9]{16}$/.test(appPassword)) return null;
      return { provider, user, appPassword, from: `Store <${user}>`, appOrigin: url.origin };
    }
    if (provider !== 'resend') return null;
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    if (!apiKey || !from || /[\r\n]/.test(apiKey + from) || from.length > 254) return null;
    if (!/^(?:[^<>\r\n]+\s*<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from)) return null;
    return { apiKey, from, appOrigin: url.origin };
  } catch { return null; }
}

async function sendGmailResetEmail(email: string, text: string, config: GmailMailConfig): Promise<void> {
  // The deadline prevents late SMTP callbacks; in-flight DNS may still finish.
  const connection = new SMTPConnection({
    host: 'smtp.gmail.com', port: 465, secure: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    logger: false, debug: false,
    connectionTimeout: PASSWORD_MAIL_TIMEOUT_MS, greetingTimeout: PASSWORD_MAIL_TIMEOUT_MS,
    socketTimeout: PASSWORD_MAIL_TIMEOUT_MS, dnsTimeout: PASSWORD_MAIL_TIMEOUT_MS,
  });
  const message = new MailComposer({ from: { name: 'Store', address: config.user }, to: { address: email },
    subject: '重置商城密码 / Reset your store password', text }).compile();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('SMTP deadline exceeded')), PASSWORD_MAIL_TIMEOUT_MS);
    function finish(error?: Error | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Nodemailer 10 close() only half-closes connected sockets. Its pinned,
      // typed socket handle must also be destroyed to release it on a stalled peer.
      const socket = connection._socket;
      connection.close();
      if (socket) socket.destroy();
      if (error) {
        const responseCode = (error as Error & { responseCode?: number }).responseCode;
        reject(error instanceof PasswordMailError ? error : new PasswordMailError(
          Number.isInteger(responseCode) && responseCode! >= 400 && responseCode! <= 599 ? 'rejected' : 'unknown'
        ));
      }
      else resolve();
    }
    connection.on('error', finish);
    connection.once('end', () => finish(new Error('SMTP connection ended')));
    connection.connect(error => {
      if (settled) return;
      if (error) return finish(error);
      connection.login({ user: config.user, pass: config.appPassword }, error => {
        if (settled) return;
        if (error) return finish(error);
        connection.send({ from: config.user, to: [email] }, message.createReadStream(), (error, info) => {
          if (error) return finish(error);
          finish(info?.accepted.includes(email) ? null : new PasswordMailError('rejected'));
        });
      });
    });
  });
}

export async function sendPasswordResetEmail(email: string, token: string, config: PasswordMailConfig | null): Promise<void> {
  if (!config || !/^[a-f0-9]{64}$/.test(token) || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)) {
    throw new PasswordMailError('rejected', '密码找回邮件服务暂不可用');
  }
  // A fragment avoids putting the bearer secret in web server URLs and Referer headers.
  const link = `${config.appOrigin}/reset-password#token=${token}`;
  const text = `请在30分钟内打开以下链接重置密码，链接只能使用一次。如果不是您发起的请求，请忽略此邮件。\n\nOpen this single-use link within 30 minutes to reset your password. Ignore this email if you did not request it.\n\n${link}`;
  try {
    if (config.provider === 'gmail') return await sendGmailResetEmail(email, text, config);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(PASSWORD_MAIL_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [email], subject: '重置商城密码 / Reset your store password',
        text }),
    });
    // Refusal/validation responses cannot have accepted this request. Timeouts,
    // in-flight conflicts and server errors may follow acceptance, so stay conservative.
    if (!response.ok) throw new PasswordMailError(
      [400, 401, 403, 404, 405, 422, 429].includes(response.status) ? 'rejected' : 'unknown'
    );
  } catch (error) {
    throw error instanceof PasswordMailError ? error : new PasswordMailError('unknown');
  }
}
