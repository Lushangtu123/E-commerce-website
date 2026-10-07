export function passwordError(password: string): string | null {
  if (/^[\s\u0085]*$/.test(password)) return '新密码不能全部为空格';
  try {
    if (password.length < 12 || password.length > 72 || encodeURIComponent(password).replace(/%[A-F\d]{2}|./g, 'x').length > 72) return '新密码至少12个字符，且不超过72字节';
  } catch { return '新密码至少12个字符，且不超过72字节'; }
  return null;
}
