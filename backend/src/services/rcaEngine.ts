import { fetchWorkflowLogs } from './logFetcher';
import { createErrorPattern, getDeploymentById } from './graphService';
import { triggerRollback } from './rollbackEngine';

/**
 * Root Cause Analysis Engine
 * Parses logs using regex heuristics to classify 8 error types.
 */

interface RCA_Pattern {
  id: string;
  name: string;
  regex: RegExp;
  confidence: number;
}

const ERROR_PATTERNS: RCA_Pattern[] = [
  {
    id: 'db_connection',
    name: 'Database Connection Error',
    regex: /ECONNREFUSED|connect ETIMEDOUT|timeout expired|no pg_hba\.conf entry/i,
    confidence: 0.95,
  },
  {
    id: 'api_timeout',
    name: 'API Timeout',
    regex: /timeout of \d+ms exceeded|read timeout|socket hang up/i,
    confidence: 0.85,
  },
  {
    id: 'missing_env',
    name: 'Missing Environment Variable',
    regex: /missing required environment variable|not defined|process\.env\.[A-Za-z0-9_]+ is undefined/i,
    confidence: 0.9,
  },
  {
    id: 'port_conflict',
    name: 'Port Conflict',
    regex: /EADDRINUSE|address already in use/i,
    confidence: 0.98,
  },
  {
    id: 'oom',
    name: 'Out of Memory (OOM)',
    regex: /heap out of memory|Killed|OOMKilled|exit code 137/i,
    confidence: 0.95,
  },
  {
    id: 'auth_failure',
    name: 'Authentication Failure',
    regex: /401 Unauthorized|403 Forbidden|authentication failed|invalid credentials/i,
    confidence: 0.85,
  },
  {
    id: 'dns_failure',
    name: 'DNS Resolution Failure',
    regex: /ENOTFOUND|getaddrinfo ENOTFOUND|Name or service not known/i,
    confidence: 0.95,
  },
  {
    id: 'slow_query',
    name: 'Slow Query Timeout',
    regex: /query wait timeout|statement timeout|Query execution was interrupted/i,
    confidence: 0.8,
  },
];

/**
 * Analyze a deployment's GitHub Actions logs and persist the detected ErrorPattern.
 * Returns the highest confidence error detected.
 */
export async function analyzeDeploymentLogs(
  owner: string,
  repo: string,
  runId: number,
  deploymentId: string
): Promise<string | null> {
  try {
    const logs = await fetchWorkflowLogs(owner, repo, runId);
    
    if (!logs) return null;

    let bestMatch: { pattern: RCA_Pattern; matchedLine: string } | null = null;

    const lines = logs.split('\n');
    for (const line of lines) {
      for (const pattern of ERROR_PATTERNS) {
        if (pattern.regex.test(line)) {
          // Keep the match with the highest confidence
          if (!bestMatch || pattern.confidence > bestMatch.pattern.confidence) {
            bestMatch = { pattern, matchedLine: line.trim() };
          }
        }
      }
    }

    if (bestMatch) {
      console.log(`[RCA] Detected ${bestMatch.pattern.name} for run #${runId}`);
      await createErrorPattern(
        deploymentId,
        bestMatch.pattern.name,
        bestMatch.matchedLine,
        bestMatch.pattern.confidence
      );

      // Tier 2 Rollback Logic: If confidence > 0.90, automatically trigger rollback
      if (bestMatch.pattern.confidence >= 0.90) {
        const deployment = await getDeploymentById(deploymentId);
        if (deployment?.serviceId) {
          console.log(`[RCA] Critical error detected. Triggering Tier 2 Rollback.`);
          triggerRollback(
            deployment.serviceId,
            deploymentId,
            deployment.commit?.sha || 'unknown',
            `Critical Error Detected: ${bestMatch.pattern.name}`
          ).catch(err => console.error('[RCA] Failed to trigger rollback:', err));
        }
      }

      return bestMatch.pattern.id;
    }

    return null;
  } catch (err) {
    console.error(`[RCA] Failed to analyze logs for run #${runId}:`, err);
    return null;
  }
}
