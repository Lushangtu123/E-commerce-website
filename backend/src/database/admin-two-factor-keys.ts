/**
 * ADMIN_TOTP_KEY 轮换检查（docs/KEY_ROTATION.md）：列出仍依赖旧密钥的两步验证数据。
 * 用法（需要数据库连接与 ADMIN_TOTP_KEY / ADMIN_TOTP_KEY_PREVIOUS 环境变量）：
 *   node dist/database/admin-two-factor-keys.js          只检查
 *   node dist/database/admin-two-factor-keys.js --rekey  同时把只能用旧密钥解开的 TOTP 密钥改用新密钥加密
 * 全部迁到新密钥时以 0 退出，此时才可以删除 ADMIN_TOTP_KEY_PREVIOUS；否则以 1 退出。
 */
import '../load-env';
import { connectDatabase } from './mysql';
import { twoFactorKeyReport } from '../services/admin-two-factor.service';

async function main() {
  const rekey = process.argv.includes('--rekey');
  await connectDatabase();
  const report = await twoFactorKeyReport(rekey);
  if (report.resealed.length) console.log(`已改用新密钥加密验证器密钥：${report.resealed.join(', ')}`);
  if (report.staleSecrets.length) console.log(`验证器密钥仍是旧密钥加密（加 --rekey 迁移）：${report.staleSecrets.join(', ')}`);
  if (report.unreadableSecrets.length) {
    console.log(`验证器密钥无法用当前或旧密钥解开，需要重置：${report.unreadableSecrets.join(', ')}`);
  }
  if (report.staleRecoveryCodes.length) {
    console.log(`恢复码仍是旧密钥（这些管理员下次登录时自动换发）：${report.staleRecoveryCodes.join(', ')}`);
  }
  const done = !report.staleSecrets.length && !report.unreadableSecrets.length && !report.staleRecoveryCodes.length;
  console.log(done ? '全部两步验证数据已使用当前 ADMIN_TOTP_KEY，可以删除 ADMIN_TOTP_KEY_PREVIOUS。' : '仍有数据依赖旧密钥，暂时不要删除 ADMIN_TOTP_KEY_PREVIOUS。');
  process.exit(done ? 0 : 1);
}

main().catch(() => { console.error('检查两步验证密钥失败'); process.exit(1); });
