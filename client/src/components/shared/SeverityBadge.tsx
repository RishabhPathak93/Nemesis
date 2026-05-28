import { cn } from '@/lib/utils';

type Severity = 'critical' | 'high' | 'medium' | 'low' | string;

const STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 ring-red-200',
  high: 'bg-orange-100 text-orange-700 ring-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 ring-yellow-200',
  low: 'bg-blue-100 text-blue-700 ring-blue-200',
};

const FALLBACK = 'bg-slate-100 text-slate-700 ring-slate-200';

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const key = (severity || 'low').toLowerCase();
  const cls = STYLES[key] || FALLBACK;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset',
        cls,
        className,
      )}
    >
      {key}
    </span>
  );
}

export function ResultBadge({ result }: { result: string }) {
  const r = result.toLowerCase();
  const map: Record<string, string> = {
    pass: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    fail: 'bg-red-100 text-red-700 ring-red-200',
    partial: 'bg-yellow-100 text-yellow-800 ring-yellow-200',
    error: 'bg-slate-200 text-slate-700 ring-slate-300',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset',
        map[r] || FALLBACK,
      )}
    >
      {r}
    </span>
  );
}
