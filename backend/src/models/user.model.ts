import { query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { normalizeProfile, ProfileUpdates } from '../utils/user-validation';

export interface User {
  user_id: number;
  username: string;
  email: string;
  password_hash: string;
  auth_version?: number;
  phone?: string | null;
  avatar_url?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserStats {
  totalOrders: number;
  pendingOrders: number;
  totalCoupons: number;
  availableCoupons: number;
  favoriteCount: number;
}

export class UserModel {
  static async getAuthVersion(userId: number): Promise<number | null> {
    const rows = await query<RowDataPacket[]>('SELECT auth_version FROM users WHERE user_id = ?', [userId]);
    if (!rows.length) return null;
    const version = rows[0].auth_version;
    if (!Number.isSafeInteger(version) || version < 0) throw new Error('账户认证版本无效');
    return version;
  }

  static async findCredentialsById(userId: number): Promise<Pick<User, 'user_id' | 'password_hash' | 'auth_version'> | null> {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new RangeError('用户ID无效');
    const rows = await query<RowDataPacket[]>('SELECT user_id, password_hash, auth_version FROM users WHERE user_id = ?', [userId]);
    return rows[0] as any ?? null;
  }
  /** One statement gives every scalar count the same read snapshot, without multiplying joined rows. */
  static async getStats(userId: number): Promise<UserStats | null> {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new RangeError('用户ID无效');
    const rows = await query<RowDataPacket[]>(
      `SELECT
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.user_id) AS totalOrders,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.user_id AND o.status = 0) AS pendingOrders,
        (SELECT COUNT(*) FROM user_coupons uc WHERE uc.user_id = u.user_id) AS totalCoupons,
        (SELECT COUNT(*) FROM user_coupons uc JOIN coupons c ON c.coupon_id = uc.coupon_id
         WHERE uc.user_id = u.user_id AND uc.status = 1 AND uc.expired_at > NOW()
           AND c.status = 1 AND c.start_time <= NOW() AND c.end_time > NOW()
           AND c.type IN (1, 2, 3) AND c.discount_value > 0
           AND (c.type <> 2 OR c.discount_value <= 100)
           AND c.min_amount >= 0 AND (c.type <> 3 OR c.min_amount = 0)
           AND (c.max_discount IS NULL OR c.max_discount >= 0)) AS availableCoupons,
        (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.user_id) AS favoriteCount
       FROM users u WHERE u.user_id = ?`, [userId]
    );
    if (!rows.length) return null;
    // Only the five public counters leave this boundary; mysql COUNT values may arrive as strings.
    const keys: Array<keyof UserStats> = ['totalOrders', 'pendingOrders', 'totalCoupons', 'availableCoupons', 'favoriteCount'];
    const stats = {} as UserStats;
    for (const key of keys) {
      const count = Number(rows[0][key]);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('统计计数无效');
      stats[key] = count;
    }
    return stats;
  }

  // 创建用户
  static async create(username: string, email: string, password_hash: string): Promise<number> {
    const result = await query<ResultSetHeader>(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email, password_hash]
    );
    return result.insertId;
  }

  // 根据邮箱查找用户
  static async findByEmail(email: string): Promise<User | null> {
    const users = await query<(User & RowDataPacket)[]>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    return users.length > 0 ? users[0] : null;
  }

  // 根据用户名查找用户
  static async findByUsername(username: string): Promise<User | null> {
    const users = await query<(User & RowDataPacket)[]>(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    return users.length > 0 ? users[0] : null;
  }

  // 根据ID查找用户
  static async findById(userId: number): Promise<User | null> {
    const users = await query<(User & RowDataPacket)[]>(
      'SELECT user_id, username, email, phone, avatar_url, created_at, updated_at FROM users WHERE user_id = ?',
      [userId]
    );
    return users.length > 0 ? users[0] : null;
  }

  // 更新用户信息
  static async update(userId: number, updates: ProfileUpdates): Promise<boolean> {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new RangeError('用户ID无效');
    const allowed = normalizeProfile(updates);
    const fields = Object.keys(allowed).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(allowed), userId];
    
    const result = await query<ResultSetHeader>(
      `UPDATE users SET ${fields} WHERE user_id = ?`,
      values
    );
    return result.affectedRows > 0;
  }
}
