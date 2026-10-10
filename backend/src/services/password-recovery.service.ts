import { createHash, randomBytes } from 'crypto';
import { UserModel } from '../models/user.model';
import { PasswordResetModel } from '../models/password-reset.model';
import { PasswordMailConfig, PasswordMailError, PASSWORD_MAIL_TIMEOUT_MS, sendPasswordResetEmail } from './password-mail.service';
import logger from '../utils/logger';

export interface RecoveryClock { now(): number; sleep(milliseconds: number): Promise<void> }
export const passwordRecoveryClock: RecoveryClock = {
  now: () => performance.now(),
  sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
};

export async function waitForRecoveryWindow(startedAt: number, clock: RecoveryClock = passwordRecoveryClock): Promise<void> {
  const remaining = PASSWORD_MAIL_TIMEOUT_MS + 250 - (clock.now() - startedAt);
  if (remaining > 0) await clock.sleep(remaining);
}

export async function requestPasswordRecovery(email: string, config: PasswordMailConfig, clock: RecoveryClock = passwordRecoveryClock): Promise<void> {
  const startedAt = clock.now();
  try {
    const user = await UserModel.findByEmail(email);
    if (!user) return;
    const token = randomBytes(32).toString('hex');
    const issued = await PasswordResetModel.issue(user.user_id, createHash('sha256').update(token).digest('hex'));
    if (issued) {
      try { await sendPasswordResetEmail(user.email, token, config); }
      catch (error) {
        if (error instanceof PasswordMailError && error.deliveryOutcome === 'rejected') {
          await PasswordResetModel.recoverRejectedIssuance(issued);
        }
        logger.warn('密码找回邮件发送失败');
      }
    }
  } catch {
    // Unknown, throttled and failed deliveries share the same public response.
    logger.error('密码找回请求处理失败');
  } finally {
    // Five requests/IP/15 minutes bound this wait. Normalize ordinary known/unknown timing;
    // abnormally slow database work can still differ, so this is not a complete timing defense.
    await waitForRecoveryWindow(startedAt, clock);
  }
}
