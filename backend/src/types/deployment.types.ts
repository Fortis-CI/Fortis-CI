// ─── Service ────────────────────────────────────────────────────────────────

export interface Service {
  id: string;
  name: string;
  repoUrl: string;
  healthEndpoint: string;
  environment: string; // e.g. "production" | "staging"
  createdAt: string;   // ISO timestamp
}

export interface CreateServiceInput {
  name: string;
  repoUrl: string;
  healthEndpoint: string;
  environment?: string;
}

// ─── Deployment ──────────────────────────────────────────────────────────────

export type DeploymentStatus = 'in_progress' | 'completed';
export type DeploymentConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'skipped'
  | null;

export interface Deployment {
  id: string;
  workflowRunId: number;
  workflowName: string;
  branch: string;
  status: DeploymentStatus;
  conclusion: DeploymentConclusion;
  triggeredBy: string;  // GitHub actor login
  startedAt: string;    // ISO timestamp
  completedAt: string | null;
  duration: number | null; // seconds
  serviceId: string;
  riskScore?: number;
  riskLabel?: string;
}

export interface CreateDeploymentInput {
  workflowRunId: number;
  workflowName: string;
  branch: string;
  status: DeploymentStatus;
  conclusion: DeploymentConclusion;
  triggeredBy: string;
  startedAt: string;
  completedAt?: string | null;
  serviceId: string;
  commitSha: string;
}

// ─── Commit ───────────────────────────────────────────────────────────────────

export interface Commit {
  sha: string;
  message: string;
  author: string;
  authorEmail: string;
  timestamp: string; // ISO timestamp
  repoUrl: string;
}

export interface CreateCommitInput {
  sha: string;
  message: string;
  author: string;
  authorEmail: string;
  timestamp: string;
  repoUrl: string;
}

// ─── HealthCheck ─────────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthCheck {
  id: string;
  serviceId: string;
  status: HealthStatus;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
  checkedAt: string; // ISO timestamp
}

// ─── Query results ───────────────────────────────────────────────────────────

export interface ServiceWithHealth extends Service {
  latestDeployment: Deployment | null;
  latestHealth: HealthCheck | null;
}

export interface ErrorPattern {
  id: string;
  type: string;
  message: string;
  confidence: number;
}

export interface DeploymentWithCommit extends Deployment {
  commit: Commit | null;
  service?: Service | null;
  errorPattern?: ErrorPattern | null;
}
