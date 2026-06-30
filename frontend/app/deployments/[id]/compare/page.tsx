'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchDeploymentComparison } from '../../../../services/api';

export default function DeploymentComparePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [comparison, setComparison] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDeploymentComparison(id, 'previous')
      .then(setComparison)
      .catch(() => setComparison(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        Loading comparison...
      </div>
    );
  }

  if (!comparison || !comparison.curr || !comparison.prev) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">❌</div>
          <h3>Comparison not available</h3>
          <p>Could not find the previous deployment or data is missing.</p>
          <button className="btn btn-secondary" onClick={() => router.push(`/deployments/${id}`)}>
            Back to Deployment
          </button>
        </div>
      </div>
    );
  }

  const { curr, prev, currFiles, prevFiles, currEnv, prevEnv, currErrors } = comparison;

  // Compute env drift manually since API might not have returned the delta
  const currSecrets = currEnv?.secrets ? JSON.parse(currEnv.secrets) : [];
  const prevSecrets = prevEnv?.secrets ? JSON.parse(prevEnv.secrets) : [];
  
  const currMap = new Map<string, string>(currSecrets.map((s: any) => [s.name, s.updated_at]));
  const prevMap = new Map<string, string>(prevSecrets.map((s: any) => [s.name, s.updated_at]));

  const envAdded: string[] = [];
  const envRemoved: string[] = [];
  const envModified: string[] = [];

  for (const [name, updated_at] of Array.from(currMap.entries())) {
    if (!prevMap.has(name)) envAdded.push(name);
    else if (prevMap.get(name) !== updated_at) envModified.push(name);
  }
  for (const name of Array.from(prevMap.keys())) {
    if (!currMap.has(name)) envRemoved.push(name);
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>Deployment Comparison</h1>
          <p>Comparing <span className="mono">{curr.workflowRunId}</span> (Current) vs <span className="mono">{prev.workflowRunId}</span> (Previous)</p>
        </div>
        <button className="btn btn-secondary" onClick={() => router.push(`/deployments/${id}`)}>
          ← Back to Deployment
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        {/* Previous Deployment Summary */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Previous Deployment</div>
          </div>
          <div className="detail-grid">
             <div className="detail-item">
              <div className="detail-key">Status</div>
              <div className="detail-value">{prev.status} {prev.conclusion ? `(${prev.conclusion})` : ''}</div>
            </div>
            <div className="detail-item">
              <div className="detail-key">Duration</div>
              <div className="detail-value">{prev.duration ? `${prev.duration}s` : '—'}</div>
            </div>
            <div className="detail-item">
              <div className="detail-key">Files Changed</div>
              <div className="detail-value mono" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {prevFiles?.length > 0 ? prevFiles.map((f: any) => (
                  <div key={f.path} style={{ fontSize: '0.85rem', marginBottom: 4 }}>
                    <span style={{ 
                      color: f.status === 'added' ? 'var(--status-healthy)' : f.status === 'removed' ? 'var(--status-unhealthy)' : 'var(--status-degraded)',
                      display: 'inline-block',
                      width: '20px'
                    }}>
                      {f.status === 'added' ? '+' : f.status === 'removed' ? '-' : '~'}
                    </span>
                    {f.path}
                  </div>
                )) : 'None'}
              </div>
            </div>
          </div>
        </div>

        {/* Current Deployment Summary */}
        <div className="card" style={{ borderColor: curr.conclusion === 'failure' ? 'var(--status-unhealthy-border)' : 'var(--border-color)' }}>
          <div className="card-header">
            <div className="card-title">Current Deployment</div>
          </div>
          <div className="detail-grid">
             <div className="detail-item">
              <div className="detail-key">Status</div>
              <div className="detail-value" style={{ color: curr.conclusion === 'failure' ? 'var(--status-unhealthy)' : 'inherit' }}>
                {curr.status} {curr.conclusion ? `(${curr.conclusion})` : ''}
              </div>
            </div>
            <div className="detail-item">
              <div className="detail-key">Duration</div>
              <div className="detail-value">{curr.duration ? `${curr.duration}s` : '—'}</div>
            </div>
            <div className="detail-item">
              <div className="detail-key">Files Changed</div>
              <div className="detail-value mono" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {currFiles?.length > 0 ? currFiles.map((f: any) => (
                  <div key={f.path} style={{ fontSize: '0.85rem', marginBottom: 4 }}>
                    <span style={{ 
                      color: f.status === 'added' ? 'var(--status-healthy)' : f.status === 'removed' ? 'var(--status-unhealthy)' : 'var(--status-degraded)',
                      display: 'inline-block',
                      width: '20px'
                    }}>
                      {f.status === 'added' ? '+' : f.status === 'removed' ? '-' : '~'}
                    </span>
                    {f.path}
                  </div>
                )) : 'None'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Environment Drift Comparison */}
      {(envAdded.length > 0 || envRemoved.length > 0 || envModified.length > 0) && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">
            <div className="card-title">Environment Drift</div>
          </div>
          <div className="detail-grid">
            {envAdded.length > 0 && (
              <div className="detail-item">
                <div className="detail-key" style={{ color: 'var(--status-healthy)' }}>Added Secrets</div>
                <div className="detail-value mono">{envAdded.join(', ')}</div>
              </div>
            )}
            {envRemoved.length > 0 && (
              <div className="detail-item">
                <div className="detail-key" style={{ color: 'var(--status-unhealthy)' }}>Removed Secrets</div>
                <div className="detail-value mono">{envRemoved.join(', ')}</div>
              </div>
            )}
            {envModified.length > 0 && (
              <div className="detail-item">
                <div className="detail-key" style={{ color: 'var(--status-degraded)' }}>Modified Secrets</div>
                <div className="detail-value mono">{envModified.join(', ')}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Errors (New in Current) */}
      {currErrors && currErrors.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--status-unhealthy-border)', backgroundColor: 'rgba(239, 68, 68, 0.05)' }}>
          <div className="card-header">
            <div className="card-title" style={{ color: 'var(--status-unhealthy)' }}>Errors Introduced in Current Deployment</div>
          </div>
          <div style={{ padding: '16px' }}>
            {currErrors.map((err: any, idx: number) => (
              <div key={idx} style={{ marginBottom: idx < currErrors.length - 1 ? 16 : 0, paddingBottom: idx < currErrors.length - 1 ? 16 : 0, borderBottom: idx < currErrors.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                <div style={{ fontWeight: 600, color: 'var(--status-unhealthy)', marginBottom: 8 }}>{err.type} (Confidence: {Math.round(err.confidence * 100)}%)</div>
                <div className="mono" style={{ fontSize: '0.85rem' }}>{err.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
