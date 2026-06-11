'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchServices } from '../../../services/api';
import HealthBadge from '../../../components/HealthBadge';

export default function ServiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [service, setService] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchServices().then(data => {
      const found = data.find((s: any) => s.id === id);
      setService(found || null);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="loading-page">Loading...</div>;

  if (!service) {
    return (
      <div className="card">
        <div className="empty-state">
          <h3>Service not found</h3>
          <button className="btn btn-secondary" onClick={() => router.push('/services')}>Back</button>
        </div>
      </div>
    );
  }

  const healthStatus = service.cachedHealth?.status || service.latestHealth?.status || 'unknown';

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1>{service.name}</h1>
          <p className="mono">{service.repoUrl}</p>
        </div>
        <button className="btn btn-secondary" onClick={() => router.push('/services')}>← Back</button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header"><div className="card-title">Current Health</div></div>
        <div style={{ padding: '16px 0', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <HealthBadge status={healthStatus} />
          {healthStatus === 'unhealthy' && (
            <div style={{ color: 'var(--status-unhealthy)', backgroundColor: 'rgba(239,68,68,0.1)', padding: '12px', borderRadius: '6px', flex: 1 }}>
              <strong>Error:</strong> {service.cachedHealth?.error || service.latestHealth?.error || 'Dependency Failure'}
            </div>
          )}
        </div>
      </div>
      
      <div className="card">
        <div className="card-header"><div className="card-title">Root Cause Analysis</div></div>
        <p style={{ marginTop: '12px' }}>
          To view dependency-based root cause analysis, please navigate to the <strong>Interactive Graph</strong> in the sidebar, or view the <strong>Rollback Preview</strong> on the latest Deployment to see the Blast Radius calculation.
        </p>
        <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={() => router.push('/graph')}>
          View Interactive Graph
        </button>
      </div>
    </div>
  );
}
