/**
 * graphService.ts — Neo4j Graph Query Layer
 *
 * This is the SINGLE source of truth for all Neo4j reads and writes.
 * Every other service (webhook, health, deployment) goes through here.
 *
 * Key rules enforced here:
 *  - MERGE is always used instead of CREATE to guarantee idempotency.
 *  - All node IDs use uuid v4 (except Commit which uses SHA as the natural key).
 *  - Relationships are always created with MERGE to avoid duplicates.
 */

import { v4 as uuidv4 } from 'uuid';
import { classifyArgoCDFailure, classifyHealthIncident } from './rcaClassifier';
import neo4j from 'neo4j-driver';
import { executeQuery } from '../db/index';
import {
  Service,
  CreateServiceInput,
  Deployment,
  CreateDeploymentInput,
  Commit,
  CreateCommitInput,
  HealthCheck,
  HealthStatus,
  ServiceWithHealth,
  DeploymentWithCommit,
} from '../types/deployment.types';

// ─── Service Queries ──────────────────────────────────────────────────────────

/**
 * Create or retrieve a :Service node.
 * Uses MERGE on `name` to prevent duplicate registrations.
 */
export async function createService(input: CreateServiceInput): Promise<Service> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const environment = input.environment ?? 'production';

  const query = `
    MERGE (s:Service { name: $name })
    ON CREATE SET
      s.id              = $id,
      s.repoUrl         = $repoUrl,
      s.healthEndpoint  = $healthEndpoint,
      s.environment     = $environment,
      s.createdAt       = $createdAt,
      s.discoveryMethod = 'services.yml'
    ON MATCH SET
      s.repoUrl         = $repoUrl,
      s.healthEndpoint  = $healthEndpoint,
      s.environment     = $environment,
      s.discoveryMethod = 'services.yml'
    RETURN s
  `;

  const result = await executeQuery(query, {
    id,
    name: input.name,
    repoUrl: input.repoUrl,
    healthEndpoint: input.healthEndpoint,
    environment,
    createdAt: now,
  });

  return result.records[0].get('s').properties as Service;
}

/**
 * Fetch a single :Service by its internal id, including the latest deployment.
 */
export async function getServiceById(id: string): Promise<ServiceWithHealth | null> {
  const query = `
    MATCH (s:Service { id: $id })
    OPTIONAL MATCH (d:Deployment)-[:DEPLOYED_TO]->(s)
    OPTIONAL MATCH (d)-[:HAS_HEALTH]->(h:HealthCheck)
    WITH s, d, h
    ORDER BY d.startedAt DESC, h.checkedAt DESC
    WITH s, collect(d)[0] AS latestDeployment, collect(h)[0] AS latestHealth
    RETURN s, latestDeployment, latestHealth
  `;

  const result = await executeQuery(query, { id });
  if (result.records.length === 0) return null;

  const row = result.records[0];
  return {
    ...(row.get('s').properties as Service),
    latestDeployment: row.get('latestDeployment')?.properties ?? null,
    latestHealth: row.get('latestHealth')?.properties ?? null,
  };
}

/**
 * Fetch all :Service nodes with their latest deployment and health check.
 * Used by the health worker and the dashboard overview page.
 */
export async function getAllServices(): Promise<ServiceWithHealth[]> {
  const query = `
    MATCH (s:Service)
    OPTIONAL MATCH (d:Deployment)-[:DEPLOYED_TO]->(s)
    OPTIONAL MATCH (d)-[:HAS_HEALTH]->(h:HealthCheck)
    WITH s, d, h
    ORDER BY d.startedAt DESC, h.checkedAt DESC
    WITH s, collect(d)[0] AS latestDeployment, collect(h)[0] AS latestHealth
    RETURN s, latestDeployment, latestHealth
    ORDER BY s.name ASC
  `;

  const result = await executeQuery(query, {});
  return result.records.map((row) => ({
    ...(row.get('s').properties as Service),
    latestDeployment: row.get('latestDeployment')?.properties ?? null,
    latestHealth: row.get('latestHealth')?.properties ?? null,
  }));
}

/**
 * Find a :Service by its GitHub repository URL.
 * Used by the webhook controller to match incoming webhooks to services.
 */
