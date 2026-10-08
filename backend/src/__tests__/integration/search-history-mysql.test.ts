import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { query } from '../../database/mysql';
import { recordSearch, getUserSearchHistory, getHotKeywords, getSearchSuggestions, deleteSearchKeyword, clearSearchHistory, elasticsearchSearch } from '../../controllers/search.controller';
import { searchProducts } from '../../services/product-search.service';

jest.mock('../../database/mysql', () => ({ query: jest.fn() }));
jest.mock('../../services/product-search.service', () => ({ searchProducts: jest.fn() }));

const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 搜索记录边界和用户归属', () => {
  const database = `search_history_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool;
  let db: Pool;
  let created = false;

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (match[2] === 'users' || match[2] === 'search_history') await db.query(match[1]);
    }
    await db.query(`INSERT INTO users (user_id,username,email,password_hash) VALUES
      (7,'search-a','search-a@example.test','fixture'),(8,'search-b','search-b@example.test','fixture')`);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: unknown[]) => (await db.query(sql, values))[0]);
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (created) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    await db.query('DELETE FROM search_history');
    jest.clearAllMocks();
    (searchProducts as jest.Mock).mockResolvedValue({ products: [], total: 2, engine: 'mysql' });
  });

  async function invoke(handler: (req: AuthRequest, res: Response) => unknown, input: object = {}) {
    let status = 200;
    let body: any;
    const res = { status(code: number) { status = code; return this; }, json(data: unknown) { body = data; return this; } };
    await handler({ user: { userId: 7 }, userId: 7, body: {}, query: {}, params: {}, ...input } as AuthRequest, res as Response);
    return { status, body };
  }

  test('100 字符关键词可保存、读取和删除，修剪后不超出现有字段', async () => {
    const keyword = '中'.repeat(100);
    expect((await invoke(recordSearch, { body: { keyword: `  ${keyword}  `, result_count: 2 } })).status).toBe(200);
    const [rows] = await db.query<RowDataPacket[]>('SELECT keyword,user_id,result_count FROM search_history');
    expect(rows).toEqual([{ keyword, user_id: 7, result_count: 2 }]);
    expect((await invoke(getUserSearchHistory)).body.history).toEqual([expect.objectContaining({ keyword })]);
    expect((await invoke(deleteSearchKeyword, { params: { keyword } })).status).toBe(200);
    const [remaining] = await db.query<RowDataPacket[]>('SELECT id FROM search_history');
    expect(remaining).toHaveLength(0);
  });

  test('非法记录和查询不会访问数据库或制造无效历史行', async () => {
    for (const body of [{ keyword: 123 }, { keyword: ' ' }, { keyword: 'x'.repeat(101) }, { keyword: 'Nike', result_count: -1 }]) {
      expect((await invoke(recordSearch, { body })).status).toBe(400);
    }
    for (const handler of [getUserSearchHistory, getHotKeywords, getSearchSuggestions]) {
      expect((await invoke(handler, { query: { limit: '1000000', keyword: 'Nike' } })).status).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
    const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM search_history');
    expect(rows).toHaveLength(0);
  });

  test('历史归本人所有，热搜和建议的合法查询保持可用', async () => {
    await invoke(recordSearch, { body: { keyword: 'Nike', result_count: 2 } });
    await invoke(recordSearch, { user: { userId: 8 }, userId: 8, body: { keyword: 'Other', result_count: 1 } });
    expect((await invoke(getUserSearchHistory, { query: { limit: '100' } })).body.history.map((row: any) => row.keyword)).toEqual(['Nike']);
    expect((await invoke(getHotKeywords, { query: { days: '365', limit: '100' } })).body.keywords).toHaveLength(2);
    expect((await invoke(getSearchSuggestions, { query: { keyword: ' Ni ', limit: '100' } })).body.suggestions).toEqual(['Nike']);
  });

  test('删除与清空不会删除另一用户的同名关键词', async () => {
    await invoke(recordSearch, { body: { keyword: 'Nike' } });
    await invoke(recordSearch, { user: { userId: 8 }, userId: 8, body: { keyword: 'Nike' } });
    expect((await invoke(deleteSearchKeyword, { params: { keyword: 'Nike' } })).status).toBe(200);
    await invoke(clearSearchHistory);
    const [rows] = await db.query<RowDataPacket[]>('SELECT user_id,keyword FROM search_history');
    expect(rows).toEqual([{ user_id: 8, keyword: 'Nike' }]);
  });

  test('商品搜索也只保存可容纳的关键词，超过边界在查询前返回 400', async () => {
    const keyword = '中'.repeat(100);
    expect((await invoke(elasticsearchSearch, { query: { keyword } })).status).toBe(200);
    const [rows] = await db.query<RowDataPacket[]>('SELECT user_id,keyword,result_count FROM search_history');
    expect(rows).toEqual([{ user_id: 7, keyword, result_count: 2 }]);
    jest.clearAllMocks();
    expect((await invoke(elasticsearchSearch, { query: { keyword: keyword + '中' } })).status).toBe(400);
    expect(searchProducts).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
