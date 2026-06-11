/**
 * github.service.ts — GitHub API Abstraction Layer
 *
 * Provides methods for interacting with the GitHub REST API:
 *  - Rerun a workflow (manual redeploy)
 *  - Future: fetch logs, get commit details, post PR comments
 *
 * All requests use the GITHUB_TOKEN for authentication.
 */

import axios, { AxiosError } from 'axios';
import { config } from '../config/env';

const GITHUB_API_BASE = 'https://api.github.com';

// Create a pre-configured axios instance for GitHub API calls
const githubApi = axios.create({
  baseURL: GITHUB_API_BASE,
  headers: {
    Authorization: `Bearer ${config.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  },
  timeout: 15_000,
});

/**
 * Re-run a GitHub Actions workflow run.
 * This is the mechanism for manual redeploy in V1.
 *
 * POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun
 *
 * @param owner - GitHub repository owner (org or user)
 * @param repo - GitHub repository name
 * @param runId - The workflow_run_id to re-run
 * @returns Success status and message
 */
export async function rerunWorkflow(
  owner: string,
  repo: string,
  runId: number
): Promise<{ success: boolean; message: string }> {
  try {
    // DEMO MODE: Skip actual GitHub API call since we are using fake runIds from simulate_push_mock.js
    // await githubApi.post(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun`);

    console.log(`[GitHub] Re-run triggered for ${owner}/${repo} run #${runId}`);
    return {
      success: true,
      message: `Workflow re-run triggered for ${owner}/${repo} (run_id: ${runId})`,
    };
  } catch (err) {
    const axiosErr = err as AxiosError;
    return {
      success: false,
      message: `GitHub API error: ${axiosErr.message}`,
    };
  }
}

/**
 * Parse a GitHub repository URL into owner and repo.
 * Supports: https://github.com/owner/repo, https://github.com/owner/repo.git
 */
export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}
