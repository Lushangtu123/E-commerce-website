import type { Pool, RowDataPacket } from 'mysql2/promise';

const REQUIRED = ['users.auth_version', 'users.status', 'admins.auth_version'];

/** Read-only release gate; never performs migrations during an API request or build. */
export async function missingAccountColumns(pool: Pool): Promise<string[]> {
  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users', 'admins')"
  );
  const present = new Set(columns.map(column => `${column.TABLE_NAME}.${column.COLUMN_NAME}`));
  return REQUIRED.filter(column => !present.has(column));
}
