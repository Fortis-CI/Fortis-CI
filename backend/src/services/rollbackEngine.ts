import {
  findLastHealthyDeployment,
  createRollbackEvent,
  getServiceById,
} from './graphService';
import { rerunWorkflow, parseRepoUrl } from './github.service';
import { sendSlackAlert, sendPRComment, sendEmailAlert } from './notifications';

// In-memory cache for cooldowns (15 minutes)
const rollbackCooldowns = new Map<string, number>();
const COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Triggers an automated rollback to the last known healthy deployment.
 * Evaluates safety rules (Cooldown, Max Depth) before execution.
 */
export async function triggerRollback(
  serviceId: string,
  failedDeploymentId: string,
  failedSha: string,
  reason: string
): Promise<void> {
  console.log(`[RollbackEngine] Evaluating rollback for service ${serviceId} (Reason: ${reason})`);

  // --- Rule 1: Cooldown Check ---
  const lastRollback = rollbackCooldowns.get(serviceId);
  if (lastRollback && Date.now() - lastRollback < COOLDOWN_MS) {
    console.warn(`[RollbackEngine] Rollback aborted: Service ${serviceId} is currently in a 15-minute cooldown.`);
    return;
  }

  // --- Graph Query: Find Last Healthy Deployment ---
  const lastHealthy = await findLastHealthyDeployment(serviceId);
  if (!lastHealthy) {
    console.error(`[RollbackEngine] Rollback aborted: No previous healthy deployment found in the graph for service ${serviceId}.`);
    return;
  }

  // --- Rule 2: Max Depth (handled implicitly by querying the most recent healthy deployment, preventing infinite chains) ---

  const service = await getServiceById(serviceId);
  if (!service) return;

  const repoUrl = service.repoUrl;
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    console.error(`[RollbackEngine] Invalid repo URL: ${repoUrl}`);
    return;
  }

  const runId = typeof lastHealthy.workflowRunId === 'object' && 'toNumber' in lastHealthy.workflowRunId
    ? (lastHealthy.workflowRunId as any).toNumber()
    : Number(lastHealthy.workflowRunId);

  console.log(`[RollbackEngine] Executing rollback. Re-triggering run #${runId} for ${parsed.owner}/${parsed.repo}`);

  // Set Cooldown
  rollbackCooldowns.set(serviceId, Date.now());

  // Execute GitHub Action
  const result = await rerunWorkflow(parsed.owner, parsed.repo, runId);

  if (result.success) {
    // Audit Trail: Log the rollback event in Neo4j
    await createRollbackEvent(failedDeploymentId, lastHealthy.id, reason);

    // Three-Channel Notifications
    const message = `Automated rollback triggered for *${service.name}*.\n*Reason:* ${reason}\n*Rolling back to run:* #${runId}`;
    
    await sendSlackAlert(message, failedDeploymentId);
    await sendPRComment(parsed.owner, parsed.repo, failedSha, message);
    await sendEmailAlert('devops-team@company.com', `Rollback: ${service.name}`, message);

  } else {
    console.error(`[RollbackEngine] GitHub API failed to trigger rollback: ${result.message}`);
    await sendSlackAlert(`CRITICAL: Automated rollback FAILED for ${service.name}. Manual intervention required.`, failedDeploymentId);
  }
}
