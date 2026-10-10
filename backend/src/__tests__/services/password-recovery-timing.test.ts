jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
import { UserModel } from '../../models/user.model';
import { PasswordResetModel } from '../../models/password-reset.model';
import * as mail from '../../services/password-mail.service';

const service = () => require('../../services/password-recovery.service');
const config = { apiKey: 're_test', from: 'support@example.test', appOrigin: 'https://shop.example.test' };
afterEach(() => jest.restoreAllMocks());

test.each(['known', 'unknown', 'recent', 'provider-failed', 'provider-rejected'])('configured valid %s requests wait out the same recovery response window', async kind => {
  let time = 100;
  const clock = { now: () => time, sleep: jest.fn(async (ms: number) => { time += ms; }) };
  jest.spyOn(UserModel, 'findByEmail').mockImplementation(async () => {
    time += 20; return kind === 'unknown' ? null : { user_id: 7, email: 'customer@example.test' } as any;
  });
  jest.spyOn(PasswordResetModel, 'issue').mockImplementation(async () => {
    time += 15; return kind === 'recent' ? null : { userId: 7, tokenHash: 'a'.repeat(64), authVersion: 0 };
  });
  jest.spyOn(mail, 'sendPasswordResetEmail').mockImplementation(async () => {
    time += 4700;
    if (kind === 'provider-rejected') throw new mail.PasswordMailError('rejected');
    if (kind === 'provider-failed') throw new Error('provider details never escape');
  });
  const recovery = jest.spyOn(PasswordResetModel, 'recoverRejectedIssuance').mockImplementation(async () => { time += 35; return true; });
  await service().requestPasswordRecovery('customer@example.test', config, clock);
  expect(time - 100).toBe(5250);
  expect(clock.sleep).toHaveBeenCalledTimes(1);
  expect(recovery).toHaveBeenCalledTimes(kind === 'provider-rejected' ? 1 : 0);
});

test('late database work does not create an unbounded additional sleep', async () => {
  const sleep = jest.fn().mockResolvedValue(undefined);
  await service().waitForRecoveryWindow(100, { now: () => 12000, sleep });
  expect(sleep).not.toHaveBeenCalled();
});
