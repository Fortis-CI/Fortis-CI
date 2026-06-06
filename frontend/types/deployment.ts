// ─── Service ────────────────────────────────────────────────────────────────

export interface Service {
  id: string;
  name: string;
  repoUrl: string;
  healthEndpoint: string;
  environment: string;
  createdAt: string;
}

export interface ServiceWithHealth extends Service {
  latestDeployment: Deployment | null;
  latestHealth: HealthCheck | null;
  cachedHealth?: CachedHealth | null;
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
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  serviceId: string;
}

export interface DeploymentWithCommit extends Deployment {
  commit: Commit | null;
  service?: Service | null;
}

// ─── Commit ───────────────────────────────────────────────────────────────────

export interface Commit {
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
  checkedAt: string;
}

export interface CachedHealth {
  serviceId: string;
  serviceName: string;
  status: string;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
  checkedAt: string;
}

// ─── API Responses ───────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  count?: number;
  source?: string;
  message?: string;
}
