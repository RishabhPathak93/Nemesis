import { cn } from '@/lib/utils';

type Severity = 'critical' | 'high' | 'medium' | 'low' | string;

const STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  high: 'bg-orange-100 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30',
  medium: 'bg-yellow-100 text-yellow-800 ring-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:ring-yellow-500/30',
  low: 'bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
};

const FALLBACK = 'bg-muted text-foreground ring-border dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30';

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
    pass: 'bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
    fail: 'bg-red-100 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
    partial: 'bg-yellow-100 text-yellow-800 ring-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:ring-yellow-500/30',
    error: 'bg-muted text-foreground ring-border dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30',
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
