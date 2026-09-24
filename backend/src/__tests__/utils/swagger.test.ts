/**
 * Swagger 文档回归测试
 * - spec 能正常生成，无重复的 path+method
 * - 关键接口存在且带 summary
 * - admin-product 的 /batch/status 注册顺序在 /:productId/status 之前（影子路由修复）
 */
import { swaggerSpec } from '../../utils/swagger';

jest.mock('../../controllers/admin-product.controller', () => ({
  getAdminProducts: jest.fn(),
  updateProductStatus: jest.fn(),
  batchUpdateProductStatus: jest.fn(),
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  deleteProduct: jest.fn(),
  getProductSKUs: jest.fn(),
  createSKU: jest.fn(),
  batchCreateSKUs: jest.fn(),
  updateSKU: jest.fn(),
  deleteSKU: jest.fn(),
}));

jest.mock('../../middleware/admin-auth', () => ({
  authenticateAdmin: jest.fn((_req: any, _res: any, next: any) => next()),
  requirePermission: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const adminProductRoutes = require('../../routes/admin-product.routes').default;

describe('swagger spec', () => {
  test('生成成功且接口数量符合预期', () => {
    const paths = (swaggerSpec as any).paths || {};
    let operations = 0;
    for (const p of Object.keys(paths)) operations += Object.keys(paths[p]).length;
    // 83 个路由接口 + /health
    expect(operations).toBeGreaterThanOrEqual(84);
  });

  test('无重复的 path+method 定义', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    const paths = (swaggerSpec as any).paths;
    for (const p of Object.keys(paths)) {
      for (const m of Object.keys(paths[p])) {
        const key = `${m} ${p}`;
        if (seen.has(key)) dupes.push(key);
        seen.add(key);
      }
    }
    expect(dupes).toEqual([]);
  });

  test('关键接口存在', () => {
    const paths = (swaggerSpec as any).paths;
    expect(paths['/api/users/login'].post).toBeDefined();
    expect(paths['/api/orders'].post).toBeDefined();
    expect(paths['/api/admin/products/batch/status'].put).toBeDefined();
    expect(paths['/api/admin/coupons'].post).toBeDefined();
    expect(paths['/health'].get).toBeDefined();
    expect(paths['/api/search/es'].get).toBeDefined();
  });

  test('每个 operation 都有 summary 且 path 参数都标记 required', () => {
    const paths = (swaggerSpec as any).paths;
    for (const p of Object.keys(paths)) {
      for (const m of Object.keys(paths[p])) {
        const op = paths[p][m];
        expect(op.summary).toBeTruthy();
        for (const param of op.parameters || []) {
          const resolved = param.$ref ? param : param;
          if (resolved.in === 'path') {
            expect(resolved.required).toBe(true);
          }
        }
      }
    }
  });
});

describe('admin-product 路由顺序', () => {
  test('/batch/status 在 /:productId/status 之前注册', () => {
    const putPaths: string[] = (adminProductRoutes.stack as any[])
      .filter((l: any) => l.route && l.route.methods.put)
      .map((l: any) => l.route.path);
    expect(putPaths).toContain('/batch/status');
    expect(putPaths).toContain('/:productId/status');
    expect(putPaths.indexOf('/batch/status')).toBeLessThan(
      putPaths.indexOf('/:productId/status')
    );
  });
});
