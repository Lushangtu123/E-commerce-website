import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import * as mail from '../../services/password-mail.service';

// Isolate the external SMTP connection; keep the MIME composer real.
const mockConnect = jest.fn();
const mockLogin = jest.fn();
const mockSend = jest.fn();
const mockClose = jest.fn();
let mockConnection: EventEmitter;
const mockConstruct = jest.fn();
jest.mock('nodemailer/lib/smtp-connection', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((options) => {
    mockConstruct(options);
    mockConnection = Object.assign(new EventEmitter(), {
      connect: mockConnect, login: mockLogin, send: mockSend, close: mockClose,
    });
    return mockConnection;
  }),
}), { virtual: true });

const envKeys = ['EMAIL_PROVIDER', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'RESEND_API_KEY', 'EMAIL_FROM', 'APP_URL'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
beforeEach(() => {
  jest.clearAllMocks();
  envKeys.forEach(key => delete process.env[key]);
  process.env.EMAIL_PROVIDER = 'gmail';
  process.env.GMAIL_USER = 'shop.test@gmail.com';
  process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop';
  process.env.APP_URL = 'https://shop.example.test';
  mockConnect.mockImplementation(callback => callback());
  mockLogin.mockImplementation((_auth, callback) => callback(null, true));
  mockSend.mockImplementation((_envelope, _message, callback) => callback(null, { accepted: ['customer@example.test'], rejected: [] }));
  mockClose.mockImplementation(() => mockConnection.emit('end'));
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  envKeys.forEach(key => {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
});

test('Gmail configuration works without a Resend key or domain and normalizes the app password', () => {
  expect(mail.passwordMailConfig()).toEqual({ provider: 'gmail', user: 'shop.test@gmail.com',
    appPassword: 'abcdefghijklmnop', from: 'Store <shop.test@gmail.com>', appOrigin: 'https://shop.example.test' });
});

test('a 16-character alphanumeric app password remains usable', () => {
  process.env.GMAIL_APP_PASSWORD = 'abcd1234efgh5678';
  expect(mail.passwordMailConfig()).toMatchObject({ appPassword: 'abcd1234efgh5678' });
});

test.each([
  ['GMAIL_USER', ''], ['GMAIL_USER', 'shop@example.test'], ['GMAIL_USER', 'shop@gmail.com\r\nBcc:evil@example.test'],
  ['GMAIL_APP_PASSWORD', ''], ['GMAIL_APP_PASSWORD', 'ordinary-password'],
  ['GMAIL_APP_PASSWORD', 'abcd\nefghijklmnop'], ['EMAIL_PROVIDER', 'unknown'],
  ['APP_URL', 'https://shop.example.test/path'], ['APP_URL', 'https://user:password@shop.example.test'],
])('invalid %s configuration disables recovery even if Resend is configured', (key, value) => {
  process.env.RESEND_API_KEY = 're_test'; process.env.EMAIL_FROM = 'support@example.test';
  process.env[key] = value;
  expect(mail.passwordMailConfig()).toBeNull();
});

test('Gmail SMTP requires verified TLS, disables protocol logs and closes after sending', async () => {
  await mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig());
  expect(mockConstruct).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.gmail.com', port: 465, secure: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }, logger: false, debug: false,
    connectionTimeout: mail.PASSWORD_MAIL_TIMEOUT_MS, greetingTimeout: mail.PASSWORD_MAIL_TIMEOUT_MS,
    socketTimeout: mail.PASSWORD_MAIL_TIMEOUT_MS, dnsTimeout: mail.PASSWORD_MAIL_TIMEOUT_MS }));
  expect(mockLogin).toHaveBeenCalledWith({ user: 'shop.test@gmail.com', pass: 'abcdefghijklmnop' }, expect.any(Function));
  expect(mockSend.mock.calls[0][0]).toEqual({ from: 'shop.test@gmail.com', to: ['customer@example.test'] });
  expect(mockClose).toHaveBeenCalledTimes(1);
});

