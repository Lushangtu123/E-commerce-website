import { getPool } from '../database/mysql';
import { getRedisClient } from '../database/redis';
import { getChannel, isRabbitMQConfigured } from '../database/rabbitmq';
import { getESClient } from '../database/elasticsearch';

export interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
  /** 可选依赖异常时功能自动降级，不影响整体状态 */
  optional?: true;
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
 * MySQL 和 Redis 为必需依赖，任一异常则整体状态为 degraded；
 * 已配置的 RabbitMQ（精确超时取消）和 Elasticsearch（商品搜索）为可选依赖，
 * 异常时由定时任务和 MySQL 搜索兜底，只在报告中标记为 down
 */
export async function getHealthReport(serverless = false): Promise<HealthReport> {
  const required: Record<string, () => Promise<unknown>> = {
    mysql: () => getPool().query('SELECT 1'),
    redis: () => getRedisClient().ping(),
  };
  const optional: Record<string, () => Promise<unknown>> = {};
  if (!serverless) {
    if (isRabbitMQConfigured()) optional.rabbitmq = async () => { getChannel(); };
    const es = getESClient();
    if (es) optional.elasticsearch = () => es.ping();
  }
  const run = (checks: Record<string, () => Promise<unknown>>, extra: Partial<DependencyStatus> = {}) => Promise.all(
    Object.entries(checks).map(async ([name, check]) => [name, { ...await checkDependency(check), ...extra }] as const)
  );
  const [requiredResults, optionalResults] = await Promise.all([run(required), run(optional, { optional: true })]);

  return {
    status: requiredResults.every(([, d]) => d.status === 'up') ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    dependencies: Object.fromEntries([...requiredResults, ...optionalResults]),
  };
}
