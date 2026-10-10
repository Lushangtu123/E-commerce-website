import tls from 'node:tls';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AddressInfo, Socket } from 'node:net';
import * as mail from '../../services/password-mail.service';

let mockPort: number;
let mockCert: Buffer;
let mockTrusted = true;
let mockLastConnection: import('nodemailer/lib/smtp-connection').default;
// Only redirect the network destination to our local TLS fixture; preserve actual SMTP/MIME behavior.
jest.mock('nodemailer/lib/smtp-connection', () => {
  const ActualConnection = jest.requireActual('nodemailer/lib/smtp-connection');
  return { __esModule: true, default: jest.fn(options => mockLastConnection = new ActualConnection({ ...options,
    host: '127.0.0.1', port: mockPort, tls: { ...options.tls, servername: 'localhost',
      ...(mockTrusted ? { ca: mockCert } : {}) },
  })) };
});

const keys = ['EMAIL_PROVIDER', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'APP_URL'];
const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let fixtureDir: string;
let server: tls.Server;
const sockets = new Set<Socket>();
let messages: string[];
let authenticated: boolean;
let stall: 'login' | 'data' | null;
let refusal: 'login' | 'recipient' | 'data' | null;

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'commerce-smtp-test-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    '-keyout', join(fixtureDir, 'key.pem'), '-out', join(fixtureDir, 'cert.pem')], { stdio: 'ignore' });
  mockCert = readFileSync(join(fixtureDir, 'cert.pem'));
});
afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
  keys.forEach(key => {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
});
beforeEach(async () => {
  process.env.EMAIL_PROVIDER = 'gmail'; process.env.GMAIL_USER = 'wire.test@gmail.com';
  process.env.GMAIL_APP_PASSWORD = 'abcdefghijklmnop'; process.env.APP_URL = 'https://shop.example.test';
  mockTrusted = true; messages = []; authenticated = false; stall = null; refusal = null;
  server = tls.createServer({ allowHalfOpen: true, cert: mockCert, key: readFileSync(join(fixtureDir, 'key.pem')) }, socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.write('220 localhost ESMTP fixture\r\n');
    let pending = '';
    let data = false;
    socket.on('data', chunk => {
      pending += chunk.toString();
      while (pending.includes('\r\n')) {
        if (data) {
          const end = pending.indexOf('\r\n.\r\n');
          if (end < 0) break;
          messages.push(pending.slice(0, end)); pending = pending.slice(end + 5); data = false;
          if (stall !== 'data') socket.write(refusal === 'data' ? '450 4.3.0 temporary refusal\r\n' : '250 2.0.0 message accepted\r\n');
          continue;
        }
        const end = pending.indexOf('\r\n');
        const command = pending.slice(0, end); pending = pending.slice(end + 2);
        if (command.startsWith('EHLO')) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (command.startsWith('AUTH PLAIN ')) {
          const decoded = Buffer.from(command.slice(11), 'base64').toString();
          authenticated = decoded === '\0wire.test@gmail.com\0abcdefghijklmnop';
          if (stall !== 'login') socket.write(authenticated && refusal !== 'login' ? '235 2.7.0 authenticated\r\n' : '535 5.7.0 invalid credentials\r\n');
        } else if (command === 'MAIL FROM:<wire.test@gmail.com>' && authenticated) socket.write('250 sender accepted\r\n');
        else if (command === 'RCPT TO:<customer@example.test>' && authenticated) socket.write(refusal === 'recipient' ? '550 5.1.1 recipient refused\r\n' : '250 recipient accepted\r\n');
        else if (command === 'DATA' && authenticated) { data = true; socket.write('354 end with dot\r\n'); }
        else socket.write('550 command rejected\r\n');
      }
    });
  });
  // Failed TLS handshakes never reach secureConnection; track raw sockets too.
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('tlsClientError', (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  mockPort = (server.address() as AddressInfo).port;
});
afterEach(async () => {
  sockets.forEach(socket => socket.destroy());
  await new Promise<void>(resolve => server.close(() => resolve()));
  jest.restoreAllMocks();
});

test('real SMTP authenticates over trusted TLS and sends exactly one reset message', async () => {
  await mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig());
  expect(authenticated).toBe(true);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('From: Store <wire.test@gmail.com>');
  expect(messages[0]).toContain('To: customer@example.test');
  const content = messages[0].replace(/=\r\n/g, '').replace(/=([a-f0-9]{2})/gi,
    (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
  expect(content).toContain(`https://shop.example.test/reset-password#token=${'a'.repeat(64)}`);
  expect(messages[0]).not.toContain('abcdefghijklmnop');
});

test('untrusted TLS certificate prevents authentication and delivery', async () => {
  mockTrusted = false;
  await expect(mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig()))
    .rejects.toThrow('密码找回邮件发送失败');
  expect(authenticated).toBe(false);
  expect(messages).toHaveLength(0);
});

test.each(['login', 'data'] as const)('deadline destroys the actual TLS socket when the peer stalls during %s', async phase => {
  stall = phase;
  await expect(mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig()))
    .rejects.toMatchObject({ message: '密码找回邮件发送失败', deliveryOutcome: 'unknown' });
  expect(authenticated).toBe(true);
  expect(messages).toHaveLength(phase === 'login' ? 0 : 1);
  expect(mockLastConnection._socket).toBeTruthy();
  expect(mockLastConnection._socket && mockLastConnection._socket.destroyed).toBe(true);
}, 8000);

test.each(['login', 'recipient', 'data'] as const)('real SMTP negative completion at %s is a definite refusal', async phase => {
  refusal = phase;
  await expect(mail.sendPasswordResetEmail('customer@example.test', 'a'.repeat(64), mail.passwordMailConfig()))
    .rejects.toMatchObject({ message: '密码找回邮件发送失败', deliveryOutcome: 'rejected' });
  expect(messages).toHaveLength(phase === 'data' ? 1 : 0);
});
