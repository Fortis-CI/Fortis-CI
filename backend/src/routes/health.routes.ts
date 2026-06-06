/**
 * health.routes.ts — Service Health Status REST Endpoints
 *
 * GET /api/health-status           — all services + latest health (Redis → Neo4j fallback)
 * GET /api/health-status/:serviceId — last N health checks for a service
 */

import { Router } from 'express';
import { getAllServices, getHealthHistory } from '../services/graphService';
import { getAllCachedHealthStatuses, getCachedHealthStatus } from '../db/redis';

const router = Router();

// GET /api/health-status
// Try Redis cache first for fast dashboard reads, fall back to Neo4j
router.get('/', async (_req, res) => {
  try {
    // Try Redis cache first
    const cached = await getAllCachedHealthStatuses();

    if (cached.length > 0) {
      // Enrich with service data from Neo4j
      const services = await getAllServices();
      const enriched = services.map((svc) => {
        const cachedHealth = cached.find((c) => c.serviceId === svc.id);
        return {
          ...svc,
          cachedHealth: cachedHealth ?? null,
        };
      });
      res.json({ data: enriched, source: 'redis' });
      return;
    }

    // Fallback to Neo4j
    const services = await getAllServices();
    res.json({ data: services, source: 'neo4j' });
  } catch (err) {
    console.error('[health.routes] GET /health-status error:', err);
    res.status(500).json({ error: 'Failed to fetch health status' });
  }
});

// GET /api/health-status/:serviceId
// Returns health history from Neo4j (Redis only caches latest)
router.get('/:serviceId', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

    // Get latest from Redis cache for fast response
    const cached = await getCachedHealthStatus(req.params.serviceId);

    // Get historical data from Neo4j
    const history = await getHealthHistory(req.params.serviceId, limit);

    res.json({
      data: {
        latest: cached,
        history,
      },
    });
  } catch (err) {
    console.error('[health.routes] GET /health-status/:serviceId error:', err);
    res.status(500).json({ error: 'Failed to fetch health history' });
  }
});

export default router;
