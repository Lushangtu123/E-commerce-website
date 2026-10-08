const SQL_TEXT = /\b(?:SQL\s*:|(?:INSERT\s+INTO|UPDATE\s+\S+\s+SET|SELECT\s+.+\s+FROM|DELETE\s+FROM)\b|Duplicate entry .+ for key)/i;
const DATABASE_MESSAGE = '数据库操作失败';
type ErrorFields = Record<string, unknown>;

function children(error: ErrorFields): unknown[] {
  return [error.cause, ...(Array.isArray(error.errors) ? error.errors.slice(0, 20) : [])];
}

function databaseError(value: unknown, seen = new Set<unknown>(), depth = 0): boolean {
  // Unknown tails and cycles cannot be proved safe; suppress their enclosing error text.
  if (depth > 10 || seen.size >= 100 || seen.has(value)) return true;
  if (typeof value === 'string') return SQL_TEXT.test(value);
  if (!value || typeof value !== 'object') return false;
  seen.add(value);
  const error = value as ErrorFields;
  return (Array.isArray(error.errors) && error.errors.length > 20) ||
    ['sql', 'sqlMessage', 'sqlState', 'errno'].some(key => key in error) ||
    (typeof error.code === 'string' && /^ER_/.test(error.code)) ||
    (typeof error.name === 'string' && /mysql/i.test(error.name)) ||
    [error.message, error.stack].some(text => typeof text === 'string' && SQL_TEXT.test(text)) ||
    children(error).some(child => databaseError(child, seen, depth + 1));
}

/** Only diagnostic fields cross the log boundary; database text never does. */
export function safeError(value: unknown, seen = new Set<unknown>(), depth = 0): ErrorFields {
  if (!value || typeof value !== 'object') return { type: 'Error', message: '操作失败' };
  if (depth > 10 || seen.has(value)) return { type: 'Error', message: '错误原因链已截断' };
  seen.add(value);
  const error = value as ErrorFields;
  const database = databaseError(value);
  const type = error.name ?? error.type;
  const result: ErrorFields = {
    type: typeof type === 'string' && /^(?:[A-Za-z][A-Za-z0-9]*Error|Error)$/.test(type) ? type : 'Error',
    message: database ? DATABASE_MESSAGE : typeof error.message === 'string' ? error.message : '操作失败',
  };
  if (typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code)) result.code = error.code;
  if (Number.isSafeInteger(error.errno)) result.errno = error.errno;
  if (typeof error.sqlState === 'string' && /^[A-Z0-9]{5}$/.test(error.sqlState)) result.sqlState = error.sqlState;
  if (!database) {
    if (typeof error.stack === 'string') result.stack = error.stack;
    if (error.cause !== undefined) result.cause = safeError(error.cause, seen, depth + 1);
    if (Array.isArray(error.errors)) result.errors = error.errors.slice(0, 20).map(child => safeError(child, seen, depth + 1));
  }
  return result;
}

function containsErrorText(message: string, error: unknown, seen = new Set<unknown>(), depth = 0): boolean {
  if (depth > 10 || seen.size >= 100 || !error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  const fields = error as ErrorFields;
  return [fields.message, fields.sqlMessage, fields.sql].some(value => typeof value === 'string' && value.length > 0 && message.includes(value)) ||
    children(fields).some(child => containsErrorText(message, child, seen, depth + 1));
}

/** Pino derives msg before serializers run, so sanitize its input arguments too. */
export function safeLogArguments(args: unknown[]): unknown[] {
  const [first, message, ...rest] = args;
  if (!first || typeof first !== 'object') return args;
  if (first instanceof Error) {
    const error = safeError(first);
    return [{ err: error }, typeof message === 'string' && !containsErrorText(message, first) && !SQL_TEXT.test(message) ? message : error.message];
  }
  const fields = first as ErrorFields;
  const originals = [fields.err, fields.error].filter(value => value !== undefined);
  if (originals.length === 0) return args;
  const result = { ...fields };
  for (const key of ['err', 'error']) if (fields[key] !== undefined) result[key] = safeError(fields[key]);
  const database = originals.some(error => databaseError(error));
  const cleanMessage = (text: unknown) => typeof text === 'string' && database &&
    (SQL_TEXT.test(text) || originals.some(error => containsErrorText(text, error))) ? DATABASE_MESSAGE : text;
  if (fields.msg !== undefined) result.msg = cleanMessage(fields.msg);
  return [result, ...(message === undefined ? [] : [database && rest.length ? DATABASE_MESSAGE : cleanMessage(message), ...(database ? [] : rest)])];
}
