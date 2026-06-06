/**
 * healthWorker.ts — Background Health Monitoring Cron
 *
 * Polls all registered services every 60 seconds.
 * For each service:
 *   1. HTTP GET the health endpoint (10s timeout)
 *   2. Classify: healthy (<500ms + 200) | degraded (>500ms + 200) | down (non-200/timeout)
 *   3. Create HealthCheck node in Neo4j
 *   4. Cache result in Redis (90s TTL)
 *
 * Uses a simple concurrency limiter (max 20 parallel health checks).
 */

import cron from 'node-cron';
import axios from 'axios';
import { getAllServices, createHealthCheck } from './graphService';
import { cacheHealthStatus } from '../db/redis';
import { HealthStatus } from '../types/deployment.types';

/**
 * Simple concurrency limiter — runs at most N promises concurrently.
 * Equivalent to p-limit but without the external dependency.
 */
function concurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const results: T[] = new Array(tasks.length);
    let running = 0;
    let completed = 0;
    let index = 0;

    function runNext() {
      if (completed === tasks.length) {
        resolve(results);
        return;
      }
      while (running < maxConcurrency && index < tasks.length) {
        const currentIndex = index++;
        running++;
        tasks[currentIndex]()
          .then((result) => {
            results[currentIndex] = result;
            running--;
            completed++;
            runNext();
          })
          .catch(reject);
      }
    }

    runNext();
  });
}

const HEALTH_CHECK_TIMEOUT_MS = 10_000; // 10 second timeout per request
const MAX_CONCURRENCY = 20;
const HEALTHY_THRESHOLD_MS = 500;

/**
 * Perform a single health check for a service.
 */
async function checkServiceHealth(
  serviceId: string,
  serviceName: string,
  healthEndpoint: string
): Promise<void> {
  let status: HealthStatus = 'unknown';
  let statusCode: number | null = null;
  let responseTimeMs: number | null = null;
  let error: string | null = null;

  const startTime = Date.now();

  try {
    const response = await axios.get(healthEndpoint, {
      timeout: HEALTH_CHECK_TIMEOUT_MS,
      validateStatus: () => true, // Don't throw on non-2xx
    });

    responseTimeMs = Date.now() - startTime;
    statusCode = response.status;

    if (statusCode >= 200 && statusCode < 300) {
      status = responseTimeMs <= HEALTHY_THRESHOLD_MS ? 'healthy' : 'degraded';
    } else {
      status = 'unhealthy';
      error = `HTTP ${statusCode}`;
    }
  } catch (err: any) {
    responseTimeMs = Date.now() - startTime;
    status = 'unhealthy';

    if (err.code === 'ECONNREFUSED') {
      error = `Connection refused: ${healthEndpoint}`;
    } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      error = `Timeout after ${HEALTH_CHECK_TIMEOUT_MS}ms`;
    } else if (err.code === 'ENOTFOUND') {
      error = `DNS lookup failed: ${healthEndpoint}`;
    } else {
      error = err.message || 'Unknown error';
    }
  }

  // Persist to Neo4j
  try {
    await createHealthCheck(serviceId, status, statusCode, responseTimeMs, error);
  } catch (dbErr) {
    console.error(`[HealthWorker] Failed to save health check for ${serviceName}:`, dbErr);
  }

  // Cache in Redis
  try {
    await cacheHealthStatus(serviceId, {
      serviceId,
      serviceName,
      status,
      statusCode,
      responseTimeMs,
      error,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    // Non-fatal
  }

  // Log result
  const icon = status === 'healthy' ? '🟢' : status === 'degraded' ? '🟡' : '🔴';
  console.log(
    `[HealthWorker] ${icon} ${serviceName}: ${status} ` +
    `(${responseTimeMs}ms${statusCode ? `, HTTP ${statusCode}` : ''}` +
    `${error ? `, ${error}` : ''})`
  );
}

/**
 * Run one full health check cycle across all registered services.
 */
async function runHealthCheckCycle(): Promise<void> {
  const cycleStart = Date.now();

  try {
    const services = await getAllServices();

    if (services.length === 0) {
      return; // No services registered — nothing to check
    }

    const servicesToCheck = services.filter((svc) => svc.healthEndpoint);

    const tasks = servicesToCheck.map((svc) => () =>
      checkServiceHealth(svc.id, svc.name, svc.healthEndpoint)
    );

    await concurrencyLimit(tasks, MAX_CONCURRENCY);

    const cycleDuration = Date.now() - cycleStart;
    console.log(
      `[HealthWorker] Cycle complete: ${servicesToCheck.length} services checked in ${cycleDuration}ms`
    );

    if (cycleDuration > 60_000) {
      console.warn(
        `[HealthWorker] ⚠️ Cycle took ${cycleDuration}ms (>60s) — ` +
        `consider reducing service count or increasing concurrency`
      );
    }
  } catch (err) {
    console.error('[HealthWorker] Cycle failed:', err);
  }
}

/**
 * Start the health worker cron job.
 * Runs every 60 seconds. Exported so app.ts can call it during boot.
 */
export async function startHealthWorker(): Promise<void> {
  console.log('[HealthWorker] Starting health monitoring (every 60s)...');

  // Run immediately on startup
  await runHealthCheckCycle();

  // Schedule recurring check
  cron.schedule('* * * * *', async () => {
    await runHealthCheckCycle();
  });
}