export async function findServiceByRepoUrl(repoUrl: string): Promise<Service | null> {
  // Try exact match first, then case-insensitive
  const query = `
    MATCH (s:Service)
    WHERE s.repoUrl = $repoUrl
       OR s.repoUrl = $repoUrlLower
       OR toLower(s.repoUrl) = toLower($repoUrl)
    RETURN s
    LIMIT 1
  `;

  const result = await executeQuery(query, {
    repoUrl,
    repoUrlLower: repoUrl.toLowerCase(),
  });

  if (result.records.length === 0) return null;
  return result.records[0].get('s').properties as Service;
}

/**
 * Delete a :Service and all its relationships.
 */
export async function deleteService(id: string): Promise<boolean> {
  const query = `
    MATCH (s:Service { id: $id })
    DETACH DELETE s
    RETURN count(s) AS deleted
  `;

  const result = await executeQuery(query, { id });
  const deleted = result.records[0]?.get('deleted')?.toNumber?.() ?? 0;
  return deleted > 0;
}

export async function createDependsOnService(
  serviceId: string,
  dependencyName: string,
  criticality: 'hard' | 'soft'
): Promise<void> {
  const query = `
    MATCH (s:Service { id: $serviceId })
    MERGE (dep:Service { name: $dependencyName })
    ON CREATE SET
      dep.id = randomUUID(),
      dep.environment = s.environment,
      dep.discoveryMethod = 'inferred'
    MERGE (s)-[r:DEPENDS_ON_SERVICE]->(dep)
    ON CREATE SET r.criticality = $criticality
    ON MATCH SET r.criticality = $criticality
  `;

  await executeQuery(query, { serviceId, dependencyName, criticality });
}

export async function createLogicalResource(name: string, type: string): Promise<void> {
  const query = `
    MERGE (lr:LogicalResource { logicalName: $name })
    ON CREATE SET
      lr.id = randomUUID(),
      lr.type = $type,
      lr.discoveryMethod = 'services.yml'
    ON MATCH SET
      lr.type = $type
  `;
  await executeQuery(query, { name, type });
}

export async function createDependsOnResource(
  serviceId: string,
  resourceName: string
): Promise<void> {
  const query = `
    MATCH (s:Service { id: $serviceId })
    MATCH (lr:LogicalResource { logicalName: $resourceName })
    MERGE (s)-[:DEPENDS_ON_RESOURCE]->(lr)
  `;
  await executeQuery(query, { serviceId, resourceName });
}

export async function createPhysicalInfra(
  id: string,
  name: string,
  type: string,
  provider: string,
  environmentName: string
): Promise<void> {
  const query = `
    MERGE (env:Environment { name: $environmentName })
    MERGE (pi:PhysicalInfra { id: $id })
    ON CREATE SET
      pi.name = $name,
      pi.type = $type,
      pi.provider = $provider,
      pi.discoveryMethod = 'contract'
    ON MATCH SET
      pi.name = $name,
      pi.type = $type,
      pi.provider = $provider
    MERGE (pi)-[:RUNS_IN]->(env)
  `;
  await executeQuery(query, { id, name, type, provider, environmentName });
}

export async function linkHostedOn(
  logicalResourceName: string,
  physicalInfraId: string
): Promise<void> {
  const query = `
    MATCH (lr:LogicalResource { logicalName: $logicalResourceName })
    MATCH (pi:PhysicalInfra { id: $physicalInfraId })
    MERGE (lr)-[:HOSTED_ON]->(pi)
  `;
  await executeQuery(query, { logicalResourceName, physicalInfraId });
}

// ─── Deployment Queries ───────────────────────────────────────────────────────

/**
 * Create or update a :Deployment node and link it to its :Service.
 *
 * MERGE is on workflowRunId — this is the idempotency key.
 * Calling this twice with the same workflowRunId is safe (no duplicates).
 *
 * Relationship: (:Deployment)-[:DEPLOYED_TO]->(:Service)
 */
