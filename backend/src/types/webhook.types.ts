// GitHub webhook payload types for workflow_run events
// Docs: https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_run

export type WorkflowRunAction = 'requested' | 'in_progress' | 'completed';

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
}

export interface GitHubActor {
  login: string;
  id: number;
  avatar_url: string;
}

export interface GitHubCommit {
  id: string;   // commit SHA
  message: string;
  timestamp: string; // ISO timestamp
  author: {
    name: string;
    email: string;
  };
}

export interface GitHubWorkflowRun {
  id: number;                  // workflow_run_id — UNIQUE constraint in Neo4j
  name: string;                // workflow name
  head_branch: string;         // branch that triggered the run
  head_sha: string;            // commit SHA
  status: 'queued' | 'in_progress' | 'completed';
  conclusion:
    | 'success'
    | 'failure'
    | 'cancelled'
    | 'timed_out'
    | 'skipped'
    | null;
  html_url: string;
  created_at: string;          // ISO timestamp
  updated_at: string;          // ISO timestamp
  actor: GitHubActor;          // who triggered the run
  repository: GitHubRepository;
  head_commit: GitHubCommit;
}

export interface GitHubWorkflowRunPayload {
  action: WorkflowRunAction;
  workflow_run: GitHubWorkflowRun;
  repository: GitHubRepository;
  sender: GitHubActor;
}
