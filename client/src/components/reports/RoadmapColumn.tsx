import { RoadmapItem } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Zap, CalendarClock, CalendarRange } from 'lucide-react';

const STYLE: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  immediate: {
    color: 'text-red-700',
    bg: 'bg-red-50 border-red-200',
    label: 'Immediate',
    icon: <Zap className="h-4 w-4" />,
  },
  short_term: {
    color: 'text-orange-700',
    bg: 'bg-orange-50 border-orange-200',
    label: 'Short Term',
    icon: <CalendarClock className="h-4 w-4" />,
  },
  long_term: {
    color: 'text-blue-700',
    bg: 'bg-blue-50 border-blue-200',
    label: 'Long Term',
    icon: <CalendarRange className="h-4 w-4" />,
  },
};

export function RoadmapColumn({ priority, items }: { priority: 'immediate' | 'short_term' | 'long_term'; items: RoadmapItem[] }) {
  const s = STYLE[priority];
  const filtered = items.filter((i) => i.priority === priority);

  return (
    <Card className={`h-full border-2 ${s.bg}`}>
      <CardContent className="space-y-3 pt-6">
        <div className={`flex items-center gap-2 font-semibold ${s.color}`}>
          {s.icon} {s.label}
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No actions in this tier.</p>
        ) : (
          <ul className="space-y-3">
            {filtered.map((item, i) => (
              <li key={i} className="rounded-md bg-white p-3 shadow-sm">
                <div className="text-sm font-semibold text-foreground">{item.action}</div>
                <p className="mt-1 text-xs text-muted-foreground">{item.rationale}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
