import { getPool } from '../database/mysql';
import { RowDataPacket } from 'mysql2';
import { BrowseHistoryModel } from '../models/browse-history.model';
import { customerProducts } from '../models/product.model';

interface Product extends RowDataPacket {
  product_id: number; title: string; title_en?: string | null; price: number; category_id: number;
  sales_count: number; main_image: string; stock: number;
}
const source = `(${customerProducts}) AS products`;
const placeholders = (ids: number[]) => ids.map(() => '?').join(',');
const boundedLimit = (limit: number) => Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;

async function hotProducts(limit: number, excluded: number[] = []): Promise<Product[]> {
  const [rows] = await getPool().query<Product[]>(
    `SELECT * FROM ${source} WHERE status=1 AND stock>0
     ${excluded.length ? `AND product_id NOT IN (${placeholders(excluded)})` : ''}
     ORDER BY sales_count DESC, created_at DESC, product_id DESC LIMIT ?`, [...excluded, boundedLimit(limit)]);
  return rows;
}

export async function getRecommendationsByBrowseHistory(userId: number, limit = 10): Promise<Product[]> {
  limit = boundedLimit(limit);
  const browsed = await BrowseHistoryModel.getRecentProductIds(userId, 20);
  if (!browsed.length) return hotProducts(limit);
  const [rows] = await getPool().query<Product[]>(
    `SELECT * FROM ${source} WHERE status=1 AND stock>0
     AND category_id IN (SELECT DISTINCT category_id FROM products WHERE product_id IN (${placeholders(browsed)}))
     AND product_id NOT IN (${placeholders(browsed)})
     ORDER BY sales_count DESC, created_at DESC, product_id DESC LIMIT ?`, [...browsed, ...browsed, limit]);
  if (rows.length < limit) rows.push(...await hotProducts(limit - rows.length, [...browsed, ...rows.map(p => p.product_id)]));
  return rows;
}

export async function getRelatedProducts(productId: number, limit = 10): Promise<Product[]> {
  limit = boundedLimit(limit);
  const [current] = await getPool().query<Product[]>(`SELECT * FROM ${source} WHERE product_id=? AND status=1`, [productId]);
  if (!current.length) return [];
  const [rows] = await getPool().query<Product[]>(
    `SELECT * FROM ${source} WHERE category_id=? AND product_id<>? AND status=1 AND stock>0
     ORDER BY ABS(price-?), sales_count DESC, product_id DESC LIMIT ?`,
    [current[0].category_id, productId, current[0].price, limit]);
  return rows;
}

export async function getNewUserRecommendations(limit = 10): Promise<Product[]> { return hotProducts(limit); }
export async function getGuessYouLike(userId: number | null, limit = 10): Promise<Product[]> {
  return userId ? getRecommendationsByBrowseHistory(userId, limit) : hotProducts(limit);
}