test('real MIME message contains only the trusted reset link and no SMTP credential', async () => {
  let messageBytes = '';
  mockSend.mockImplementation(async (_envelope, message: Readable, callback) => {
    for await (const chunk of message) messageBytes += chunk.toString();
    callback(null, { accepted: ['customer@example.test'], rejected: [] });
  });
  await mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig());
  const text = messageBytes.split('\r\n\r\n').slice(1).join('\r\n\r\n')
    .replace(/=\r\n/g, '').replace(/=([a-f0-9]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
  expect(text).toContain(`https://shop.example.test/reset-password#token=${'a'.repeat(64)}`);
  expect(messageBytes).toContain('To: customer@example.test');
  expect(messageBytes).toContain('From: Store <shop.test@gmail.com>');
  expect(messageBytes).not.toContain('abcdefghijklmnop');
});

test.each(['connect', 'login', 'send', 'end'])('%s failure closes the connection and hides provider details', async phase => {
  const secret = new Error('private credential and recipient details');
  if (phase === 'connect') mockConnect.mockImplementation(callback => callback(secret));
  if (phase === 'login') mockLogin.mockImplementation((_auth, callback) => callback(secret));
  if (phase === 'send') mockSend.mockImplementation((_envelope, _message, callback) => callback(secret));
  if (phase === 'end') mockConnect.mockImplementation(() => mockConnection.emit('end'));
  const logger = jest.spyOn(console, 'log');
  await expect(mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig()))
    .rejects.toThrow('密码找回邮件发送失败');
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(logger).not.toHaveBeenCalled();
});

test.each(['connect', 'login', 'send'])('whole %s deadline closes SMTP and prevents late delivery', async phase => {
  jest.useFakeTimers();
  let lateCallback: Function = () => {};
  if (phase === 'connect') mockConnect.mockImplementation(callback => { lateCallback = callback; });
  if (phase === 'login') mockLogin.mockImplementation((_auth, callback) => { lateCallback = callback; });
  if (phase === 'send') mockSend.mockImplementation((_envelope, _message, callback) => { lateCallback = callback; });
  const attempt = mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig());
  const result = expect(attempt).rejects.toThrow('密码找回邮件发送失败');
  await jest.advanceTimersByTimeAsync(mail.PASSWORD_MAIL_TIMEOUT_MS);
  await result;
  lateCallback(null, { accepted: ['customer@example.test'] });
  expect(mockClose).toHaveBeenCalledTimes(1);
  if (phase === 'connect') expect(mockLogin).not.toHaveBeenCalled();
  if (phase !== 'send') expect(mockSend).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('recipient rejection is not reported as a successful send', async () => {
  mockSend.mockImplementation((_envelope, _message, callback) => callback(null, { accepted: [], rejected: ['customer@example.test'] }));
  await expect(mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig())).rejects.toThrow();
  expect(mockClose).toHaveBeenCalledTimes(1);
});

test.each([421, 450, 535, 550])('an SMTP negative reply %i is definite rejection', async responseCode => {
  mockSend.mockImplementation((_envelope, _message, callback) => callback(Object.assign(new Error('private SMTP details'), { responseCode })));
  await expect(mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig()))
    .rejects.toMatchObject({ message: '密码找回邮件发送失败', deliveryOutcome: 'rejected' });
});

test('a completed recipient rejection is definite while a generic socket error is unknown', async () => {
  mockSend.mockImplementation((_envelope, _message, callback) => callback(null, { accepted: [], rejected: ['customer@example.test'] }));
  await expect(mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig()))
    .rejects.toMatchObject({ deliveryOutcome: 'rejected' });
  mockSend.mockImplementation((_envelope, _message, callback) => callback(new Error('socket dropped after DATA')));
  await expect(mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig()))
    .rejects.toMatchObject({ deliveryOutcome: 'unknown' });
});

test.each(['customer@example.test\r\nBcc:evil@example.test', 'customer@example.test,evil@example.test'])('invalid recipient %p never opens SMTP', async recipient => {
  await expect(mail.sendPasswordResetEmail(recipient, 'a'.repeat(64), mail.passwordMailConfig())).rejects.toThrow();
  expect(mockConstruct).not.toHaveBeenCalled();
});
