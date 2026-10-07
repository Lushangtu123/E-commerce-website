import '../load-env';
import { connectDatabase, getPool } from './mysql';
import { missingAccountColumns } from '../utils/account-schema';

async function check(): Promise<void> {
  try {
    await connectDatabase();
    const missing = await missingAccountColumns(getPool());
    console.log(JSON.stringify({ status: missing.length ? 'migration_required' : 'ready', missingColumns: missing }));
    if (missing.length) process.exitCode = 1;
  } catch {
    console.error('数据库结构检查失败；未修改数据库');
    process.exitCode = 1;
  } finally {
    try { await getPool().end(); } catch { /* Initialization may have failed. */ }
  }
}

if (require.main === module) void check();
