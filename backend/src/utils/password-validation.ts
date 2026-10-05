import Joi from 'joi';
import { UserValidationError } from './user-validation';

const newPassword = Joi.string().min(12).required();
const email = Joi.string().max(100).email({ tlds: { allow: false } }).required();
const changeSchema = Joi.object({ currentPassword: Joi.string().max(1024).required(), newPassword }).required().unknown(false).prefs({ convert: false });
const resetSchema = Joi.object({ token: Joi.string().pattern(/^[a-f0-9]{64}$/).required(), newPassword }).required().unknown(false).prefs({ convert: false });
const forgotSchema = Joi.object({ email }).required().unknown(false).prefs({ convert: false });

function validated<T>(schema: Joi.Schema, body: unknown): T {
  const { error, value } = schema.validate(body);
  if (error) throw new UserValidationError('密码或请求字段无效；新密码至少12个字符且最多72个UTF-8字节');
  if (value.newPassword && (Buffer.byteLength(value.newPassword, 'utf8') > 72 || !value.newPassword.trim())) {
    throw new UserValidationError('新密码至少12个字符且最多72个UTF-8字节，不能只包含空白');
  }
  return value;
}
export function normalizePasswordChange(body: unknown): { currentPassword: string; newPassword: string } {
  const value = validated<{ currentPassword: string; newPassword: string }>(changeSchema, body);
  if (value.currentPassword === value.newPassword) throw new UserValidationError('新密码不能与当前密码相同');
  return value;
}
export function normalizePasswordReset(body: unknown): { token: string; newPassword: string } { return validated(resetSchema, body); }
export function normalizePasswordForgot(body: unknown): { email: string } {
  const value = body && typeof body === 'object' && !Array.isArray(body)
    ? { ...body, email: typeof (body as any).email === 'string' ? (body as any).email.trim() : (body as any).email } : body;
  return validated(forgotSchema, value);
}
