jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));

import fs from 'node:fs';
import path from 'node:path';
import type { Router } from 'express';
import { createApp } from '../../app';

// The README API tables must list exactly the routes the server registers, in both languages.
const root = path.join(__dirname, '../../../..');
const appSource = fs.readFileSync(path.join(__dirname, '../../app.ts'), 'utf8');

type RouteLayer = { route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: unknown[] } };
const normalize = (method: string, url: string) => `${method.toUpperCase()} ${url.replace(/:\w+/g, ':param')}`;

function routesOf(stack: RouteLayer[], base = ''): string[] {
  return stack.flatMap(layer => {
    if (!layer.route) return [];
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    return paths.flatMap(p => Object.keys(layer.route!.methods).map(m => normalize(m, base + (p === '/' ? '' : p))));
  });
}

function registeredRoutes(): Set<string> {
  // Express 5 does not keep a router's mount path, so read the mounts from app.ts and the routes from each router.
  const imports = new Map([...appSource.matchAll(/import (\w+) from '\.\/routes\/([\w.-]+)'/g)].map(m => [m[1], m[2]]));
  const mounts = [...appSource.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g)].filter(m => imports.has(m[2]));
  const routes = mounts.flatMap(([, base, name]) => {
    const router: Router = require(path.join(__dirname, '../../routes', imports.get(name)!)).default;
    return routesOf(router.stack as RouteLayer[], base);
  });

  const appStack = (createApp() as unknown as { router: { stack: RouteLayer[] } }).router.stack;
  // Every router mounted at runtime must have been found in app.ts.
  expect(appStack.filter(layer => layer.handle?.stack && !layer.route).length).toBe(mounts.length);
  return new Set([...routes, ...routesOf(appStack)]);
}

function documentedRoutes(file: string): Set<string> {
  const readme = fs.readFileSync(path.join(root, file), 'utf8');
  return new Set([...readme.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/[^`?\s]*)/g)].map(m => normalize(m[1], m[2])));
}

const registered = registeredRoutes();

test('能读到服务注册的全部路由', () => {
  expect(registered.size).toBeGreaterThan(100);
  expect(registered).toContain('GET /health');
  expect(registered).toContain('POST /api/users/login');
});

test.each(['README.md', 'README_ZH.md'])('%s 的接口列表与注册的路由一致', file => {
  const documented = documentedRoutes(file);
  expect({
    missingFromReadme: [...registered].filter(r => !documented.has(r)).sort(),
    notRegistered: [...documented].filter(r => !registered.has(r)).sort(),
  }).toEqual({ missingFromReadme: [], notRegistered: [] });
});
