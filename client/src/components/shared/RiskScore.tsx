import { cn } from '@/lib/utils';

interface RiskScoreProps {
  score: number; // 0 - 100
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

function colorFor(score: number): string {
  if (score >= 75) return '#dc2626'; // red-600
  if (score >= 50) return '#f97316'; // orange-500
  if (score >= 25) return '#eab308'; // yellow-500
  return '#16a34a'; // green-600
}

function ratingFor(score: number): string {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Medium';
  return 'Low';
}

export function RiskScore({ score, size = 'md', showLabel = true }: RiskScoreProps) {
  const dims = size === 'lg' ? 160 : size === 'sm' ? 60 : 110;
  const stroke = size === 'lg' ? 14 : size === 'sm' ? 6 : 10;
  const r = (dims - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const offset = c * (1 - pct / 100);
  const color = colorFor(pct);

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: dims, height: dims }}>
        <svg width={dims} height={dims} className="-rotate-90 transform">
          <circle cx={dims / 2} cy={dims / 2} r={r} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
          <circle
            cx={dims / 2}
            cy={dims / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.4s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div
            className={cn(
              'font-bold tabular-nums',
              size === 'lg' ? 'text-4xl' : size === 'sm' ? 'text-base' : 'text-2xl',
            )}
            style={{ color }}
          >
            {pct}
          </div>
          {size !== 'sm' && <div className="text-xs text-muted-foreground">/ 100</div>}
        </div>
      </div>
      {showLabel && size !== 'sm' && (
        <div className="mt-2 text-sm font-semibold" style={{ color }}>
          {ratingFor(pct)}
        </div>
      )}
    </div>
  );
}
