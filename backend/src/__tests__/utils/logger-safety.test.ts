import { spawnSync } from 'child_process';
import path from 'path';

const PRIVATE = 'fixture_private_db_parameter@example.test';
let records: Record<string, any>;

// Exercise the configured production logger and its real Pino JSON destination.
// No database, transport worker, real credential, or environment file is involved.
beforeAll(() => {
  const source = `
    const logger = require('./src/utils/logger').default;
    const privateValue = ${JSON.stringify(PRIVATE)};
    const databaseError = (fields = {}) => Object.assign(new Error(privateValue), {
      code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205, sqlState: 'HY000',
      sql: "INSERT INTO users VALUES ('" + privateValue + "')",
      sqlMessage: privateValue, stack: 'Error: ' + privateValue + '\\n    at databaseCall (fixture.js:1:1)',
      ...fields
    });
    const write = (fixtureCase, err, message = '业务操作失败') => logger.error({fixtureCase, err}, message);
    write('mysql', databaseError());
    write('sql-only', Object.assign(new Error(privateValue), {sql: privateValue}));
    write('sql-message-only', Object.assign(new Error(privateValue), {sqlMessage: privateValue}));
    write('code-only', Object.assign(new Error(privateValue), {code: 'ER_BAD_FIELD_ERROR'}));
    write('sql-state-only', Object.assign(new Error(privateValue), {sqlState: '22001'}));
    write('errno-only', Object.assign(new Error(privateValue), {errno: 1406}));
    write('undefined-sql', Object.assign(new Error(privateValue), {sql: undefined}));
    write('mysql-name', Object.assign(new Error(privateValue), {name: 'MySQLError'}));
    write('message-only', new Error("Duplicate entry '" + privateValue + "' for key 'users.email'"));
    write('stack-only', Object.assign(new Error('操作失败'), {stack: 'Error: 操作失败\\nSQL: INSERT INTO users VALUES (' + privateValue + ')'}));
    write('plain-object', {name: 'Error', message: privateValue, stack: privateValue, sqlMessage: privateValue, code: 'ER_DATA_TOO_LONG'});
    write('nested-cause', Object.assign(new Error('包装失败: ' + privateValue), {cause: Object.assign(new Error('第二层: ' + privateValue), {cause: databaseError()})}));
    write('aggregate', new AggregateError([new TypeError('类型失败'), databaseError()], '批次失败: ' + privateValue));
    write('primitive-cause', Object.assign(new Error('包装失败: ' + privateValue), {cause: 'SQL: SELECT ' + privateValue}));
    logger.child({fixtureCase: 'direct-error'}).error(databaseError());
    logger.error({fixtureCase: 'implicit-message', err: databaseError()});
    logger.error({fixtureCase: 'object-message', err: databaseError(), msg: privateValue});
    logger.error({fixtureCase: 'explicit-private-context', err: databaseError()}, '包装失败: ' + privateValue);
    logger.error({fixtureCase: 'error-key', error: databaseError()}, '业务操作失败');
    logger.error({fixtureCase: 'format-arguments', err: databaseError()}, '失败: %s', privateValue);
    const cycle = new Error('循环原因: ' + privateValue); cycle.cause = cycle;
    write('cycle', cycle);
    let deep = databaseError();
    for (let i = 0; i < 12; i++) deep = Object.assign(new Error('深层原因: ' + privateValue), {cause: deep});
    write('deep-cause', deep);
    write('wide-aggregate', new AggregateError([...Array.from({length: 20}, () => new Error('普通错误')), databaseError()], '批次参数: ' + privateValue));
    write('benign', Object.assign(new TypeError('普通类型错误'), {code: 'ERR_INVALID_ARG_TYPE', payload: {password: privateValue}}), '处理请求失败');
    write('benign-network', Object.assign(new Error('socket hang up'), {code: 'ECONNRESET'}));
    write('benign-cause', Object.assign(new Error('读取失败'), {cause: new TypeError('类型无效')}));
    logger.info({fixtureCase: 'business-control', checked: 2, cancelled: 1}, '批次已完成');
  `;
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', source], {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info', LOG_FILE: '' },
    encoding: 'utf8', timeout: 15000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  records = Object.fromEntries(result.stdout.trim().split('\n').map(line => {
    const record = JSON.parse(line);
    return [record.fixtureCase, record];
  }));
});

test.each([
  'mysql', 'sql-only', 'sql-message-only', 'code-only', 'sql-state-only', 'errno-only',
  'undefined-sql', 'mysql-name', 'message-only', 'stack-only', 'plain-object',
  'nested-cause', 'aggregate', 'primitive-cause', 'direct-error', 'implicit-message',
  'object-message', 'explicit-private-context', 'error-key',
  'format-arguments', 'cycle', 'deep-cause',
  'wide-aggregate',
])('%s: 真实日志中不保留数据库参数，包括错误消息、堆栈和自动生成的 msg', fixtureCase => {
  expect(records[fixtureCase]).toBeDefined();
  expect(JSON.stringify(records[fixtureCase])).not.toContain(PRIVATE);
});

test('数据库失败保留安全类型、错误码与 SQLSTATE，不保留 SQL 或 sqlMessage', () => {
  expect(records.mysql.err).toMatchObject({type: 'Error', code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205, sqlState: 'HY000'});
  expect(records.mysql.err).not.toHaveProperty('sql');
  expect(records.mysql.err).not.toHaveProperty('sqlMessage');
  expect(records.mysql.err).not.toHaveProperty('stack');
  expect(records.mysql.msg).toBe('业务操作失败');
});

test('普通错误保留消息、堆栈和安全错误码，并省略任意附加字段', () => {
  expect(records.benign.err).toMatchObject({type: 'TypeError', message: '普通类型错误', code: 'ERR_INVALID_ARG_TYPE'});
  expect(records.benign.err.stack).toContain('TypeError: 普通类型错误');
  expect(records.benign.msg).toBe('处理请求失败');
  expect(records.benign.err).not.toHaveProperty('payload');
  expect(JSON.stringify(records.benign)).not.toContain(PRIVATE);
  expect(records['benign-network'].err).toMatchObject({message: 'socket hang up', code: 'ECONNRESET'});
});

test('普通原因链仍可诊断，业务计数和消息保持不变', () => {
  expect(JSON.stringify(records['benign-cause'].err)).toContain('读取失败');
  expect(JSON.stringify(records['benign-cause'].err)).toContain('类型无效');
  expect(records['business-control']).toMatchObject({checked: 2, cancelled: 1, msg: '批次已完成'});
});
