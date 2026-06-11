'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchDeployment, triggerRedeploy, fetchEnvDrift, fetchRollbackPreview, triggerManualRollback } from '../../../services/api';
import type { DeploymentWithCommit } from '../../../types/deployment';
import StatusBadge from '../../../components/StatusBadge';
import RiskBadge from '../../../components/RiskBadge';

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
  const [envDrift, setEnvDrift] = useState<{ added: string[], removed: string[], modified: string[] } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [rollbackPreview, setRollbackPreview] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetchDeployment(id).then(setDeployment).catch(() => setDeployment(null)),
      fetchEnvDrift(id).then(setEnvDrift).catch(() => setEnvDrift(null))
    ]).finally(() => setLoading(false));
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

  async function handleRollbackClick() {
    setRedeploying(true);
    const preview = await fetchRollbackPreview(id as string);
    setRollbackPreview(preview);
    setRedeploying(false);
    setShowModal(true);
  }

  async function confirmRollback() {
    setRedeploying(true);
    setRedeployMsg(null);
    setShowModal(false);
    try {
      const res = await triggerManualRollback(id as string);
      setRedeployMsg(`✅ ${res.message}`);
    } catch (err: any) {
      setRedeployMsg(`❌ ${err.message}`);
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
            {deployment.riskLabel && (
              <RiskBadge score={deployment.riskScore || 0} label={deployment.riskLabel} />
            )}
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
          <button className="btn btn-secondary" onClick={handleRollbackClick} disabled={redeploying}>
            {redeploying ? 'Triggering...' : 'Rollback Preview'}
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

      {/* RCA Panel (Intelligence Layer) */}
      {deployment.errorPattern && (
        <div className="card" style={{ marginTop: 24, borderColor: 'var(--status-unhealthy-border)', backgroundColor: 'rgba(239, 68, 68, 0.05)' }}>
          <div className="card-header">
            <div className="card-title" style={{ color: 'var(--status-unhealthy)' }}>
              🧠 Root Cause Detected: {deployment.errorPattern.type}
            </div>
          </div>
          <div className="detail-grid">
            <div className="detail-item">
              <div className="detail-key">Confidence</div>
              <div className="detail-value">{Math.round(deployment.errorPattern.confidence * 100)}%</div>
            </div>
            <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
              <div className="detail-key">Log Output</div>
              <div className="detail-value mono" style={{ whiteSpace: 'pre-wrap', color: 'var(--status-unhealthy)' }}>
                {deployment.errorPattern.message}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Environment Drift Panel */}
      {envDrift && (envDrift.added.length > 0 || envDrift.removed.length > 0 || envDrift.modified.length > 0) && (
        <div className="card" style={{ marginTop: 24, borderColor: 'var(--status-degraded-border)' }}>
          <div className="card-header">
            <div className="card-title">🔐 Environment Drift Detected</div>
          </div>
          <div className="detail-grid">
            {envDrift.added.length > 0 && (
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                <div className="detail-key" style={{ color: 'var(--status-healthy)' }}>Added Secrets</div>
                <div className="detail-value mono">
                  {envDrift.added.map(k => <span key={k} style={{ marginRight: 8 }}>+{k}</span>)}
                </div>
              </div>
            )}
            {envDrift.removed.length > 0 && (
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                <div className="detail-key" style={{ color: 'var(--status-unhealthy)' }}>Removed Secrets</div>
                <div className="detail-value mono">
                  {envDrift.removed.map(k => <span key={k} style={{ marginRight: 8 }}>-{k}</span>)}
                </div>
              </div>
            )}
            {envDrift.modified.length > 0 && (
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                <div className="detail-key" style={{ color: 'var(--status-degraded)' }}>Modified Secrets</div>
                <div className="detail-value mono">
                  {envDrift.modified.map(k => <span key={k} style={{ marginRight: 8 }}>~{k}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* Rollback Modal */}
      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '500px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
            <div className="card-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h2 style={{ margin: 0 }}>Confirm Rollback</h2>
            </div>
            <div style={{ padding: '24px 0' }}>
              {!rollbackPreview || !rollbackPreview.targetSha ? (
                <p style={{ color: 'var(--status-degraded)' }}>No previous healthy deployment found to rollback to.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Target Version:</span>
                    <span className="mono">{rollbackPreview.targetSha.substring(0, 7)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Files Reverted:</span>
                    <span>{rollbackPreview.filesChanged?.low !== undefined ? rollbackPreview.filesChanged.low : rollbackPreview.filesChanged} files</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Health Delta:</span>
                    <span style={{ color: 'var(--status-healthy)' }}>Degraded → Healthy</span>
                  </div>
                  {rollbackPreview.blastRadius && rollbackPreview.blastRadius.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>Services affected (Blast Radius):</div>
                      <div className="mono" style={{ padding: '8px', backgroundColor: 'var(--card-bg)', borderRadius: '4px' }}>
                        {rollbackPreview.blastRadius.join(', ')}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              {rollbackPreview && (
                <button className="btn btn-primary" onClick={confirmRollback} style={{ backgroundColor: 'var(--status-unhealthy)' }}>
                  Confirm Rollback
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
