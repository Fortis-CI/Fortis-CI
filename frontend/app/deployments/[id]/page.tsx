'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchDeployment, triggerRedeploy } from '../../../services/api';
import type { DeploymentWithCommit } from '../../../types/deployment';
import StatusBadge from '../../../components/StatusBadge';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function DeploymentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [deployment, setDeployment] = useState<DeploymentWithCommit | null>(null);
  const [loading, setLoading] = useState(true);
  const [redeploying, setRedeploying] = useState(false);
  const [redeployMsg, setRedeployMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchDeployment(id)
      .then(setDeployment)
      .catch(() => setDeployment(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleRedeploy() {
    if (!deployment) return;
    setRedeploying(true);
    setRedeployMsg(null);
    try {
      const result = await triggerRedeploy(deployment.id);
      setRedeployMsg(`✅ ${result.message}`);
    } catch (err) {
      setRedeployMsg(`❌ ${(err as Error).message}`);
    } finally {
      setRedeploying(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        Loading deployment...
      </div>
    );
  }

  if (!deployment) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">❌</div>
          <h3>Deployment not found</h3>
          <button className="btn btn-secondary" onClick={() => router.push('/deployments')}>
            Back to Deployments
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1>{deployment.workflowName || 'Deployment'}</h1>
            <StatusBadge status={deployment.status} conclusion={deployment.conclusion} />
          </div>
          <p>
            <span className="mono">{deployment.branch}</span> · triggered by {deployment.triggeredBy}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => router.push('/deployments')}
          >
            ← Back
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleRedeploy}
            disabled={redeploying}
          >
            {redeploying ? 'Triggering...' : '🔄 Redeploy'}
          </button>
        </div>
      </div>

      {redeployMsg && (
        <div
          className="card"
          style={{
            marginBottom: 20,
            padding: 16,
            borderColor: redeployMsg.startsWith('✅')
              ? 'var(--status-healthy-border)'
              : 'var(--status-unhealthy-border)',
          }}
        >
          <p style={{ fontSize: '0.9rem' }}>{redeployMsg}</p>
        </div>
      )}

      {/* Deployment Details */}
      <div className="detail-grid">
        <div className="detail-item">
          <div className="detail-key">Workflow Run ID</div>
          <div className="detail-value mono">{String(deployment.workflowRunId)}</div>
        </div>
        <div className="detail-item">
          <div className="detail-key">Branch</div>
          <div className="detail-value mono">{deployment.branch}</div>
        </div>
        <div className="detail-item">
          <div className="detail-key">Triggered By</div>
          <div className="detail-value">{deployment.triggeredBy}</div>
        </div>
        <div className="detail-item">
          <div className="detail-key">Started At</div>
          <div className="detail-value">{formatDate(deployment.startedAt)}</div>
        </div>
        <div className="detail-item">
          <div className="detail-key">Completed At</div>
          <div className="detail-value">{formatDate(deployment.completedAt)}</div>
        </div>
        <div className="detail-item">
          <div className="detail-key">Duration</div>
          <div className="detail-value">{formatDuration(deployment.duration)}</div>
        </div>
      </div>

      {/* Commit Info */}
      {deployment.commit && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <div className="card-title">Commit</div>
          </div>
          <div className="detail-grid">
            <div className="detail-item">
              <div className="detail-key">SHA</div>
              <div className="detail-value mono">{deployment.commit.sha}</div>
            </div>
            <div className="detail-item">
              <div className="detail-key">Author</div>
              <div className="detail-value">
                {deployment.commit.author} ({deployment.commit.authorEmail})
              </div>
            </div>
            <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
              <div className="detail-key">Message</div>
              <div className="detail-value">{deployment.commit.message}</div>
            </div>
          </div>
        </div>
      )}

      {/* Service Info */}
      {deployment.service && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <div className="card-title">Service</div>
          </div>
          <div className="detail-grid">
            <div className="detail-item">
              <div className="detail-key">Name</div>
              <div className="detail-value">{deployment.service.name}</div>
            </div>
            <div className="detail-item">
              <div className="detail-key">Environment</div>
              <div className="detail-value">{deployment.service.environment}</div>
            </div>
            <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
              <div className="detail-key">Repository</div>
              <div className="detail-value mono">{deployment.service.repoUrl}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