export async function createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
  const id = uuidv4();

  const query = `
    MATCH (s:Service { id: $serviceId })
    MERGE (d:Deployment { workflowRunId: $workflowRunId })
    ON CREATE SET
      d.id            = $id,
      d.workflowName  = $workflowName,
      d.branch        = $branch,
      d.status        = $status,
      d.conclusion    = $conclusion,
      d.triggeredBy   = $triggeredBy,
      d.startedAt     = $startedAt,
      d.completedAt   = $completedAt,
      d.duration      = $duration,
      d.serviceId     = $serviceId
    ON MATCH SET
      d.status        = $status,
      d.conclusion    = $conclusion,
      d.completedAt   = $completedAt,
      d.duration      = $duration
    MERGE (d)-[:DEPLOYED_TO]->(s)
    RETURN d
  `;

  // Calculate duration in seconds if completedAt is available
  const duration =
    input.completedAt && input.startedAt
      ? Math.round(
          (new Date(input.completedAt).getTime() -
            new Date(input.startedAt).getTime()) /
            1000
        )
      : null;

  const result = await executeQuery(query, {
    id,
    workflowRunId: input.workflowRunId,
    workflowName: input.workflowName,
    branch: input.branch,
    status: input.status,
    conclusion: input.conclusion ?? null,
    triggeredBy: input.triggeredBy,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? null,
    duration,
    serviceId: input.serviceId,
  });

  return result.records[0].get('d').properties as Deployment;
}

/**
 * Link the current deployment to the previous one via SUCCEEDED_BY.
 * This creates the timeline chain used by rollback queries.
 *
 * (Previous Deployment) -[:SUCCEEDED_BY]-> (Current Deployment)
 */
export async function linkSucceededBy(
  serviceId: string,
  currentDeploymentId: string
): Promise<void> {
  const query = `
    MATCH (current:Deployment { id: $currentDeploymentId })
    MATCH (prev:Deployment)-[:DEPLOYED_TO]->(:Service { id: $serviceId })
    WHERE prev.id <> $currentDeploymentId
    WITH prev, current
    ORDER BY prev.startedAt DESC
    LIMIT 1
    MERGE (prev)-[:SUCCEEDED_BY]->(current)
  `;

  await executeQuery(query, { serviceId, currentDeploymentId });
}

/**
 * Fetch a single deployment by its internal id.
 */
export async function getDeploymentById(
  id: string
): Promise<DeploymentWithCommit | null> {
  const query = `
    MATCH (d:Deployment { id: $id })
    OPTIONAL MATCH (d)-[:BASED_ON]->(c:Commit)
    OPTIONAL MATCH (d)-[:DEPLOYED_TO]->(s:Service)
    OPTIONAL MATCH (d)-[:CAUSED_ERROR]->(e:ErrorPattern)
    RETURN d, c, s, e
  `;

  const result = await executeQuery(query, { id });
  if (result.records.length === 0) return null;

  const row = result.records[0];
  return {
    ...(row.get('d').properties as Deployment),
    commit: row.get('c')?.properties ?? null,
    service: row.get('s')?.properties ?? null,
    errorPattern: row.get('e')?.properties ?? null,
  };
}

/**
 * Fetch paginated deployment history, optionally filtered by serviceId.
 */
export async function getDeployments(
  serviceId?: string,
  limit = 50,
  offset = 0
): Promise<DeploymentWithCommit[]> {
  const serviceFilter = serviceId ? 'AND d.serviceId = $serviceId' : '';

  const query = `
    MATCH (d:Deployment)
    WHERE true ${serviceFilter}
    OPTIONAL MATCH (d)-[:BASED_ON]->(c:Commit)
    OPTIONAL MATCH (d)-[:DEPLOYED_TO]->(s:Service)
    RETURN d, c, s
    ORDER BY d.startedAt DESC
    SKIP $offset
    LIMIT $limit
  `;

  const result = await executeQuery(query, {
    serviceId: serviceId ?? null,
    limit: neo4j.int(limit),
    offset: neo4j.int(offset),
  });

  return result.records.map((row) => ({
    ...(row.get('d').properties as Deployment),
    commit: row.get('c')?.properties ?? null,
    service: row.get('s')?.properties ?? null,
  }));
}

// ─── Commit Queries ───────────────────────────────────────────────────────────

/**
 * Create or retrieve a :Commit node and link it to its :Deployment.
 *
 * MERGE is on sha — the git commit hash is the natural unique key.
 *
 * Relationship: (:Deployment)-[:BASED_ON]->(:Commit)
 */
