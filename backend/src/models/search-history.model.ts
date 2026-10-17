import { getPool, query } from '../database/mysql';
import { ACTIVE_ACCOUNT } from '../utils/customer-account-lock';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface SearchHistory {
  id: number;
  user_id?: number;
  keyword: string;
  result_count: number;
  created_at: Date;
}

export class SearchHistoryModel {
  // 添加搜索记录
  static async add(keyword: string, userId?: number, resultCount: number = 0): Promise<number> {
    const insert = 'INSERT INTO search_history (user_id, keyword, result_count) VALUES (?, ?, ?)';
    if (!userId) return (await query<ResultSetHeader>(insert, [null, keyword, resultCount])).insertId;
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      // Under the account lock: a search that waited out account deletion is kept only anonymously.
      const [users] = await connection.execute<RowDataPacket[]>(
        `SELECT user_id FROM users WHERE user_id = ? AND ${ACTIVE_ACCOUNT} FOR UPDATE`, [userId]);
      const [result] = await connection.execute<ResultSetHeader>(insert, [users.length ? userId : null, keyword, resultCount]);
      await connection.commit();
      return result.insertId;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  // 获取用户搜索历史（最近10条）
  static async getUserHistory(userId: number, limit: number = 10): Promise<SearchHistory[]> {
    const results = await query<(SearchHistory & RowDataPacket)[]>(
      `SELECT DISTINCT keyword, MAX(created_at) as created_at
       FROM search_history
       WHERE user_id = ?
       GROUP BY keyword
       ORDER BY MAX(created_at) DESC
       LIMIT ?`,
      [userId, limit]
    );
    return results;
  }

  // 获取热搜关键词（最近7天，按搜索次数排序）
  static async getHotKeywords(days: number = 7, limit: number = 10): Promise<any[]> {
    const results = await query<RowDataPacket[]>(
      `SELECT 
        keyword,
        COUNT(*) as search_count,
        SUM(result_count) as total_results
       FROM search_history
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY keyword
       ORDER BY search_count DESC
       LIMIT ?`,
      [days, limit]
    );
    return results;
  }

  // 清除用户搜索历史
  static async clearUserHistory(userId: number): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'DELETE FROM search_history WHERE user_id = ?',
      [userId]
    );
    return result.affectedRows > 0;
  }

  // 删除单条搜索记录
  static async deleteKeyword(userId: number, keyword: string): Promise<boolean> {
    const result = await query<ResultSetHeader>(
      'DELETE FROM search_history WHERE user_id = ? AND keyword = ?',
      [userId, keyword]
    );
    return result.affectedRows > 0;
  }

  // 获取搜索建议（模糊匹配）
  static async getSuggestions(keyword: string, limit: number = 5): Promise<string[]> {
    const results = await query<RowDataPacket[]>(
      `SELECT DISTINCT keyword, COUNT(*) as count
       FROM search_history
       WHERE keyword LIKE ? ESCAPE '!'
       GROUP BY keyword
       ORDER BY count DESC
       LIMIT ?`,
      [`%${keyword.replace(/[!%_]/g, '!$&')}%`, limit]
    );
    return results.map(r => r.keyword);
  }
}

