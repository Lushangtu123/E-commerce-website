import jwt from 'jsonwebtoken';
import { jwtSecret, verifyJwt } from '../../utils/jwt-secret';

const CURRENT = 'current-secret-0123456789abcdef0123456789';
const PREVIOUS = 'previous-secret-0123456789abcdef012345678';
const OLD_ENV = { ...process.env };

beforeEach(() => { process.env.JWT_SECRET = CURRENT; delete process.env.JWT_SECRET_PREVIOUS; });
afterAll(() => { process.env = OLD_ENV; });

test('签发总是用当前密钥，校验当前密钥签发的令牌', () => {
  expect(jwtSecret()).toBe(CURRENT);
  const token = jwt.sign({ userId: 1 }, jwtSecret());
  expect(verifyJwt(token)).toMatchObject({ userId: 1 });
});

test('轮换期内仍接受旧密钥签发的令牌', () => {
  const old = jwt.sign({ userId: 2 }, PREVIOUS);
  expect(() => verifyJwt(old)).toThrow('invalid signature');
  process.env.JWT_SECRET_PREVIOUS = PREVIOUS;
  expect(verifyJwt(old)).toMatchObject({ userId: 2 });
});

test('当前密钥下已过期的令牌不会改用旧密钥重试', () => {
  process.env.JWT_SECRET_PREVIOUS = PREVIOUS;
  const expired = jwt.sign({ userId: 3, exp: Math.floor(Date.now() / 1000) - 10 }, CURRENT);
  expect(() => verifyJwt(expired)).toThrow(jwt.TokenExpiredError);
});

test('两把密钥都不匹配时拒绝', () => {
  process.env.JWT_SECRET_PREVIOUS = PREVIOUS;
  expect(() => verifyJwt(jwt.sign({ userId: 4 }, 'someone-else-0123456789abcdef0123456789'))).toThrow('invalid signature');
});

test('只接受 HS256', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ userId: 5 })).toString('base64url');
  expect(() => verifyJwt(`${header}.${body}.`)).toThrow();
  expect(() => verifyJwt(jwt.sign({ userId: 6 }, CURRENT, { algorithm: 'HS512' }))).toThrow('invalid algorithm');
});

test('附加的校验选项照常生效', () => {
  const token = jwt.sign({ userId: 7 }, CURRENT, { audience: 'a' });
  expect(() => verifyJwt(token, { audience: 'b' })).toThrow('jwt audience invalid');
});
