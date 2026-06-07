import { config } from '../config/env';
import { createEnvSnapshot, getPreviousEnvSnapshot } from './graphService';
import { executeQuery } from '../db/index';

export interface SecretMeta {
  name: string;
  updated_at: string;
}

export interface DriftResult {
  added: string[];
  removed: string[];
  modified: string[];
}

/**
 * Fetches the metadata (names and timestamps) of all GitHub Actions secrets for a repository.
 */
export async function fetchRepositorySecrets(owner: string, repo: string): Promise<SecretMeta[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/secrets`;
  
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      console.error(`[EnvDrift] Failed to fetch secrets metadata for ${owner}/${repo}: ${response.statusText}`);
      return [];
    }

    const data = (await response.json()) as any;
    return data.secrets.map((s: any) => ({
      name: s.name,
      updated_at: s.updated_at
    }));
  } catch (error) {
    console.error(`[EnvDrift] Error fetching secrets:`, error);
    return [];
  }
}

/**
 * Analyzes the drift between the current secrets snapshot and the previous deployment's snapshot.
 */
export async function analyzeEnvDrift(deploymentId: string, owner: string, repo: string): Promise<DriftResult | null> {
  const currentSecrets = await fetchRepositorySecrets(owner, repo);
  
  // Save current snapshot to the graph
  await createEnvSnapshot(deploymentId, currentSecrets);

  // Fetch previous snapshot
  const prevSnapshot = await getPreviousEnvSnapshot(deploymentId);
  if (!prevSnapshot) {
    return null; // No previous snapshot to compare against
  }

  const prevMap = new Map(prevSnapshot.secrets.map(s => [s.name, s.updated_at]));
  const currMap = new Map(currentSecrets.map(s => [s.name, s.updated_at]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  // Check for additions and modifications
  for (const [name, updatedAt] of currMap.entries()) {
    if (!prevMap.has(name)) {
      added.push(name);
    } else if (prevMap.get(name) !== updatedAt) {
      modified.push(name);
    }
  }

  // Check for removals
  for (const name of prevMap.keys()) {
    if (!currMap.has(name)) {
      removed.push(name);
    }
  }

  const hasDrift = added.length > 0 || removed.length > 0 || modified.length > 0;
  if (hasDrift) {
    console.log(`[EnvDrift] Drift detected for deployment ${deploymentId}: +${added.length} -${removed.length} ~${modified.length}`);
  }

  return { added, removed, modified };
}

/**
 * Computes the environment drift for a deployment purely from saved Neo4j graph nodes.
 * Used by the frontend dashboard.
 */
export async function getEnvDriftForDeployment(deploymentId: string): Promise<DriftResult | null> {
  const query = `
    MATCH (curr:Deployment { id: $deploymentId })-[:HAS_ENV]->(currEnv:EnvSnapshot)
    OPTIONAL MATCH (prev:Deployment)-[:SUCCEEDED_BY]->(curr)
    OPTIONAL MATCH (prev)-[:HAS_ENV]->(prevEnv:EnvSnapshot)
    RETURN currEnv, prevEnv
  `;
  const result = await executeQuery(query, { deploymentId });
  if (result.records.length === 0) return null;
  
  const currEnvStr = result.records[0].get('currEnv')?.properties?.secrets;
  const prevEnvStr = result.records[0].get('prevEnv')?.properties?.secrets;

  if (!currEnvStr) return null;

  const currentSecrets = JSON.parse(currEnvStr);
  const prevSecrets = prevEnvStr ? JSON.parse(prevEnvStr) : [];

  const prevMap = new Map<string, string>(prevSecrets.map((s: any) => [s.name, s.updated_at]));
  const currMap = new Map<string, string>(currentSecrets.map((s: any) => [s.name, s.updated_at]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [name, updatedAt] of currMap.entries()) {
    if (!prevMap.has(name)) added.push(name);
    else if (prevMap.get(name) !== updatedAt) modified.push(name);
  }

  for (const name of prevMap.keys()) {
    if (!currMap.has(name)) removed.push(name);
  }

  return { added, removed, modified };
}