export async function createCommit(
  input: CreateCommitInput,
  workflowRunId: number
): Promise<Commit> {
  const query = `
    MATCH (d:Deployment { workflowRunId: $workflowRunId })
    MERGE (c:Commit { sha: $sha })
    ON CREATE SET
      c.message     = $message,
      c.author      = $author,
      c.authorEmail = $authorEmail,
      c.timestamp   = $timestamp,
      c.repoUrl     = $repoUrl
    MERGE (d)-[:BASED_ON]->(c)
    RETURN c
  `;

  const result = await executeQuery(query, {
    sha: input.sha,
    message: input.message,
    author: input.author,
    authorEmail: input.authorEmail,
    timestamp: input.timestamp,
    repoUrl: input.repoUrl,
    workflowRunId,
  });

  return result.records[0].get('c').properties as Commit;
}

// ─── HealthCheck Queries ──────────────────────────────────────────────────────

/**
 * Persist a :HealthCheck node and link it to its :Service.
 * Called by the health worker every 60 seconds.
 *
 * Relationship: (:Service)-[:HAS_HEALTH]->(:HealthCheck)
 */
export async function createHealthCheck(
  serviceId: string,
  status: HealthStatus,
  statusCode: number | null,
  responseTimeMs: number | null,
  error: string | null
): Promise<HealthCheck> {
  const id = uuidv4();
  const checkedAt = new Date().toISOString();

  const query = `
    MATCH (s:Service { id: $serviceId })
    CREATE (h:HealthCheck {
      id:             $id,
      serviceId:      $serviceId,
      status:         $status,
      statusCode:     $statusCode,
      responseTimeMs: $responseTimeMs,
      error:          $error,
      checkedAt:      $checkedAt
    })
    MERGE (s)-[:HAS_HEALTH]->(h)
    RETURN h
  `;

  const result = await executeQuery(query, {
    id,
    serviceId,
    status,
    statusCode,
    responseTimeMs,
    error,
    checkedAt,
  });

  return result.records[0].get('h').properties as HealthCheck;
}

/**
 * Fetch the last N health checks for a given service, newest first.
 * Used by the health API route: GET /api/health-status/:serviceId
 */
export async function getHealthHistory(
  serviceId: string,
  limit = 10
): Promise<HealthCheck[]> {
  const query = `
    MATCH (s:Service { id: $serviceId })-[:HAS_HEALTH]->(h:HealthCheck)
    RETURN h
    ORDER BY h.checkedAt DESC
    LIMIT $limit
  `;

  const result = await executeQuery(query, { serviceId, limit });
  return result.records.map((row) => row.get('h').properties as HealthCheck);
}

// ─── V2: Intelligence Queries (Errors, Files, Rollbacks) ──────────────

export async function createErrorPattern(
  deploymentId: string,
  type: string,
  message: string,
  confidence: number
): Promise<void> {
  const id = uuidv4();
  const query = `
    MATCH (d:Deployment { id: $deploymentId })
    MERGE (e:ErrorPattern { type: $type, message: $message })
    ON CREATE SET e.id = $id, e.confidence = $confidence
    MERGE (d)-[:CAUSED_ERROR]->(e)
  `;
  await executeQuery(query, { deploymentId, type, message, confidence, id });
}

export async function createFileChanged(
  commitSha: string,
  filePath: string,
  status: string,
  additions: number,
  deletions: number
): Promise<void> {
  const query = `
    MATCH (c:Commit { sha: $commitSha })
    MERGE (f:File { path: $filePath })
    MERGE (c)-[rel:CHANGED_FILE]->(f)
    ON CREATE SET rel.status = $status, rel.additions = $additions, rel.deletions = $deletions
  `;
  await executeQuery(query, { commitSha, filePath, status, additions, deletions });
}

export async function createRollbackEvent(
  triggeredById: string,
  rolledBackToId: string,
  reason: string
): Promise<void> {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  const query = `
    MATCH (bad:Deployment { id: $triggeredById })
    MATCH (good:Deployment { id: $rolledBackToId })
    CREATE (r:RollbackEvent { id: $id, timestamp: $timestamp, reason: $reason })
    MERGE (bad)-[:TRIGGERED]->(r)
    MERGE (r)-[:ROLLED_BACK_TO]->(good)
  `;
  await executeQuery(query, { triggeredById, rolledBackToId, reason, id, timestamp });
}

