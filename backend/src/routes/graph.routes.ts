import { Router } from 'express';
import { getServiceDependenciesGraph, getDeploymentChainGraph } from '../services/graphVisualizer';

const router = Router();

// GET /api/graph/service-dependencies
router.get('/service-dependencies', async (req, res) => {
  try {
    const graphData = await getServiceDependenciesGraph();
    res.json({ data: graphData });
  } catch (err) {
    console.error('[graph.routes] Error fetching service dependencies graph:', err);
    res.status(500).json({ error: 'Failed to fetch graph data' });
  }
});

// GET /api/graph/deployment-chain/:serviceId
router.get('/deployment-chain/:serviceId', async (req, res) => {
  try {
    const graphData = await getDeploymentChainGraph(req.params.serviceId);
    res.json({ data: graphData });
  } catch (err) {
    console.error('[graph.routes] Error fetching deployment chain graph:', err);
    res.status(500).json({ error: 'Failed to fetch graph data' });
  }
});

export default router;
