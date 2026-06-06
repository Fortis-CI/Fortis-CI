import type { HealthStatus } from '../types/deployment';

interface HealthBadgeProps {
  status: HealthStatus | string | undefined | null;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

const statusConfig: Record<string, { label: string; className: string; dot: string }> = {
  healthy: { label: 'Healthy', className: 'badge-healthy', dot: 'healthy' },
  degraded: { label: 'Degraded', className: 'badge-degraded', dot: 'degraded' },
  unhealthy: { label: 'Unhealthy', className: 'badge-unhealthy', dot: 'unhealthy' },
  unknown: { label: 'Unknown', className: 'badge-unknown', dot: 'unknown' },
};

export default function HealthBadge({ status, showLabel = true }: HealthBadgeProps) {
  const config = statusConfig[status || 'unknown'] || statusConfig.unknown;

  return (
    <span className={`badge ${config.className}`}>
      <span className={`health-dot ${config.dot}`} />
      {showLabel && config.label}
    </span>
  );
}
