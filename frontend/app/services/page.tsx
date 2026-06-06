'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchServices } from '../../services/api';
import type { ServiceWithHealth } from '../../types/deployment';
import HealthBadge from '../../components/HealthBadge';

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceWithHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchServices()
      .then(setServices)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner" />
        Loading services...
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>Services</h1>
          <p>{services.length} services registered</p>
        </div>
        <Link href="/services/new" className="btn btn-primary btn-sm">
          ➕ Register Service
        </Link>
      </div>

      {services.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">⚙️</div>
            <h3>No services registered</h3>
            <p>Register your first service to start tracking deployments and health status.</p>
            <Link href="/services/new" className="btn btn-primary" style={{ marginTop: 16 }}>
              Register Service
            </Link>
          </div>
        </div>
      ) : (
        <div className="section-grid">
          {services.map((svc) => {
            const healthStatus = svc.cachedHealth?.status || svc.latestHealth?.status || 'unknown';
            const responseTime = svc.cachedHealth?.responseTimeMs || svc.latestHealth?.responseTimeMs;

            return (
              <div key={svc.id} className="service-card">
                <div className="service-card-header">
                  <span className="service-card-name">{svc.name}</span>
                  <HealthBadge status={healthStatus} />
                </div>
                <div className="service-card-body">
                  <div className="service-card-detail">
                    <span className="detail-label">Repo</span>
                    <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {svc.repoUrl.replace('https://github.com/', '')}
                    </span>
                  </div>
                  <div className="service-card-detail">
                    <span className="detail-label">Env</span>
                    <span>{svc.environment}</span>
                  </div>
                  <div className="service-card-detail">
                    <span className="detail-label">Health</span>
                    <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {svc.healthEndpoint}
                    </span>
                  </div>
                  {responseTime && (
                    <div className="service-card-detail">
                      <span className="detail-label">Latency</span>
                      <span>{responseTime}ms</span>
                    </div>
                  )}
                  {svc.latestDeployment && (
                    <div className="service-card-detail">
                      <span className="detail-label">Deploy</span>
                      <span>
                        {svc.latestDeployment.conclusion || svc.latestDeployment.status}
                        {' · '}{formatTimeAgo(svc.latestDeployment.startedAt)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
