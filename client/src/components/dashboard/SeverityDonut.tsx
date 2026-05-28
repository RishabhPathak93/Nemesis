import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface SeverityDonutProps {
  data: { critical: number; high: number; medium: number; low: number };
}

const COLORS = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
};

export function SeverityDonut({ data }: SeverityDonutProps) {
  const chartData = [
    { name: 'Critical', value: data.critical, key: 'critical' as const },
    { name: 'High', value: data.high, key: 'high' as const },
    { name: 'Medium', value: data.medium, key: 'medium' as const },
    { name: 'Low', value: data.low, key: 'low' as const },
  ];
  const total = chartData.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        No findings yet
      </div>
    );
  }

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={chartData}
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry) => (
              <Cell key={entry.key} fill={COLORS[entry.key]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