export async function findLastHealthyDeployment(serviceId: string): Promise<Deployment | null> {
  // Find a deployment for the service that doesn't have an error and its latest health check isn't 'down'
  const query = `
    MATCH (d:Deployment)-[:DEPLOYED_TO]->(s:Service { id: $serviceId })
    OPTIONAL MATCH (d)-[:CAUSED_ERROR]->(e:ErrorPattern)
    OPTIONAL MATCH (d)-[:HAS_HEALTH]->(h:HealthCheck)
    WITH d, e, h
    ORDER BY h.checkedAt DESC
    WITH d, collect(e) as errors, collect(h)[0] as latestHealth
    WHERE size(errors) = 0 AND (latestHealth IS NULL OR latestHealth.status = 'healthy')
    RETURN d
    ORDER BY d.startedAt DESC
    LIMIT 1
  `;
  const result = await executeQuery(query, { serviceId });
  if (result.records.length === 0) return null;
  return result.records[0].get('d').properties as Deployment;
}

export async function setDeploymentRiskScore(deploymentId: string, score: number, label: string, hasStatefulChanges: boolean = false): Promise<void> {
  const query = `
    MATCH (d:Deployment { id: $deploymentId })
    SET d.riskScore = $score, 
        d.riskLabel = $label,
        d.hasStatefulChanges = $hasStatefulChanges
  `;
  await executeQuery(query, { deploymentId, score, label, hasStatefulChanges });
}

// ─── V3: Intelligence Queries (Env Drift, Graph Scoring) ──────────────

export async function createEnvSnapshot(
  deploymentId: string,
  secrets: { name: string; updated_at: string }[]
): Promise<void> {
  const secretsJSON = JSON.stringify(secrets);
  const id = 'env_' + deploymentId;
  const query = `
    MATCH (d:Deployment { id: $deploymentId })
    MERGE (e:EnvSnapshot { id: $id })
    ON CREATE SET e.secrets = $secretsJSON
    ON MATCH SET e.secrets = $secretsJSON
    MERGE (d)-[:HAS_ENV]->(e)
  `;
  await executeQuery(query, { deploymentId, id, secretsJSON });
}

export async function getPreviousEnvSnapshot(
  deploymentId: string
): Promise<{ secrets: { name: string; updated_at: string }[] } | null> {
  const query = `
    MATCH (curr:Deployment { id: $deploymentId })
    MATCH (prev:Deployment)-[:SUCCEEDED_BY]->(curr)
    MATCH (prev)-[:HAS_ENV]->(e:EnvSnapshot)
    RETURN e
    LIMIT 1
  `;
  const result = await executeQuery(query, { deploymentId });
  if (result.records.length === 0) return null;
  const e = result.records[0].get('e').properties;
  return {
    secrets: JSON.parse(e.secrets || '[]')
  };
}

export async function getFileFailureCount(filePath: string): Promise<number> {
  const query = `
    MATCH (f:File { path: $filePath })<-[:CHANGED_FILE|RELATED_TO_FILE]-(c:Commit)<-[:BASED_ON]-(d:Deployment)
    WHERE d.conclusion = 'failure' OR (d)-[:CAUSED_ERROR]->(:ErrorPattern)
    RETURN count(DISTINCT d) AS failureCount
  `;
  const result = await executeQuery(query, { filePath });
  if (result.records.length === 0) return 0;
  return result.records[0].get('failureCount').toNumber();
}

