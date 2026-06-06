// ─── Constraints (Uniqueness — prevents duplicate nodes) ───────────────────
CREATE CONSTRAINT deployment_id IF NOT EXISTS FOR (d:Deployment) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT deployment_workflow_run_id IF NOT EXISTS FOR (d:Deployment) REQUIRE d.workflowRunId IS UNIQUE;
CREATE CONSTRAINT service_name IF NOT EXISTS FOR (s:Service) REQUIRE s.name IS UNIQUE;
CREATE CONSTRAINT commit_sha IF NOT EXISTS FOR (c:Commit) REQUIRE c.sha IS UNIQUE;
CREATE CONSTRAINT healthcheck_id IF NOT EXISTS FOR (h:HealthCheck) REQUIRE h.id IS UNIQUE;
CREATE CONSTRAINT errorpattern_id IF NOT EXISTS FOR (e:ErrorPattern) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT file_id IF NOT EXISTS FOR (f:File) REQUIRE f.id IS UNIQUE;

// EnvSnapshot
CREATE CONSTRAINT env_snapshot_id IF NOT EXISTS FOR (e:EnvSnapshot) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT rollbackevent_id IF NOT EXISTS FOR (r:RollbackEvent) REQUIRE r.id IS UNIQUE;

// ─── Indexes (Fast lookup for dashboard queries) ───────────────────────────
CREATE INDEX deployment_status IF NOT EXISTS FOR (d:Deployment) ON (d.status);
CREATE INDEX deployment_completed_at IF NOT EXISTS FOR (d:Deployment) ON (d.completedAt);
CREATE INDEX deployment_service_id IF NOT EXISTS FOR (d:Deployment) ON (d.serviceId);
CREATE INDEX service_env IF NOT EXISTS FOR (s:Service) ON (s.environment);
CREATE INDEX service_repo_url IF NOT EXISTS FOR (s:Service) ON (s.repoUrl);
CREATE INDEX healthcheck_checked_at IF NOT EXISTS FOR (h:HealthCheck) ON (h.checkedAt);
CREATE INDEX healthcheck_service_id IF NOT EXISTS FOR (h:HealthCheck) ON (h.serviceId);
CREATE INDEX errorpattern_type IF NOT EXISTS FOR (e:ErrorPattern) ON (e.type);
CREATE INDEX rollbackevent_timestamp IF NOT EXISTS FOR (r:RollbackEvent) ON (r.timestamp);
