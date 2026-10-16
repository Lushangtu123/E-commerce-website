/**
 * Browser-fixture second factor, shared by the fixture server (which binds it) and the Playwright
 * flows (which answer it). Every value here is a disposable test value for the loopback fixture.
 */
const path = require('node:path');
const { createHash } = require('node:crypto');

const dist = path.resolve(__dirname, '../dist');
const ADMIN_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
// RFC 6238's own test secret ("12345678901234567890").
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RECOVERY_CODES = Array.from({ length: 20 }, (_, index) => `fixtr-${String(index + 1).padStart(5, '0')}`);

/** Binds the fixture secret and recovery codes to existing administrators. */
async function bindFixtureTwoFactor(pool, usernames) {
  const { sealSecret } = require(path.join(dist, 'utils/secret-box'));
  for (const username of usernames) {
    const [[admin]] = await pool.query('SELECT admin_id FROM admins WHERE username = ?', [username]);
    await pool.query('UPDATE admins SET totp_secret = ?, totp_enabled_at = NOW(), totp_last_step = NULL WHERE admin_id = ?',
      [sealSecret(SECRET), admin.admin_id]);
    await pool.query('INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ?',
      [RECOVERY_CODES.map(code => [admin.admin_id, createHash('sha256').update(code.replace(/[\s-]/g, '')).digest('hex')])]);
  }
}

const lastStep = new Map(), usedRecovery = new Map();
/**
 * The next code that signs `username` in. The server refuses a time step twice, so a second sign-in
 * within the same 30 seconds uses the next recovery code instead (which exercises that path too).
 */
function nextAdminCode(username) {
  const step = Math.floor(Date.now() / 30000);
  if ((lastStep.get(username) ?? -1) < step) {
    lastStep.set(username, step);
    return require(path.join(dist, 'utils/totp')).totpCode(SECRET, step);
  }
  const used = usedRecovery.get(username) ?? 0;
  if (used >= RECOVERY_CODES.length) throw new Error(`Fixture recovery codes exhausted for ${username}`);
  usedRecovery.set(username, used + 1);
  return RECOVERY_CODES[used];
}

module.exports = { ADMIN_TOTP_KEY, bindFixtureTwoFactor, nextAdminCode };
