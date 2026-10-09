import Joi from 'joi';
import { UserValidationError } from './user-validation';

const schema = Joi.object({
  username: Joi.string().min(1).max(50).required(),
  // Historical administrator passwords may be short or contain surrounding whitespace.
  password: Joi.string().min(1).max(1024).required(),
}).required().unknown(false).prefs({ convert: false });

export function normalizeAdminLogin(body: unknown): { username: string; password: string } {
  const normalized = body && typeof body === 'object' && !Array.isArray(body)
    ? { ...body, username: typeof (body as any).username === 'string' ? (body as any).username.trim() : (body as any).username }
    : body;
  const { error, value } = schema.validate(normalized);
  if (error) throw new UserValidationError('管理员登录字段或值无效');
  return value;
}
