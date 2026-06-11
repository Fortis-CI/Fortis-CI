'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchServices, fetchDeployments } from '../services/api';
import type { ServiceWithHealth, DeploymentWithCommit } from '../types/deployment';
import HealthBadge from '../components/HealthBadge';
import StatusBadge from '../components/StatusBadge';

const POLL_INTERVAL = 10_000; // 10 seconds

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function Dashboard() {
  const [services, setServices] = useState<ServiceWithHealth[]>([]);
  const [deployments, setDeployments] = useState<DeploymentWithCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    try {
      const [svcData, depData] = await Promise.all([
        fetchServices(),
        fetchDeployments(undefined, 10),
      ]);
      setServices(svcData);
      setDeployments(depData);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // Compute stats
  const totalServices = services.length;
  const healthyCount = services.filter(
    (s) => (s.cachedHealth?.status || s.latestHealth?.status) === 'healthy'
  ).length;
  const unhealthyCount = services.filter(
    (s) => (s.cachedHealth?.status || s.latestHealth?.status) === 'unhealthy'
  ).length;
  const recentDeployments = deployments.length;
  const failedRecent = deployments.filter((d) => d.conclusion === 'failure').length;

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        Loading dashboard...
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Deployment intelligence overview — auto-refreshes every 10s</p>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--status-unhealthy-border)' }}>
          <p style={{ color: 'var(--status-unhealthy)' }}>⚠️ {error}</p>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', marginTop: 4 }}>
            Is the backend running on port 3001?
          </p>
        </div>
      )}

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card accent-blue">
          <div className="stat-label">Total Services</div>
          <div className="stat-value">{totalServices}</div>
          <div className="stat-subtitle">Registered and tracked</div>
        </div>

        <div className="stat-card accent-green">
          <div className="stat-label">Healthy</div>
          <div className="stat-value">{healthyCount}</div>
          <div className="stat-subtitle">Services passing health checks</div>
        </div>

        <div className="stat-card accent-red">
          <div className="stat-label">Unhealthy</div>
          <div className="stat-value">{unhealthyCount}</div>
          <div className="stat-subtitle">Services needing attention</div>
        </div>

        <div className="stat-card accent-gold">
          <div className="stat-label">Recent Deploys</div>
          <div className="stat-value">{recentDeployments}</div>
          <div className="stat-subtitle">
            {failedRecent > 0
              ? `${failedRecent} failed`
              : 'Last 10 deployments'}
          </div>
        </div>
      </div>

      {/* Two column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Service Health Grid */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Service Health</div>
            <Link href="/services" className="btn btn-secondary btn-sm">
              View All
            </Link>
          </div>

          {services.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">⚙️</div>
              <h3>No services registered</h3>
              <p>Register your first service to start tracking deployments.</p>
              <Link href="/services/new" className="btn btn-primary btn-sm" style={{ marginTop: 16 }}>
                Register Service
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {services.map((svc) => {
                const healthStatus = svc.cachedHealth?.status || svc.latestHealth?.status || 'unknown';
                return (
                  <Link
                    key={svc.id}
                    href={`/services/${svc.id}`}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div className="deployment-row" style={{ padding: '12px 16px' }}>
                      <div className="deployment-info">
                        <div className="deployment-title">{svc.name}</div>
                        <div className="deployment-meta">
                          <span className="mono">{svc.environment}</span>
                          {svc.latestDeployment && (
                            <span>{formatTimeAgo(svc.latestDeployment.startedAt)}</span>
                          )}
                        </div>
                      </div>
                      <HealthBadge status={healthStatus} />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Deployments */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Recent Deployments</div>
            <Link href="/deployments" className="btn btn-secondary btn-sm">
              View All
            </Link>
          </div>

          {deployments.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🚀</div>
              <h3>No deployments yet</h3>
              <p>Configure a GitHub webhook to start tracking deployments.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {deployments.map((dep) => (
                <Link
                  key={dep.id}
                  href={`/deployments/${dep.id}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div className="deployment-row" style={{ padding: '12px 16px' }}>
                    <StatusBadge status={dep.status} conclusion={dep.conclusion} />
                    <div className="deployment-info">
                      <div className="deployment-title">
                        {dep.workflowName || 'Deployment'}
                      </div>
                      <div className="deployment-meta">
                        <span className="mono">{dep.branch}</span>
                        <span>{dep.triggeredBy}</span>
                        <span>{formatTimeAgo(dep.startedAt)}</span>
                        {dep.duration && <span>{formatDuration(dep.duration)}</span>}
                      </div>
                    </div>
                    {dep.commit && (
                      <span className="mono" style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                        {dep.commit.sha.substring(0, 7)}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
