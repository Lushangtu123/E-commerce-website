import Joi from 'joi';

/** One policy for all newly set passwords; never trim or truncate valid password bytes. */
export const newPasswordSchema = Joi.string().min(12).required().custom((value: string, helpers) => {
  try { encodeURIComponent(value); } catch { return helpers.error('any.invalid'); }
  return /^[\s\u0085]*$/.test(value) || Buffer.byteLength(value, 'utf8') > 72 ? helpers.error('any.invalid') : value;
});
export const NEW_PASSWORD_ERROR = '新密码至少12个字符且最多72个UTF-8字节，不能只包含空白';
