import Joi from 'joi';
import { newPasswordSchema, NEW_PASSWORD_ERROR } from './new-password';

export class UserValidationError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}

// Names and addresses of deleted accounts (see services/account-deletion.service.ts) cannot be taken.
const username = Joi.string().min(1).max(50).pattern(/^deleted_/i, { name: 'reserved', invert: true }).required();
const email = Joi.string().max(100).email({ tlds: { allow: false } }).pattern(/@deleted\.invalid$/i, { name: 'reserved', invert: true }).required();
const password = Joi.string().required();
const registrationSchema = Joi.object({ username, email, password: newPasswordSchema })
  .required().unknown(false).prefs({ convert: false });
const loginSchema = Joi.object({ email: Joi.string().max(100).required(), password })
  .required().unknown(false).prefs({ convert: false });
const accountDeletionSchema = Joi.object({ password: Joi.string().min(1).max(1024).required() })
  .required().unknown(false).prefs({ convert: false });
const profileSchema = Joi.object({
  username: username.optional(),
  phone: Joi.string().max(20).allow(null),
  avatar_url: Joi.string().max(255).uri({ scheme: ['http', 'https'] }).allow(null),
}).min(1).required().unknown(false).prefs({ convert: false });

function normalizeFields(body: unknown, fields: string[], clearable: string[] = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const value: Record<string, unknown> = { ...body };
  for (const field of fields) {
    if (value[field] === undefined) delete value[field];
    if (typeof value[field] === 'string') value[field] = (value[field] as string).trim();
    if (clearable.includes(field) && value[field] === '') value[field] = null;
  }
  return value;
}

function failureMessage(error: Joi.ValidationError, context: 'register' | 'login' | 'profile') {
  const field = error.details[0]?.path[0];
  if (error.details[0]?.type === 'object.min') return '请至少提供一项个人资料修改';
  const reserved = error.details[0]?.type === 'string.pattern.invert.name';
  if (field === 'username') return reserved ? '该用户名不可用' : '用户名必须为1至50个字符';
  if (field === 'email') return reserved ? '该邮箱不可用' : '邮箱格式无效或超过100个字符';
  if (field === 'password') return error.details[0]?.type === 'string.base' ? '密码必须为字符串' : NEW_PASSWORD_ERROR;
  if (field === 'phone') return '联系电话必须为不超过20个字符的字符串或空值';
  if (field === 'avatar_url') return '头像地址必须为不超过255个字符的HTTP(S)网址或空值';
  return context === 'register' ? '注册字段或值无效' : context === 'login' ? '登录字段或值无效' : '个人资料字段或值无效';
}

export function normalizeRegistration(body: unknown): { username: string; email: string; password: string } {
  const { error, value } = registrationSchema.validate(normalizeFields(body, ['username', 'email']));
  if (error) throw new UserValidationError(failureMessage(error, 'register'));
  return value;
}

export function normalizeLogin(body: unknown): { email: string; password: string } {
  const { error, value } = loginSchema.validate(normalizeFields(body, ['email']));
  if (error) throw new UserValidationError(failureMessage(error, 'login'));
  return value;
}

export function normalizeAccountDeletion(body: unknown): { password: string } {
  const { error, value } = accountDeletionSchema.validate(body);
  if (error) throw new UserValidationError('请输入密码');
  return value;
}

export interface ProfileUpdates { username?: string; phone?: string | null; avatar_url?: string | null }
export function normalizeProfile(body: unknown): ProfileUpdates {
  const { error, value } = profileSchema.validate(normalizeFields(body, ['username', 'phone', 'avatar_url'], ['phone', 'avatar_url']));
  if (error) throw new UserValidationError(failureMessage(error, 'profile'));
  return value;
}

export function publicUser(user: Record<string, any>) {
  return { user_id: user.user_id, username: user.username, email: user.email,
    phone: user.phone, avatar_url: user.avatar_url, created_at: user.created_at, updated_at: user.updated_at };
}
