import { query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface User {
  user_id: number;
  username: string;
  email: string;
  password_hash: string;
  phone?: string;
  avatar_url?: string;
  created_at: Date;
  updated_at: Date;
}

export class UserModel {
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
      'SELECT user_id, username, email, phone, avatar_url, created_at FROM users WHERE user_id = ?',
      [userId]
    );
    return users.length > 0 ? users[0] : null;
  }

  // 更新用户信息
  static async update(userId: number, updates: Partial<User>): Promise<boolean> {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), userId];
    
    const result = await query<ResultSetHeader>(
      `UPDATE users SET ${fields} WHERE user_id = ?`,
      values
    );
    return result.affectedRows > 0;
  }
}

