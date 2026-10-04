import Joi from 'joi';

export class UserValidationError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}

const username = Joi.string().min(1).max(50).required();
const email = Joi.string().max(100).email({ tlds: { allow: false } }).required();
const password = Joi.string().required();
const registrationSchema = Joi.object({ username, email, password: password.min(6) })
  .required().unknown(false).prefs({ convert: false });
const loginSchema = Joi.object({ email: Joi.string().max(100).required(), password })
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
  if (field === 'username') return '用户名必须为1至50个字符';
  if (field === 'email') return '邮箱格式无效或超过100个字符';
  if (field === 'password') return error.details[0]?.type === 'string.min' ? '密码长度不能少于6位' : '密码必须为字符串';
  if (field === 'phone') return '联系电话必须为不超过20个字符的字符串或空值';
  if (field === 'avatar_url') return '头像地址必须为不超过255个字符的HTTP(S)网址或空值';
  return context === 'register' ? '注册字段或值无效' : context === 'login' ? '登录字段或值无效' : '个人资料字段或值无效';
}

export function normalizeRegistration(body: unknown): { username: string; email: string; password: string } {
  const { error, value } = registrationSchema.validate(normalizeFields(body, ['username', 'email']));
  if (error) throw new UserValidationError(failureMessage(error, 'register'));
  // bcrypt only uses the first 72 UTF-8 bytes; reject truncation for new accounts.
  if (Buffer.byteLength(value.password, 'utf8') > 72) throw new UserValidationError('密码不能超过72个UTF-8字节');
  return value;
}

export function normalizeLogin(body: unknown): { email: string; password: string } {
  const { error, value } = loginSchema.validate(normalizeFields(body, ['email']));
  if (error) throw new UserValidationError(failureMessage(error, 'login'));
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
