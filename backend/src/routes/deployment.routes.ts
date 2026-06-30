/**
 * deployment.routes.ts — Deployment REST Endpoints
 *
 * GET  /api/deployments           — paginated deployment list
 * GET  /api/deployments/:id       — single deployment + commit detail
 * POST /api/deployments/:id/redeploy — trigger manual redeploy via GitHub Actions
 * GET  /api/deployments/:id/rollback-preview — preview rollback impact
 * POST /api/deployments/:id/rollback — trigger manual rollback to last healthy
 */

import { Router } from 'express';
import { getDeployments, getDeploymentById, getRollbackPreview, getDeploymentComparison } from '../services/graphService';
import { rerunWorkflow, parseRepoUrl } from '../services/github.service';
import { getEnvDriftForDeployment } from '../services/envDrift.service';
import { triggerRollback } from '../services/rollbackEngine';

const router = Router();

// GET /api/deployments?serviceId=xxx&limit=50&offset=0
router.get('/', async (req, res) => {
  try {
    const { serviceId, limit, offset } = req.query;
    const deployments = await getDeployments(
      serviceId as string | undefined,
      limit ? parseInt(limit as string) : 50,
      offset ? parseInt(offset as string) : 0
    );
    res.json({ data: deployments, count: deployments.length });
  } catch (err) {
    console.error('[deployment.routes] GET /deployments error:', err);
    res.status(500).json({ error: 'Failed to fetch deployments' });
  }
});

// GET /api/deployments/:id
router.get('/:id', async (req, res) => {
  try {
    const deployment = await getDeploymentById(req.params.id);
    if (!deployment) {
      res.status(404).json({ error: 'Deployment not found' });
      return;
    }
    res.json({ data: deployment });
  } catch (err) {
    console.error('[deployment.routes] GET /deployments/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch deployment' });
  }
});

// POST /api/deployments/:id/redeploy
// Triggers a re-run of the GitHub Actions workflow for this deployment
router.post('/:id/redeploy', async (req, res) => {
  try {
    const deployment = await getDeploymentById(req.params.id);
    if (!deployment) {
      res.status(404).json({ error: 'Deployment not found' });
      return;
    }

    // Get the repo URL from the commit or service
    const repoUrl = deployment.commit?.repoUrl || (deployment as any).service?.repoUrl;
    if (!repoUrl) {
      res.status(400).json({
        error: 'Cannot determine repository URL for this deployment',
      });
      return;
    }

    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) {
      res.status(400).json({
        error: `Invalid repository URL: ${repoUrl}`,
      });
      return;
    }

    // Get the workflow run ID
    const workflowRunId = deployment.workflowRunId;
    if (!workflowRunId) {
      res.status(400).json({
        error: 'No workflow run ID associated with this deployment',
      });
      return;
    }

    // Convert Neo4j Integer to number if needed
    const runId = typeof workflowRunId === 'object' && 'toNumber' in workflowRunId
      ? (workflowRunId as any).toNumber()
      : Number(workflowRunId);

    console.log(`[Redeploy] Triggering rerun for ${parsed.owner}/${parsed.repo} run #${runId}`);
    const result = await rerunWorkflow(parsed.owner, parsed.repo, runId);

    if (result.success) {
      res.json({
        message: result.message,
        deploymentId: deployment.id,
        workflowRunId: runId,
      });
    } else {
      res.status(422).json({
        error: result.message,
        deploymentId: deployment.id,
      });
    }
  } catch (err) {
    console.error('[deployment.routes] POST /deployments/:id/redeploy error:', err);
    res.status(500).json({ error: 'Failed to trigger redeploy' });
  }
});

// GET /api/deployments/:id/env-drift
router.get('/:id/env-drift', async (req, res) => {
  try {
    const drift = await getEnvDriftForDeployment(req.params.id);
    res.json({ data: drift });
  } catch (err) {
    console.error('[deployment.routes] GET /deployments/:id/env-drift error:', err);
    res.status(500).json({ error: 'Failed to fetch env drift' });
  }
});

// GET /api/deployments/:id/compare/:prevId
router.get('/:id/compare/:prevId', async (req, res) => {
  try {
    let prevId = req.params.prevId;
    
    // If prevId is 'previous', find the immediate preceding deployment
    if (prevId === 'previous') {
      const history = await getDeployments(undefined, 50, 0); // Fetch recent deployments
      const currIndex = history.findIndex(d => d.id === req.params.id);
      if (currIndex !== -1 && currIndex + 1 < history.length) {
        prevId = history[currIndex + 1].id;
      } else {
        res.status(404).json({ error: 'No previous deployment found' });
        return;
      }
    }

    const comparison = await getDeploymentComparison(req.params.id, prevId);
    if (!comparison) {
      res.status(404).json({ error: 'Deployments not found for comparison' });
      return;
    }
    res.json({ data: comparison });
  } catch (err) {
    console.error('[deployment.routes] GET /deployments/:id/compare/:prevId error:', err);
    res.status(500).json({ error: 'Failed to fetch deployment comparison' });
  }
});

// GET /api/deployments/:id/rollback-preview
router.get('/:id/rollback-preview', async (req, res) => {
  try {
    const preview = await getRollbackPreview(req.params.id);
    if (!preview) {
      res.status(404).json({ error: 'No healthy deployment found to rollback to' });
      return;
    }
    res.json({ data: preview });
  } catch (err) {
    console.error('[deployment.routes] GET /deployments/:id/rollback-preview error:', err);
    res.status(500).json({ error: 'Failed to generate rollback preview' });
  }
});

// POST /api/deployments/:id/rollback
router.post('/:id/rollback', async (req, res) => {
  try {
    const deployment = await getDeploymentById(req.params.id);
    if (!deployment || !deployment.serviceId) {
      res.status(404).json({ error: 'Deployment or service not found' });
      return;
    }
    
    await triggerRollback(
      deployment.serviceId,
      deployment.id,
      deployment.commit?.sha || '',
      'Manual rollback triggered via dashboard'
    );
    
    res.json({ message: 'Rollback initiated successfully' });
  } catch (err) {
    console.error('[deployment.routes] POST /deployments/:id/rollback error:', err);
    res.status(500).json({ error: 'Failed to trigger rollback' });
  }
});

export default router;
