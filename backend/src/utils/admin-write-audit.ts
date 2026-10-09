import type { Request } from 'express';
import type { PoolConnection } from 'mysql2/promise';
import { getPool } from '../database/mysql';
import { AdminAuditMetadata, normalizeAdminAuditMetadata } from './admin-audit-metadata';

export type AdminAuditContext = AdminAuditMetadata & { adminId: number };

export function adminAuditContext(req: Request): AdminAuditContext {
  return { adminId: req.admin!.adminId, ip: req.ip, userAgent: req.get('user-agent') };
}

/** Critical mutations must use this connection for both business data and audit. */
export async function adminWriteTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

/** Unlike login logging, an audit failure propagates and rolls back the mutation. */
export async function writeAdminAudit(
  connection: Pick<PoolConnection, 'execute'>, context: AdminAuditContext, action: string,
  resourceType: string, resourceId: string | null, description: string
) {
  const metadata = normalizeAdminAuditMetadata(context);
  await connection.execute(
    `INSERT INTO admin_logs (admin_id, action, resource_type, resource_id, description, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [context.adminId, action, resourceType, resourceId, description, metadata.ip, metadata.userAgent]
  );
}
