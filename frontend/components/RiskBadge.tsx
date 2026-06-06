interface RiskBadgeProps {
  score: number;
  label: string;
}

export default function RiskBadge({ score, label }: RiskBadgeProps) {
  let colorClass = 'bg-gray-100 text-gray-800 border-gray-200';
  
  if (label === 'High') {
    colorClass = 'bg-red-100 text-red-800 border-red-200';
  } else if (label === 'Medium') {
    colorClass = 'bg-yellow-100 text-yellow-800 border-yellow-200';
  } else if (label === 'Low') {
    colorClass = 'bg-green-100 text-green-800 border-green-200';
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}
      title={`Heuristic Risk Score: ${score}`}
    >
      Risk: {label} ({score})
    </span>
  );
}
