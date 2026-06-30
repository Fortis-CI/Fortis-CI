'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchDeployments, fetchServices } from '../../services/api';
import type { DeploymentWithCommit, ServiceWithHealth } from '../../types/deployment';
import StatusBadge from '../../components/StatusBadge';

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDuration(seconds: any): string {
  if (seconds == null || isNaN(Number(seconds))) return '—';
  const num = Number(seconds);
  if (num < 60) return `${num}s`;
  return `${Math.floor(num / 60)}m ${num % 60}s`;
}

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<DeploymentWithCommit[]>([]);
  const [services, setServices] = useState<ServiceWithHealth[]>([]);
  const [filterServiceId, setFilterServiceId] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [depData, svcData] = await Promise.all([
        fetchDeployments(filterServiceId || undefined, 50),
        fetchServices(),
      ]);
      setDeployments(depData);
      setServices(svcData);
    } catch (err) {
      console.error('Failed to fetch deployments:', err);
    } finally {
      setLoading(false);
    }
  }, [filterServiceId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        Loading deployments...
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Deployments</h1>
        <p>Full deployment history across all tracked services</p>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
        <select
          className="form-select"
          value={filterServiceId}
          onChange={(e) => {
            setFilterServiceId(e.target.value);
            setLoading(true);
          }}
          style={{ width: 260 }}
        >
          <option value="">All Services</option>
          {services.map((svc) => (
            <option key={svc.id} value={svc.id}>{svc.name}</option>
          ))}
        </select>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
          {deployments.length} deployments
        </span>
      </div>

      {/* Deployments Table */}
      {deployments.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">🚀</div>
            <h3>No deployments found</h3>
            <p>
              {filterServiceId
                ? 'No deployments for this service yet.'
                : 'Configure a GitHub webhook to start tracking deployments.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Workflow</th>
                <th>Branch</th>
                <th>Commit</th>
                <th>Triggered By</th>
                <th>Duration</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((dep) => (
                <tr key={dep.id} onClick={() => window.location.href = `/deployments/${dep.id}`}>
                  <td>
                    <StatusBadge status={dep.status} conclusion={dep.conclusion} />
                  </td>
                  <td style={{ fontWeight: 500 }}>{dep.workflowName || 'Deployment'}</td>
                  <td>
                    <span className="mono">{dep.branch}</span>
                  </td>
                  <td>
                    {dep.commit ? (
                      <span className="mono" title={dep.commit.message}>
                        {dep.commit.sha.substring(0, 7)}
                      </span>
                    ) : '—'}
                  </td>
                  <td>{dep.triggeredBy}</td>
                  <td>{formatDuration(dep.duration)}</td>
                  <td style={{ color: 'var(--text-tertiary)' }}>
                    {formatTimeAgo(dep.startedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
