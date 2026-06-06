import type { DeploymentConclusion, DeploymentStatus } from '../types/deployment';

interface StatusBadgeProps {
  status: DeploymentStatus;
  conclusion: DeploymentConclusion;
}

function getDisplayInfo(status: DeploymentStatus, conclusion: DeploymentConclusion) {
  if (status === 'in_progress') {
    return { label: 'In Progress', className: 'badge-in-progress' };
  }

  switch (conclusion) {
    case 'success':
      return { label: 'Success', className: 'badge-success' };
    case 'failure':
      return { label: 'Failed', className: 'badge-failure' };
    case 'cancelled':
      return { label: 'Cancelled', className: 'badge-cancelled' };
    case 'timed_out':
      return { label: 'Timed Out', className: 'badge-failure' };
    case 'skipped':
      return { label: 'Skipped', className: 'badge-cancelled' };
    default:
      return { label: 'Unknown', className: 'badge-cancelled' };
  }
}

export default function StatusBadge({ status, conclusion }: StatusBadgeProps) {
  const info = getDisplayInfo(status, conclusion);

  return (
    <span className={`badge ${info.className}`}>
      {info.label}
    </span>
  );
}
