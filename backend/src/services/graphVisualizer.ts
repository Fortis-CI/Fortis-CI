import { executeQuery } from '../db/index';

/**
 * Fetches the entire Service DEPENDS_ON graph for visualization.
 */
export async function getServiceDependenciesGraph(): Promise<{ nodes: any[], links: any[] }> {
  const query = `
    MATCH (s:Service)
    OPTIONAL MATCH (s)-[r:DEPENDS_ON]->(target:Service)
    RETURN s, r, target
  `;
  const result = await executeQuery(query, {});
  
  const nodesMap = new Map();
  const links: any[] = [];
  
  result.records.forEach(row => {
    const s = row.get('s').properties;
    if (!nodesMap.has(s.id)) {
      nodesMap.set(s.id, { id: s.id, name: s.name, group: 'Service', val: 20 });
    }
    
    const target = row.get('target');
    if (target) {
      const t = target.properties;
      if (!nodesMap.has(t.id)) {
        nodesMap.set(t.id, { id: t.id, name: t.name, group: 'Service', val: 20 });
      }
      links.push({ source: s.id, target: t.id, type: 'DEPENDS_ON' });
    }
  });
  
  return { nodes: Array.from(nodesMap.values()), links };
}

/**
 * Fetches the Deployment chain (SUCCEEDED_BY / REPLACED_BY) for visualization.
 */
export async function getDeploymentChainGraph(serviceId: string): Promise<{ nodes: any[], links: any[] }> {
  const query = `
    MATCH (d:Deployment)-[:DEPLOYED_TO]->(s:Service { id: $serviceId })
    OPTIONAL MATCH (d)-[r:SUCCEEDED_BY|ROLLED_BACK_TO|REPLACED_BY]->(target:Deployment)
    RETURN d, r, target
  `;
  
  const result = await executeQuery(query, { serviceId });
  
  const nodesMap = new Map();
  const links: any[] = [];
  
  result.records.forEach(row => {
    const d = row.get('d').properties;
    if (!nodesMap.has(d.id)) {
      nodesMap.set(d.id, { 
        id: d.id, 
        name: `Deploy #${d.workflowRunId?.toNumber ? d.workflowRunId.toNumber() : d.workflowRunId}`, 
        group: d.conclusion === 'success' ? 'Success' : 'Failure',
        val: 10
      });
    }
    
    const target = row.get('target');
    const r = row.get('r');
    if (target && r) {
      const t = target.properties;
      if (!nodesMap.has(t.id)) {
        nodesMap.set(t.id, { 
          id: t.id, 
          name: `Deploy #${t.workflowRunId?.toNumber ? t.workflowRunId.toNumber() : t.workflowRunId}`, 
          group: t.conclusion === 'success' ? 'Success' : 'Failure',
          val: 10
        });
      }
      links.push({ source: d.id, target: t.id, type: r.type });
    }
  });
  
  return { nodes: Array.from(nodesMap.values()), links };
}
