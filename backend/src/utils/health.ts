import { getPool } from '../database/mysql';
import { getRedisClient } from '../database/redis';
import mongoose from '../database/mongodb';
import { getChannel } from '../database/rabbitmq';

export interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  dependencies: Record<string, DependencyStatus>;
}

/** 单个依赖检查超时时间 */
const CHECK_TIMEOUT_MS = 3000;

async function checkDependency(check: () => Promise<unknown>): Promise<DependencyStatus> {
  const start = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('检查超时')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err: any) {
    return { status: 'down', error: err?.message || '未知错误' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 生成健康检查报告
 * 覆盖启动时必需的 4 个依赖（MySQL/Redis/MongoDB/RabbitMQ）；
 * 任一异常则整体状态为 degraded
 */
export async function getHealthReport(): Promise<HealthReport> {
  const [mysql, redis, mongodb, rabbitmq] = await Promise.all([
    checkDependency(() => getPool().query('SELECT 1')),
    checkDependency(() => getRedisClient().ping()),
    checkDependency(() =>
      mongoose.connection.db
        ? mongoose.connection.db.admin().ping()
        : Promise.reject(new Error('MongoDB未初始化'))
    ),
    checkDependency(async () => {
      getChannel(); // 未初始化时抛错
    }),
  ]);

  const dependencies = { mysql, redis, mongodb, rabbitmq };
  const allUp = Object.values(dependencies).every((d) => d.status === 'up');

  return {
    status: allUp ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    dependencies,
  };
}
