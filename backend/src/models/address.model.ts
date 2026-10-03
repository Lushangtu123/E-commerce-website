import Joi from 'joi';
import { getPool } from '../database/mysql';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';

export class AddressError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}

export interface AddressInput {
  receiver_name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail_address: string;
  is_default?: boolean;
}

export interface Address extends Omit<AddressInput, 'is_default' | 'province' | 'city' | 'district' | 'detail_address'> {
  address_id: number;
  user_id: number;
  is_default: boolean;
  province: string | null;
  city: string | null;
  district: string | null;
  detail_address: string | null;
  created_at: Date;
}

const text = (length: number) => Joi.string().min(1).max(length).required();
export const addressSchema = Joi.object({
  receiver_name: text(50),
  phone: text(20).pattern(/^\+?[0-9 -]+$/).custom((value: string, helpers) => {
    const digits = value.replace(/\D/g, '').length;
    return digits >= 7 && digits <= 15 ? value : helpers.error('any.invalid');
  }),
  province: text(50), city: text(50), district: text(50), detail_address: text(200),
  is_default: Joi.boolean(),
}).unknown(false).prefs({ convert: false });

/** Strict strings are trimmed before validation; numeric values are never coerced. */
export function normalizeAddress(input: unknown): AddressInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AddressError('地址字段或值无效');
  const trimmed = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
  const { error, value } = addressSchema.validate(trimmed);
  if (error) throw new AddressError('地址字段或值无效，完整收货信息必填');
  return value;
}

export function validAddressId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function checkId(value: unknown): asserts value is number {
  if (!validAddressId(value)) throw new AddressError('用户或地址ID无效');
}

interface LockedAddress extends RowDataPacket { address_id: number; is_default: number }

async function transaction<T>(userId: number, work: (connection: PoolConnection, addresses: LockedAddress[]) => Promise<T>): Promise<T> {
  checkId(userId);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    // The user lock serializes inserts even when the address list is still empty.
    const [users] = await connection.execute<RowDataPacket[]>('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [userId]);
    if (!users.length) throw new AddressError('用户不存在', 404);
    const [addresses] = await connection.execute<LockedAddress[]>(
      'SELECT address_id, is_default FROM shipping_addresses WHERE user_id = ? ORDER BY address_id FOR UPDATE', [userId]
    );
    const result = await work(connection, addresses);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function chooseDefault(connection: PoolConnection, userId: number, addresses: Array<{ address_id: number; is_default: number }>, targetId?: number, requested?: boolean) {
  if (!addresses.length) return;
  const candidates = requested === false && addresses.length > 1
    ? addresses.filter(address => address.address_id !== targetId) : addresses;
  const selected = requested === true ? targetId!
    : (candidates.find(address => Number(address.is_default) === 1) ?? candidates[0]).address_id;
  // Also repairs historical lists with zero or multiple defaults during any successful write.
  await connection.execute(
    'UPDATE shipping_addresses SET is_default = CASE WHEN address_id = ? THEN 1 ELSE 0 END WHERE user_id = ?', [selected, userId]
  );
}

const values = (address: AddressInput) => [address.receiver_name, address.phone, address.province, address.city, address.district, address.detail_address];

export class AddressModel {
  static async list(userId: number): Promise<Address[]> {
    checkId(userId);
    const [addresses] = await getPool().execute<RowDataPacket[]>(
      `SELECT address_id, user_id, receiver_name, phone, province, city, district, detail_address, is_default, created_at
       FROM shipping_addresses WHERE user_id = ? ORDER BY is_default DESC, address_id`, [userId]
    );
    return addresses.map(address => ({ ...address, is_default: Number(address.is_default) === 1 } as Address));
  }

  static async create(userId: number, input: unknown): Promise<number> {
    const address = normalizeAddress(input);
    return transaction(userId, async (connection, addresses) => {
      if (addresses.length >= 20) throw new AddressError('每个用户最多保存20个收货地址');
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO shipping_addresses (user_id, receiver_name, phone, province, city, district, detail_address)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, [userId, ...values(address)]
      );
      if (result.affectedRows !== 1) throw new Error('地址创建未完成');
      await chooseDefault(connection, userId, [...addresses, { address_id: result.insertId, is_default: 0 }], result.insertId, address.is_default);
      return result.insertId;
    });
  }

  static async update(userId: number, addressId: number, input: unknown): Promise<boolean> {
    checkId(addressId);
    const address = normalizeAddress(input);
    return transaction(userId, async (connection, addresses) => {
      if (!addresses.some(row => row.address_id === addressId)) throw new AddressError('收货地址不存在', 404);
      await connection.execute(
        `UPDATE shipping_addresses SET receiver_name = ?, phone = ?, province = ?, city = ?, district = ?, detail_address = ?
         WHERE address_id = ? AND user_id = ?`, [...values(address), addressId, userId]
      );
      await chooseDefault(connection, userId, addresses, addressId, address.is_default);
      return true;
    });
  }

  static async remove(userId: number, addressId: number): Promise<boolean> {
    checkId(addressId);
    return transaction(userId, async (connection, addresses) => {
      if (!addresses.some(row => row.address_id === addressId)) throw new AddressError('收货地址不存在', 404);
      const [result] = await connection.execute<ResultSetHeader>('DELETE FROM shipping_addresses WHERE address_id = ? AND user_id = ?', [addressId, userId]);
      if (result.affectedRows !== 1) throw new Error('地址删除未完成');
      await chooseDefault(connection, userId, addresses.filter(row => row.address_id !== addressId));
      return true;
    });
  }
}