export async function getRollbackPreview(deploymentId: string): Promise<any> {
  const query = `
    MATCH (bad:Deployment { id: $deploymentId })-[:DEPLOYED_TO]->(s:Service)
    OPTIONAL MATCH (bad)-[:BASED_ON]->(badC:Commit)-[rel:CHANGED_FILE]->(f:File)
    WITH bad, s, badC, count(f) as filesChanged
    
    // Find last healthy
    OPTIONAL MATCH (good:Deployment)-[:DEPLOYED_TO]->(s)
    WHERE good.id <> bad.id 
      AND NOT (good)-[:CAUSED_ERROR]->(:ErrorPattern)
    WITH bad, s, filesChanged, good
    ORDER BY good.startedAt DESC
    LIMIT 1
    
    OPTIONAL MATCH (good)-[:BASED_ON]->(goodC:Commit)
    
    // Blast radius
    OPTIONAL MATCH (s)<-[:DEPENDS_ON]-(dep:Service)
    WITH bad, s, filesChanged, good, goodC, collect(dep.name) as blastRadius
    
    RETURN {
      targetId: good.id,
      targetSha: goodC.sha,
      filesChanged: filesChanged,
      blastRadius: blastRadius
    } as preview
  `;
  const result = await executeQuery(query, { deploymentId });
  if (result.records.length === 0) return null;
  return result.records[0].get('preview');
}

// ─── V2: ArgoCD / GitOps Queries ────────────────────────────────────────

export async function createOrUpdateRollout(input: {
  serviceName: string;
  infraCommitSha: string;
  imageTag: string;
  status: string;
  timestamp: string;
  errorMessage?: string;
}): Promise<void> {
  // Use a UUID for Rollout, but we need to find it if it already exists for this infraCommitSha & serviceName
  const artifactId = input.serviceName + '_' + input.imageTag;
  
  let failureCategory = null;
  let confidenceScore = null;
  let rootCauseCommit = null;

  if (input.status === 'failed') {
    const classification = classifyArgoCDFailure(input.errorMessage || '');
    failureCategory = classification.category;
    confidenceScore = classification.confidenceScore;
    // If it's a deployment failure, the root cause is the InfraCommit. Otherwise it traces back to the Artifact's AppCommit.
    rootCauseCommit = failureCategory === 'DEPLOYMENT_FAILURE' ? input.infraCommitSha : null;
  }
  
  const query = `
    // 1. Ensure Service exists
    MATCH (s:Service { name: $serviceName })
    
    // 2. Ensure Artifact exists with compound ID
    MERGE (a:Artifact { id: $artifactId })
    ON CREATE SET a.tag = $imageTag, a.service = $serviceName
    
    // 3. Ensure InfraCommit exists
    MERGE (ic:InfraCommit { sha: $infraCommitSha })
    MERGE (a)-[:TRIGGERS_UPDATE]->(ic)
    
    // 4. Find or Create Rollout node using UUID
    MERGE (ic)-[:RESULTS_IN]->(r:Rollout { serviceName: $serviceName, infraCommitSha: $infraCommitSha })
    ON CREATE SET 
      r.id = randomUUID(),
      r.startedAt = $timestamp,
      r.status = $status
    ON MATCH SET
      r.status = $status,
      r.completedAt = CASE WHEN $status IN ['success', 'failed'] THEN $timestamp ELSE r.completedAt END,
      r.durationMs = CASE WHEN $status IN ['success', 'failed'] THEN duration.inMilliseconds(datetime(r.startedAt), datetime($timestamp)).milliseconds ELSE r.durationMs END
    
    // Set classification properties if present
    SET r.failureCategory = CASE WHEN $failureCategory IS NOT NULL THEN $failureCategory ELSE r.failureCategory END,
        r.confidenceScore = CASE WHEN $confidenceScore IS NOT NULL THEN $confidenceScore ELSE r.confidenceScore END,
        r.rootCauseCommit = CASE WHEN $rootCauseCommit IS NOT NULL THEN $rootCauseCommit ELSE r.rootCauseCommit END

    // 5. Link to Service
    MERGE (r)-[:DEPLOYED_TO]->(s)
  `;
  
  await executeQuery(query, {
    serviceName: input.serviceName,
    infraCommitSha: input.infraCommitSha,
    imageTag: input.imageTag,
    status: input.status,
    timestamp: input.timestamp,
    artifactId,
    failureCategory,
    confidenceScore,
    rootCauseCommit
  });
}

