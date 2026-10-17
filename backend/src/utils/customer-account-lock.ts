import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

export const ACCOUNT_SESSION_EXPIRED = '登录已过期，请重新登录';

/**
 * Takes the customer's row lock, the first lock of every write to their own data
 * (user → address → products → SKUs → coupons), and rechecks the account under it.
 *
 * Authentication ran before this lock. A request that passed it can wait here while account
 * deletion (or an administrator disabling the account) commits; without this recheck it would
 * then recreate a cart line, address or after-sales request on an account that no longer exists.
 */
export async function lockCustomerAccount(
  connection: Pick<PoolConnection, 'execute'>, userId: number,
  failure: (message: string, statusCode: number) => Error,
): Promise<void> {
  const [users] = await connection.execute<RowDataPacket[]>(
    'SELECT status, deleted_at FROM users WHERE user_id = ? FOR UPDATE', [userId]);
  if (!users.length) throw failure('用户不存在', 404);
  if (users[0].deleted_at || Number(users[0].status) !== 1) throw failure(ACCOUNT_SESSION_EXPIRED, 401);
}

/** For single-statement writes: the condition a users join or subquery must hold. */
export const ACTIVE_ACCOUNT = 'status = 1 AND deleted_at IS NULL';
