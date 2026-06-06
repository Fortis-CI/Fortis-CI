/**
 * webhook.controller.ts — GitHub Webhook Event Handler
 *
 * Processes workflow_run events from GitHub Actions.
 * Creates Deployment + Commit nodes in Neo4j and links them
 * to the matching Service via the repository URL.
 *
 * Idempotency is guaranteed by MERGE on workflowRunId.
 */

import { Request, Response } from 'express';
import {
  createDeployment,
  createCommit,
  findServiceByRepoUrl,
  linkSucceededBy,
} from '../services/graphService';
import { analyzeGitDiff } from '../services/gitAnalyzer';
import { analyzeDeploymentLogs } from '../services/rcaEngine';
import { analyzeEnvDrift } from '../services/envDrift.service';
import { analyzePullRequest } from '../services/governance';
import { GitHubWorkflowRunPayload } from '../types/webhook.types';
import { DeploymentStatus, DeploymentConclusion } from '../types/deployment.types';

/**
 * Map GitHub workflow_run status to our internal DeploymentStatus.
 */
function mapStatus(ghStatus: string): DeploymentStatus {
  if (ghStatus === 'completed') return 'completed';
  return 'in_progress';
}

/**
 * Map GitHub conclusion to our internal DeploymentConclusion.
 */
function mapConclusion(ghConclusion: string | null): DeploymentConclusion {
  if (!ghConclusion) return null;
  const valid = ['success', 'failure', 'cancelled', 'timed_out', 'skipped'];
  return valid.includes(ghConclusion) ? (ghConclusion as DeploymentConclusion) : null;
}

/**
 * Handle POST /webhooks/github
 *
 * Flow:
 *  1. Parse the workflow_run payload (HMAC already verified in route middleware)
 *  2. Match repository to a registered Service
 *  3. Create/update Deployment node (idempotent via workflowRunId)
 *  4. Create Commit node + BASED_ON relationship
 *  5. Link SUCCEEDED_BY to previous deployment on same service
 */
export async function handleGitHubWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload: any = JSON.parse(req.body.toString());
    const { action, workflow_run, pull_request, repository } = payload;

    // ─── V3: PR Governance Hooks ───
    if (pull_request && (action === 'opened' || action === 'synchronize')) {
      const repoFullName = repository?.full_name;
      if (repoFullName) {
        const [owner, repo] = repoFullName.split('/');
        analyzePullRequest(owner, repo, pull_request.number).catch(err => 
          console.error('[Webhook] PR Governance error:', err)
        );
      }
      res.status(200).json({ message: 'PR Governance check triggered' });
      return;
    }

    // We only care about workflow_run events otherwise
    if (!workflow_run) {
      res.status(200).json({ message: 'Event skipped' });
      return;
    }

    const repoFullName = workflow_run.repository?.full_name || payload.repository?.full_name;
    const repoUrl = `https://github.com/${repoFullName}`;

    console.log(
      `[Webhook] Received workflow_run.${action} for ${repoFullName} ` +
      `(run_id: ${workflow_run.id}, status: ${workflow_run.status}, ` +
      `conclusion: ${workflow_run.conclusion})`
    );

    // Step 1: Find matching service by repo URL
    const service = await findServiceByRepoUrl(repoUrl);
    if (!service) {
      console.log(`[Webhook] No service registered for ${repoUrl} — skipping`);
      res.status(200).json({
        message: 'Repository not tracked — skipped',
        repo: repoFullName,
      });
      return;
    }

    // Step 2: Create/update Deployment node (MERGE on workflowRunId = idempotent)
    const deployment = await createDeployment({
      workflowRunId: workflow_run.id,
      workflowName: workflow_run.name,
      branch: workflow_run.head_branch,
      status: mapStatus(workflow_run.status),
      conclusion: mapConclusion(workflow_run.conclusion),
      triggeredBy: workflow_run.actor?.login || 'unknown',
      startedAt: workflow_run.created_at,
      completedAt: workflow_run.updated_at || null,
      serviceId: service.id,
      commitSha: workflow_run.head_sha,
    });

    console.log(
      `[Webhook] Deployment ${deployment.id} created/updated ` +
      `(status: ${deployment.status}, conclusion: ${deployment.conclusion})`
    );

    // Step 3: Create Commit node + BASED_ON relationship
    if (workflow_run.head_commit) {
      await createCommit(
        {
          sha: workflow_run.head_commit.id || workflow_run.head_sha,
          message: workflow_run.head_commit.message,
          author: workflow_run.head_commit.author?.name || 'unknown',
          authorEmail: workflow_run.head_commit.author?.email || '',
          timestamp: workflow_run.head_commit.timestamp,
          repoUrl,
        },
        workflow_run.id
      );
      console.log(`[Webhook] Commit ${workflow_run.head_sha.substring(0, 7)} linked`);
    }

    // Step 4: Link SUCCEEDED_BY to previous deployment on the same service
    await linkSucceededBy(service.id, deployment.id);

    // Step 5: V2 Intelligence Layer (Async Triggers)
    const [owner, repo] = repoFullName.split('/');

    if (action === 'requested' || action === 'in_progress') {
      // Async fire-and-forget
      analyzeGitDiff(owner, repo, workflow_run.head_sha, deployment.id).catch(err => 
        console.error('[Webhook] Failed to analyze git diff:', err)
      );
      analyzeEnvDrift(deployment.id, owner, repo).catch(err =>
        console.error('[Webhook] Failed to analyze env drift:', err)
      );
    }

    if (action === 'completed' && workflow_run.conclusion === 'failure') {
      // Async fire-and-forget
      analyzeDeploymentLogs(owner, repo, workflow_run.id, deployment.id).catch(err =>
        console.error('[Webhook] Failed to analyze logs:', err)
      );
    }

    res.status(200).json({
      message: 'Webhook processed successfully',
      action,
      deploymentId: deployment.id,
      serviceId: service.id,
      repo: repoFullName,
    });
  } catch (error) {
    console.error('[Webhook] Processing error:', error);
    // Return 200 even on error to prevent GitHub from retrying indefinitely
    // Log the error for debugging
    res.status(200).json({
      message: 'Webhook received but processing failed — logged for review',
      error: (error as Error).message,
    });
  }
}
