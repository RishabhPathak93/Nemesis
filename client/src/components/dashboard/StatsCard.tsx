import { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

interface StatsCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: string;
  accent?: string;
}

export function StatsCard({ label, value, icon, hint, accent = 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' }: StatsCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium text-muted-foreground">{label}</div>
          <div className="mt-1 text-3xl font-bold tracking-tight text-foreground tabular-nums">{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {icon && (
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
