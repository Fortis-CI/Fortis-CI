/**
 * service.routes.ts — Service Registry REST Endpoints
 *
 * GET    /api/services           — list all services with latest health
 * GET    /api/services/:id       — single service detail
 * POST   /api/services           — register a new service
 * POST   /api/services/import    — bulk import from YAML config
 * DELETE /api/services/:id       — remove a service
 */

import { Router } from 'express';
import {
  getAllServices,
  getServiceById,
  createService,
  createDependsOnService,
  deleteService,
} from '../services/graphService';
import { getMaxServicesAllowed } from '../services/license.service';

const router = Router();

// GET /api/services
router.get('/', async (_req, res) => {
  try {
    const services = await getAllServices();
    res.json({ data: services, count: services.length });
  } catch (err) {
    console.error('[service.routes] GET /services error:', err);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// GET /api/services/:id
router.get('/:id', async (req, res) => {
  try {
    const service = await getServiceById(req.params.id);
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    res.json({ data: service });
  } catch (err) {
    console.error('[service.routes] GET /services/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch service' });
  }
});

// POST /api/services
router.post('/', async (req, res) => {
  try {
    const { name, repoUrl, healthEndpoint, environment, dependencies } = req.body;

    // License Check
    const currentServices = await getAllServices();
    if (currentServices.length >= getMaxServicesAllowed()) {
      res.status(403).json({ error: 'Free tier limit reached (3 services max). Please upgrade to Enterprise.' });
      return;
    }

    // Validate required fields
    if (!name || !repoUrl || !healthEndpoint) {
      res.status(400).json({
        error: 'Missing required fields: name, repoUrl, healthEndpoint',
      });
      return;
    }

    // Create the service
    const service = await createService({
      name,
      repoUrl,
      healthEndpoint,
      environment,
    });

    // Create dependency relationships if provided
    if (dependencies && Array.isArray(dependencies)) {
      for (const depName of dependencies) {
        try {
          await createDependsOnService(service.id, depName, 'hard');
          console.log(`[Service] Linked ${name} -> DEPENDS_ON -> ${depName}`);
        } catch (depErr) {
          console.warn(`[Service] Could not link dependency ${depName}:`, depErr);
          // Non-fatal — dependency might not be registered yet
        }
      }
    }

    console.log(`[Service] Registered: ${name} (${repoUrl})`);
    res.status(201).json({ data: service });
  } catch (err) {
    console.error('[service.routes] POST /services error:', err);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// POST /api/services/import — Bulk import from YAML-style JSON array
// Expects: { services: [{ name, repo, health_url, environment, dependencies }] }
router.post('/import', async (req, res) => {
  try {
    const { services } = req.body;

    if (!services || !Array.isArray(services) || services.length === 0) {
      res.status(400).json({
        error: 'Request body must contain a "services" array',
      });
      return;
    }

    // License Check
    const currentServices = await getAllServices();
    const maxAllowed = getMaxServicesAllowed();
    
    if (currentServices.length + services.length > maxAllowed) {
      res.status(403).json({ error: `Cannot import ${services.length} services. Free tier limit is ${maxAllowed}.` });
      return;
    }

    const results: Array<{ name: string; status: string; id?: string; error?: string }> = [];

    for (const svc of services) {
      try {
        const service = await createService({
          name: svc.name,
          repoUrl: svc.repo || svc.repoUrl,
          healthEndpoint: svc.health_url || svc.healthEndpoint,
          environment: svc.environment,
        });

        // Create dependency relationships
        const deps = svc.dependencies || [];
        for (const depName of deps) {
          try {
            await createDependsOnService(service.id, depName, 'hard');
          } catch {
            // Non-fatal — dependency might not be registered yet
          }
        }

        results.push({ name: svc.name, status: 'created', id: service.id });
      } catch (svcErr) {
        results.push({
          name: svc.name,
          status: 'failed',
          error: (svcErr as Error).message,
        });
      }
    }

    const created = results.filter((r) => r.status === 'created').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    console.log(`[Service] Bulk import: ${created} created, ${failed} failed`);
    res.status(201).json({
      message: `Imported ${created}/${services.length} services`,
      data: results,
    });
  } catch (err) {
    console.error('[service.routes] POST /services/import error:', err);
    res.status(500).json({ error: 'Failed to import services' });
  }
});

// DELETE /api/services/:id
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteService(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    res.json({ message: 'Service deleted successfully' });
  } catch (err) {
    console.error('[service.routes] DELETE /services/:id error:', err);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

export default router;
