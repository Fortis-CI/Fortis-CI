import { executeQuery } from '../db/index';

/**
 * Fetches the entire Service and Infrastructure dependency graph for visualization.
 */
export async function getServiceDependenciesGraph(): Promise<{ nodes: any[], links: any[] }> {
  const query = `
    MATCH (s:Service)
    OPTIONAL MATCH (s)-[r1:DEPENDS_ON_SERVICE]->(targetSvc:Service)
    OPTIONAL MATCH (s)-[r2:DEPENDS_ON_RESOURCE]->(lr:LogicalResource)-[r3:HOSTED_ON]->(pi:PhysicalInfra)
    RETURN s, r1, targetSvc, lr, r2, r3, pi
  `;
  const result = await executeQuery(query, {});
  
  const nodesMap = new Map();
  const links: any[] = [];
  
  result.records.forEach(row => {
    const s = row.get('s').properties;
    if (!nodesMap.has(s.id)) {
      nodesMap.set(s.id, { id: s.id, name: s.name, group: 'Service', val: 20 });
    }
    
    const targetSvc = row.get('targetSvc');
    const r1 = row.get('r1');
    if (targetSvc && r1) {
      const t = targetSvc.properties;
      if (!nodesMap.has(t.id)) {
        nodesMap.set(t.id, { id: t.id, name: t.name, group: 'Service', val: 20 });
      }
      links.push({ source: s.id, target: t.id, type: r1.type, criticality: r1.properties.criticality });
    }

    const lr = row.get('lr');
    const pi = row.get('pi');
    if (lr && pi) {
      const l = lr.properties;
      const p = pi.properties;
      if (!nodesMap.has(l.id)) {
        nodesMap.set(l.id, { id: l.id, name: l.logicalName, group: 'LogicalResource', type: l.type, val: 15 });
      }
      if (!nodesMap.has(p.id)) {
        nodesMap.set(p.id, { id: p.id, name: p.name, group: 'PhysicalInfra', type: p.type, val: 25 });
      }
      links.push({ source: s.id, target: l.id, type: 'DEPENDS_ON_RESOURCE' });
      links.push({ source: l.id, target: p.id, type: 'HOSTED_ON' });
    }
  });
  
  return { nodes: Array.from(nodesMap.values()), links };
}

/**
 * Fetches Blast Radius Clusters
 */
export async function getBlastRadiusGraph(): Promise<{ nodes: any[], links: any[] }> {
  const query = `
    MATCH (bre:BlastRadiusEvent)
    OPTIONAL MATCH (bre)-[r1:IMPACTS]->(hi:HealthIncident)<-[r2:EXPERIENCED]-(s:Service)
    OPTIONAL MATCH (bre)-[r3:PRIMARY_CAUSE]->(pi:PhysicalInfra)
    RETURN bre, r1, hi, r2, s, r3, pi
  `;
  const result = await executeQuery(query, {});
  
  const nodesMap = new Map();
  const links: any[] = [];
  
  result.records.forEach(row => {
    const bre = row.get('bre')?.properties;
    if (bre && !nodesMap.has(bre.id)) {
      nodesMap.set(bre.id, { id: bre.id, name: 'Blast Radius Event', group: 'BlastRadiusEvent', val: 30, score: bre.confidenceScore });
    }
    
    const hi = row.get('hi')?.properties;
    const s = row.get('s')?.properties;
    if (bre && hi && s) {
      if (!nodesMap.has(hi.id)) {
        nodesMap.set(hi.id, { id: hi.id, name: 'HealthIncident', group: 'Incident', val: 10 });
      }
      if (!nodesMap.has(s.id)) {
        nodesMap.set(s.id, { id: s.id, name: s.name, group: 'Service', val: 20 });
      }
      links.push({ source: bre.id, target: hi.id, type: 'IMPACTS' });
      links.push({ source: s.id, target: hi.id, type: 'EXPERIENCED' });
    }

    const pi = row.get('pi')?.properties;
    if (bre && pi) {
      if (!nodesMap.has(pi.id)) {
        nodesMap.set(pi.id, { id: pi.id, name: pi.name, group: 'PhysicalInfra', type: pi.type, val: 25 });
      }
      links.push({ source: bre.id, target: pi.id, type: 'PRIMARY_CAUSE' });
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