export async function createHealthIncident(
  serviceName: string,
  infraCommitSha: string,
  timestamp: string,
  errorMessage?: string
): Promise<void> {
  const incidentId = uuidv4();
  
  let failureCategory = null;
  let confidenceScore = null;
  let rootCauseCommit = null;

  if (errorMessage) {
    const classification = classifyHealthIncident(errorMessage);
    failureCategory = classification.category;
    confidenceScore = classification.confidenceScore;
    // Health incidents currently default to tracing back to the application commit (we leave this null to force the query to jump to AppCommit)
    // If it's INFRASTRUCTURE_FAILURE we wouldn't set a commit at all.
  }
  
  const query = `
    MATCH (r:Rollout { serviceName: $serviceName, infraCommitSha: $infraCommitSha })
    MATCH (s:Service { name: $serviceName })
    CREATE (hi:HealthIncident { 
      id: $incidentId, 
      timestamp: $timestamp,
      failureCategory: $failureCategory,
      confidenceScore: $confidenceScore
    })
    MERGE (r)-[:PRECEDES]->(hi)
    MERGE (s)-[:EXPERIENCED]->(hi)
  `;
  
  await executeQuery(query, { serviceName, infraCommitSha, incidentId, timestamp, failureCategory, confidenceScore });
  
  // After creating a new incident, trigger the blast radius cluster evaluation
  await evaluateBlastRadius();
}

/**
 * Event Correlation Clustering (Max 5m window, 30s quiet period).
 * Groups recent isolated HealthIncidents into a BlastRadiusEvent 
 * and calculates the Lowest Common Ancestor.
 */
export async function evaluateBlastRadius(): Promise<void> {
  const query = `
    // 1. Find recent unclustered HealthIncidents
    MATCH (hi:HealthIncident)
    WHERE NOT (hi)<-[:IMPACTS]-(:BlastRadiusEvent)
      AND duration.inSeconds(datetime(hi.timestamp), datetime()).seconds < 300 // Max 5m window
    WITH collect(hi) AS recentIncidents
    
    // Require at least 2 incidents to form a cluster
    WHERE size(recentIncidents) > 1
    
    // Ensure quiet period: latest incident must be at least 30s old to close the cluster
    WITH recentIncidents, [inc IN recentIncidents | inc.timestamp] AS timestamps
    UNWIND timestamps AS ts
    WITH recentIncidents, max(datetime(ts)) AS latestTs
    WHERE duration.inSeconds(latestTs, datetime()).seconds > 30

    // 2. Create the BlastRadiusEvent cluster
    CREATE (bre:BlastRadiusEvent {
      id: randomUUID(),
      timestamp: datetime().toString(),
      status: 'active'
    })
    WITH bre, recentIncidents
    
    // 3. Link incidents to cluster
    UNWIND recentIncidents AS hi
    MERGE (bre)-[:IMPACTS]->(hi)
    WITH bre, hi
    
    // 4. Find Lowest Common Ancestor (PhysicalInfra)
    MATCH (hi)<-[:EXPERIENCED]-(s:Service)-[:DEPENDS_ON_RESOURCE]->(lr:LogicalResource)-[:HOSTED_ON]->(pi:PhysicalInfra)
    WITH bre, pi, count(DISTINCT s) AS affectedServiceCount, collect(s.name) AS affectedServices
    WHERE affectedServiceCount > 1
    
    // 5. Assign Root Cause
    MERGE (bre)-[:PRIMARY_CAUSE]->(pi)
    SET bre.confidenceScore = 0.95
    RETURN bre.id AS BlastRadiusEvent, pi.id AS RootCause, affectedServices
    ORDER BY affectedServiceCount DESC LIMIT 1
  `;
  
  try {
    await executeQuery(query, {});
  } catch (err) {
    console.error('[BlastRadius] Failed to evaluate blast radius clusters:', err);
  }
}

export async function checkWebhookDelivery(deliveryId: string): Promise<boolean> {
  // Returns true if this is a NEW delivery, false if it's a REPLAY
  const query = `
    OPTIONAL MATCH (existing:WebhookDelivery { id: $deliveryId })
    WITH existing IS NOT NULL AS exists
    MERGE (w:WebhookDelivery { id: $deliveryId })
    ON CREATE SET w.timestamp = datetime()
    RETURN NOT exists AS isNew
  `;
  const result = await executeQuery(query, { deliveryId });
  if (result.records.length === 0) return true;
  return result.records[0].get('isNew');
}
