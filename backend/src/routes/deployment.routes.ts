/**
 * deployment.routes.ts — Deployment REST Endpoints
 *
 * GET  /api/deployments           — paginated deployment list
 * GET  /api/deployments/:id       — single deployment + commit detail
 * POST /api/deployments/:id/redeploy — trigger manual redeploy via GitHub Actions
 */

import { Router } from 'express';
import { getDeployments, getDeploymentById } from '../services/graphService';
import { rerunWorkflow, parseRepoUrl } from '../services/github.service';

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

export default router;
