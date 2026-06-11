/**
 * app.ts — Fortis-CI Backend Entry Point
 *
 * Starts the Express server with all middleware, routes, and background workers.
 * Boot sequence:
 *   1. Validate environment config (fail fast on missing vars)
 *   2. Connect to Neo4j and apply schema
 *   3. Connect to Redis
 *   4. Register all API routes
 *   5. Start health worker cron
 *   6. Start Express server
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { config } from './config/env';
import { driver } from './db/index';
import { applySchema } from './db/applySchema';
import { connectRedis, redisClient } from './db/redis';
import { startHealthWorker } from './services/healthWorker';
import { importYamlServices } from './utils/yamlParser';
import { validateLicense } from './services/license.service';

// Route imports
import deploymentRoutes from './routes/deployment.routes';
import healthRoutes from './routes/health.routes';
import webhookRoutes from './routes/webhook.routes';
import serviceRoutes from './routes/service.routes';
import graphRoutes from './routes/graph.routes';
import setupRoutes from './routes/setup.routes';

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

// Security headers
app.use(helmet());

// CORS — allow Next.js frontend
app.use(
  cors({
    origin: config.FRONTEND_URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Request logging
app.use(morgan('dev'));

// Mount webhooks FIRST so express.raw() can capture the Buffer for HMAC verification
app.use('/webhooks', webhookRoutes);

// JSON body parsing for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health Ping (internal liveness check) ───────────────────────────────────
app.get('/ping', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/services', serviceRoutes);
app.use('/api/deployments', deploymentRoutes);
app.use('/api/health-status', healthRoutes);
app.use('/api/graph', graphRoutes);
app.use('/api/setup', setupRoutes);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
);

// ─── Boot sequence ────────────────────────────────────────────────────────────
async function start() {
  try {
    console.log('[Fortis-CI] Starting backend...');
    console.log(`[Fortis-CI] Environment: ${config.NODE_ENV}`);

    // 0. Validate Enterprise License
    await validateLicense();

    // 1. Verify Neo4j connection
    await driver.verifyConnectivity();
    console.log('[Neo4j] Connected successfully');

    // 2. Apply schema constraints and indexes (idempotent)
    await applySchema();

    // 3. Connect to Redis (non-fatal if unavailable)
    await connectRedis();

    // 4. Auto-import services from YAML (if present)
    await importYamlServices('/app/config/services.yml');
    // await importYamlServices('../sentinel-services.example.yml'); // Fallback for local testing
    // await importYamlServices('/home/ganeshak11/dev/ticketflow/services.yml');

    // 4.5 Auto-import infra contract
    const { importInfraContract } = await import('./utils/infraContractParser');
    // await importInfraContract('/home/ganeshak11/dev/ticketflow/ticketflow-infra/outputs.json');

    // 5. Start health worker (60s polling cron)
    await startHealthWorker();

    // 5. Start Express server
    app.listen(config.PORT, '0.0.0.0', () => {
      console.log('');
      console.log('┌─────────────────────────────────────────────────┐');
      console.log('│           Fortis-CI Backend v1.0.0              │');
      console.log('├─────────────────────────────────────────────────┤');
      console.log(`│  Server:    http://0.0.0.0:${config.PORT}                 │`);
      console.log(`│  Webhook:   POST /webhooks/github               │`);
      console.log(`│  API:       /api/services, /api/deployments     │`);
      console.log(`│  Health:    /api/health-status                  │`);
      console.log('└─────────────────────────────────────────────────┘');
      console.log('');
    });
  } catch (err) {
    console.error('[FATAL] Failed to start server:', err);
    await driver.close();
    process.exit(1);
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`[Fortis-CI] ${signal} received — shutting down gracefully`);
  try {
    await redisClient.quit();
  } catch { /* ignore */ }
  await driver.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
