import { query } from '../database/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface Order {
  order_id: number;
  order_no: string;
  user_id: number;
  total_amount: number;
  status: number;
  payment_method?: string;
  shipping_address_id?: number;
  remark?: string;
  created_at: Date;
  paid_at?: Date;
  shipped_at?: Date;
  completed_at?: Date;
}

export interface OrderItem {
  item_id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  product_image?: string;
  quantity: number;
  price: number;
}

export enum OrderStatus {
  PENDING = 0,      // 待支付
  PAID = 1,         // 已支付
  SHIPPED = 2,      // 已发货
  COMPLETED = 3,    // 已完成
  CANCELLED = 4     // 已取消
}

export class OrderModel {
  // 创建订单
  static async create(
    userId: number,
    items: Array<{ product_id: number; quantity: number; price: number; product_name: string; product_image?: string }>,
    totalAmount: number,
    shippingAddressId?: number,
    remark?: string
  ): Promise<number> {
    // 生成订单号
    const orderNo = this.generateOrderNo();

    // 插入订单
    const orderResult = await query<ResultSetHeader>(
      `INSERT INTO orders (order_no, user_id, total_amount, shipping_address_id, remark, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderNo, userId, totalAmount, shippingAddressId, remark, OrderStatus.PENDING]
    );

    const orderId = orderResult.insertId;

    // 插入订单商品
    for (const item of items) {
      await query(
        `INSERT INTO order_items (order_id, product_id, product_name, product_image, quantity, price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, item.product_id, item.product_name, item.product_image, item.quantity, item.price]
      );
    }

    return orderId;
  }

  // 生成订单号
  static generateOrderNo(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${timestamp}${random}`;
  }

  // 获取订单详情
  static async findById(orderId: number): Promise<Order | null> {
    const orders = await query<(Order & RowDataPacket)[]>(
      'SELECT * FROM orders WHERE order_id = ?',
      [orderId]
    );
    return orders.length > 0 ? orders[0] : null;
  }

  // 根据订单号获取订单
  static async findByOrderNo(orderNo: string): Promise<Order | null> {
    const orders = await query<(Order & RowDataPacket)[]>(
      'SELECT * FROM orders WHERE order_no = ?',
      [orderNo]
    );
    return orders.length > 0 ? orders[0] : null;
  }

  // 获取订单商品
  static async getOrderItems(orderId: number): Promise<OrderItem[]> {
    return await query<(OrderItem & RowDataPacket)[]>(
      'SELECT * FROM order_items WHERE order_id = ?',
      [orderId]
    );
  }

  // 获取用户订单列表
  static async listByUser(userId: number, status?: number, page: number = 1, limit: number = 10): Promise<{ orders: Order[], total: number }> {
    let whereClause = 'user_id = ?';
    let queryParams: any[] = [userId];

    if (status !== undefined) {
      whereClause += ' AND status = ?';
      queryParams.push(status);
    }

    const offset = (page - 1) * limit;

    // 获取总数
    const countResult = await query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM orders WHERE ${whereClause}`,
      queryParams
    );
    const total = countResult[0].total;

    // 获取订单列表
    const orders = await query<(Order & RowDataPacket)[]>(
      `SELECT * FROM orders WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    return { orders, total };
  }

  // 更新订单状态
  static async updateStatus(orderId: number, status: OrderStatus): Promise<boolean> {
    const updates: any = { status };
    
    switch (status) {
      case OrderStatus.PAID:
        updates.paid_at = new Date();
        break;
      case OrderStatus.SHIPPED:
        updates.shipped_at = new Date();
        break;
      case OrderStatus.COMPLETED:
        updates.completed_at = new Date();
        break;
    }

    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(updates), orderId];
    
    const result = await query<ResultSetHeader>(
      `UPDATE orders SET ${fields} WHERE order_id = ?`,
      values
    );
    return result.affectedRows > 0;
  }

  // 取消订单
  static async cancel(orderId: number): Promise<boolean> {
    return await this.updateStatus(orderId, OrderStatus.CANCELLED);
  }
}

