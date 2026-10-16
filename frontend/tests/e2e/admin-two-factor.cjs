const path = require('node:path');
const { nextAdminCode } = require(path.resolve(__dirname, '../../../backend/scripts/e2e-admin-two-factor.cjs'));

/** Answers the second factor the fixture binds to every administrator, after the password step. */
module.exports = async function answerAdminTwoFactor(page, username) {
  const field = page.getByLabel('验证码', { exact: true });
  await field.waitFor({ state: 'visible' });
  await field.fill(nextAdminCode(username));
  await page.getByRole('button', { name: '验证并登录', exact: true }).click();
};
