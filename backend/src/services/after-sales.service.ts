import Joi from 'joi';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import { getPool } from '../database/mysql';
import { OrderStatus } from '../models/order.model';

export class AfterSalesError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}
export type AfterSalesStatus = 'requested' | 'approved' | 'rejected' | 'withdrawn';
export interface AfterSalesRequest extends RowDataPacket {
  request_id: number;
  order_id: number;
  user_id: number;
  type: 'refund' | 'return';
  reason: string;
  status: AfterSalesStatus;
  review_note: string | null;
  reviewed_by: number | null;
  created_at: Date;
  updated_at: Date;
  reviewed_at: Date | null;
  withdrawn_at: Date | null;
}
const text = Joi.string().trim().min(1).max(500).pattern(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]*$/).required();
const requestSchema = Joi.object({ type: Joi.string().valid('refund', 'return').required(), reason: text }).unknown(false).required();
const reviewSchema = Joi.object({ status: Joi.string().valid('approved', 'rejected').required(), note: text }).unknown(false).required();
const positiveInteger = (max: number) => Joi.string().pattern(/^[1-9]\d*$/).custom((value: string, helpers) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= max ? number : helpers.error('any.invalid');
});
const listSchema = Joi.object({
  page: positiveInteger(1000000).default(1), limit: positiveInteger(100).default(20),
  status: Joi.string().valid('requested', 'approved', 'rejected', 'withdrawn'),
}).unknown(false).prefs({ convert: false });
export function validAfterSalesId(id: unknown): id is number {
  return Number.isSafeInteger(id) && Number(id) > 0;
}
function validateIds(...ids: number[]) {
  if (ids.some(id => !validAfterSalesId(id))) throw new AfterSalesError('售后查询参数无效');
}
async function ownedOrder(connection: Pick<PoolConnection, 'execute'>, userId: number, orderId: number, lock: boolean) {
  const [orders] = await connection.execute<RowDataPacket[]>(
    `SELECT order_id, user_id, status FROM orders WHERE order_id = ?${lock ? ' FOR UPDATE' : ''}`, [orderId]
  );
  if (!orders[0] || orders[0].user_id !== userId) throw new AfterSalesError('订单不存在或不属于当前用户', 404);
  return orders[0];
}
async function requestForOrder(connection: Pick<PoolConnection, 'execute'>, orderId: number, lock: boolean) {
  const [requests] = await connection.execute<AfterSalesRequest[]>(
    `SELECT * FROM after_sales_requests WHERE order_id = ?${lock ? ' FOR UPDATE' : ''}`, [orderId]
  );
  return requests[0] ?? null;
}
async function inTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function getAfterSales(userId: number, orderId: number): Promise<AfterSalesRequest | null> {
  validateIds(userId, orderId);
  const pool = getPool();
  await ownedOrder(pool, userId, orderId, false);
  return requestForOrder(pool, orderId, false);
}

export async function createAfterSales(userId: number, orderId: number, input: unknown): Promise<AfterSalesRequest> {
  validateIds(userId, orderId);
  const { error, value } = requestSchema.validate(input);
  if (error) throw new AfterSalesError('售后类型或申请原因无效');
  return inTransaction(async connection => {
    // Every mutation takes the order lock before the request lock, including admin review.
    const order = await ownedOrder(connection, userId, orderId, true);
    if (![OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.COMPLETED].includes(order.status)) {
      throw new AfterSalesError('当前订单状态不允许申请售后');
    }
    if (await requestForOrder(connection, orderId, true)) throw new AfterSalesError('该订单已提交过售后申请', 409);
    await connection.execute(
      `INSERT INTO after_sales_requests (order_id, user_id, type, reason, status) VALUES (?, ?, ?, ?, 'requested')`,
      [orderId, userId, value.type, value.reason]
    );
    return (await requestForOrder(connection, orderId, false))!;
  });
}

export async function withdrawAfterSales(userId: number, orderId: number): Promise<AfterSalesRequest> {
  validateIds(userId, orderId);
  return inTransaction(async connection => {
    await ownedOrder(connection, userId, orderId, true);
    const request = await requestForOrder(connection, orderId, true);
    if (!request) throw new AfterSalesError('售后申请不存在', 404);
    if (request.status !== 'requested') throw new AfterSalesError('仅待审核的售后申请可以撤回', 409);
    const [updated] = await connection.execute<ResultSetHeader>(
      "UPDATE after_sales_requests SET status = ?, withdrawn_at = NOW() WHERE request_id = ? AND status = 'requested'",
      ['withdrawn', request.request_id]
    );
    if (updated.affectedRows !== 1) throw new AfterSalesError('售后申请状态已改变', 409);
    return (await requestForOrder(connection, orderId, false))!;
  });
}

export async function reviewAfterSales(
  adminId: number, requestId: number, input: unknown, context: { ip?: string; userAgent?: string } = {}
): Promise<AfterSalesRequest> {
  validateIds(adminId, requestId);
  const { error, value } = reviewSchema.validate(input);
  if (error) throw new AfterSalesError('审核状态或审核说明无效');
  return inTransaction(async connection => {
    const [found] = await connection.execute<RowDataPacket[]>(
      'SELECT order_id FROM after_sales_requests WHERE request_id = ?', [requestId]
    );
    if (!found[0]) throw new AfterSalesError('售后申请不存在', 404);
    const orderId = found[0].order_id;
    const [orders] = await connection.execute<RowDataPacket[]>('SELECT order_id FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
    if (!orders[0]) throw new AfterSalesError('订单不存在', 404);
    const request = await requestForOrder(connection, orderId, true);
    if (!request || request.request_id !== requestId) throw new AfterSalesError('售后申请不存在', 404);
    if (request.status !== 'requested') throw new AfterSalesError('仅待审核的售后申请可以审核', 409);
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE after_sales_requests SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW()
       WHERE request_id = ? AND status = 'requested'`, [value.status, value.note, adminId, requestId]
    );
    if (updated.affectedRows !== 1) throw new AfterSalesError('售后申请状态已改变', 409);
    // Review approval is not a payment refund and never changes order status or stock.
    // Keep audit and review atomic, and omit customer reasons and private review notes from logs.
    await connection.execute(
      `INSERT INTO admin_logs (admin_id, action, resource_type, resource_id, description, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [adminId, 'REVIEW_AFTER_SALES', 'after_sales', String(requestId), `售后审核状态: ${value.status}`, context.ip ?? null,
        context.userAgent?.slice(0, 255) ?? null]
    );
    return (await requestForOrder(connection, orderId, false))!;
  });
}

export async function listAfterSales(input: unknown) {
  const { error, value } = listSchema.validate(input);
  if (error) throw new AfterSalesError('售后列表查询参数无效');
  const { page, limit, status } = value;
  const where = status ? ' WHERE a.status = ?' : '';
  const params = status ? [status] : [];
  const pool = getPool();
  const [counts] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM after_sales_requests a${where}`, params);
  const [requests] = await pool.query<AfterSalesRequest[]>(
    `SELECT a.*, o.order_no, o.total_amount, o.payment_method, o.status AS order_status
     FROM after_sales_requests a JOIN orders o ON o.order_id = a.order_id${where}
     ORDER BY a.created_at DESC, a.request_id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]
  );
  const total = Number(counts[0].total);
  return { requests, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
