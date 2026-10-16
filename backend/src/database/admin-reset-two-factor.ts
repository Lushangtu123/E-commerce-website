/**
 * 运维恢复：管理员丢失验证器和全部恢复码时，清除其两步验证，下次登录重新绑定；其所有会话立即失效。
 * 用法（需要数据库连接环境变量）：node dist/database/admin-reset-two-factor.js <username>
 */
import '../load-env';
import { connectDatabase } from './mysql';
import { resetTwoFactor } from '../services/admin-two-factor.service';

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('用法：node dist/database/admin-reset-two-factor.js <username>');
    process.exit(2);
  }
  await connectDatabase();
  if (!await resetTwoFactor(username)) {
    console.error(`管理员不存在：${username}`);
    process.exit(1);
  }
  console.log(`已重置 ${username} 的两步验证；其所有会话已失效，下次登录需重新绑定验证器。`);
  process.exit(0);
}

main().catch(() => { console.error('重置两步验证失败'); process.exit(1); });
