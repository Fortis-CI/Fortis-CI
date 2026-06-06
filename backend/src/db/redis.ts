/**
 * redis.ts — Redis Client Singleton
 *
 * Provides a shared Redis connection for caching health check results.
 * Health data is cached with a 90-second TTL to reduce Neo4j reads
 * for the frequently-polled dashboard health status endpoint.
 */

import Redis from 'ioredis';
import { config } from '../config/env';

// Create Redis client — ioredis handles reconnection automatically
export const redisClient = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    console.log(`[Redis] Reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
  lazyConnect: true,
});

redisClient.on('connect', () => {
  console.log('[Redis] Connected successfully');
});

redisClient.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

/**
 * Connect to Redis — called once during server boot.
 */
export async function connectRedis(): Promise<void> {
  try {
    await redisClient.connect();
  } catch (err) {
    console.warn('[Redis] Could not connect — health cache will be unavailable:', (err as Error).message);
    // Non-fatal: the app still works without Redis (falls back to Neo4j)
  }
}

// ─── Health Cache Helpers ─────────────────────────────────────────────────────

const HEALTH_KEY_PREFIX = 'health:';
const HEALTH_TTL_SECONDS = 90;

interface CachedHealthStatus {
  serviceId: string;
  serviceName: string;
  status: string;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
  checkedAt: string;
}

/**
 * Cache a health check result in Redis.
 * Key: health:{serviceId}, TTL: 90s
 */
export async function cacheHealthStatus(
  serviceId: string,
  data: CachedHealthStatus
): Promise<void> {
  try {
    const key = `${HEALTH_KEY_PREFIX}${serviceId}`;
    await redisClient.setex(key, HEALTH_TTL_SECONDS, JSON.stringify(data));
  } catch (err) {
    // Non-fatal — cache miss just means Neo4j will be queried
    console.warn('[Redis] Failed to cache health status:', (err as Error).message);
  }
}

/**
 * Retrieve a cached health status for a specific service.
 * Returns null if not cached or expired.
 */
export async function getCachedHealthStatus(
  serviceId: string
): Promise<CachedHealthStatus | null> {
  try {
    const key = `${HEALTH_KEY_PREFIX}${serviceId}`;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Retrieve all cached health statuses.
 * Scans Redis for all health:* keys and returns their values.
 */
export async function getAllCachedHealthStatuses(): Promise<CachedHealthStatus[]> {
  try {
    const keys = await redisClient.keys(`${HEALTH_KEY_PREFIX}*`);
    if (keys.length === 0) return [];

    const pipeline = redisClient.pipeline();
    for (const key of keys) {
      pipeline.get(key);
    }

    const results = await pipeline.exec();
    if (!results) return [];

    return results
      .map(([err, data]) => {
        if (err || !data) return null;
        try {
          return JSON.parse(data as string) as CachedHealthStatus;
        } catch {
          return null;
        }
      })
      .filter((item): item is CachedHealthStatus => item !== null);
  } catch {
    return [];
  }
}
