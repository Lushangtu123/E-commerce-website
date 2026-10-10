import * as mail from '../../services/password-mail.service';

beforeEach(() => {
  process.env.NODE_ENV = 'test'; process.env.RESEND_API_KEY = 're_secret';
  process.env.EMAIL_FROM = 'Shop <support@example.test>'; process.env.APP_URL = 'https://shop.example.test';
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; delete process.env.APP_URL; });

test.each(['http://evil.example.test', 'https://user:password@shop.example.test', 'https://shop.example.test/path',
  'https://shop.example.test/?next=evil', 'https://shop.example.test/#token', 'javascript:alert(1)', 'not-url'])('rejects untrusted APP_URL %p', APP_URL => {
  process.env.APP_URL = APP_URL;
  expect(mail.passwordMailConfig()).toBeNull();
});
test('local development may use http but production must use https', () => {
  process.env.APP_URL = 'http://localhost:3000'; expect(mail.passwordMailConfig()?.appOrigin).toBe('http://localhost:3000');
  process.env.NODE_ENV = 'production'; expect(mail.passwordMailConfig()).toBeNull();
});
test('incomplete or injected email configuration is unavailable', () => {
  process.env.EMAIL_FROM = 'support@example.test\r\nBcc:evil@example.test'; expect(mail.passwordMailConfig()).toBeNull();
  process.env.EMAIL_FROM = 'support@example.test'; delete process.env.RESEND_API_KEY; expect(mail.passwordMailConfig()).toBeNull();
});
test('mail uses official API, bounded timeout, no redirects and a fragment-only trusted link', async () => {
  const transport = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
  await (mail as any).sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig());
  const [url, init] = transport.mock.calls[0];
  expect(url).toBe('https://api.resend.com/emails'); expect(init?.redirect).toBe('error');
  expect(init?.signal).toBeDefined(); expect(init?.headers).toMatchObject({ Authorization: 'Bearer re_secret' });
  const body = JSON.parse(init?.body as string);
  expect(body.to).toEqual(['customer@example.test']);
  expect(body.text).toContain(`https://shop.example.test/reset-password#token=${'a'.repeat(64)}`);
  expect(body.text).toContain('30');
});
test('unconfigured mail never invokes a transport or logs a secret', async () => {
  const transport = jest.spyOn(globalThis, 'fetch');
  await expect((mail as any).sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), null)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

test.each([400, 401, 403, 404, 405, 422, 429])('explicit Resend refusal %i carries a definite rejection outcome without exposing provider data', async status => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status } as Response);
  await expect(mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig()))
    .rejects.toMatchObject({ message: '密码找回邮件发送失败', deliveryOutcome: 'rejected' });
});

test.each([408, 409, 413, 500, 502, 503])('ambiguous Resend response %i keeps the outcome unknown', async status => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status } as Response);
  await expect(mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig()))
    .rejects.toMatchObject({ message: '密码找回邮件发送失败', deliveryOutcome: 'unknown' });
});

test('network timeout has an unknown delivery outcome', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private transport details'));
  await expect(mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig()))
    .rejects.toMatchObject({ message: '密码找回邮件发送失败', deliveryOutcome: 'unknown' });
});
