import { useMemo } from 'react';
import type { FullReport, TestResultDetail } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { SeverityBadge } from '@/components/shared/SeverityBadge';
import { RoadmapColumn } from './RoadmapColumn';

const SEVERITY_BAR: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-blue-500',
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

function severityCounts(findings: FullReport['keyFindings']): { critical: number; high: number; medium: number; low: number } {
  const out = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    const k = (f.severity || 'low').toLowerCase() as keyof typeof out;
    if (k in out) out[k] += 1;
  }
  return out;
}

function ratingTone(rating: string): string {
  switch ((rating || '').toLowerCase()) {
    case 'critical': return 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 ring-red-200 dark:ring-red-500/30';
    case 'high':     return 'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-500/10 ring-orange-200 dark:ring-orange-500/30';
    case 'medium':   return 'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 ring-amber-200 dark:ring-amber-500/30';
    case 'low':      return 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10 ring-blue-200 dark:ring-blue-500/30';
    default:         return 'text-foreground bg-muted ring-border';
  }
}

function scoreColor(score: number): string {
  if (score >= 75) return '#dc2626';
  if (score >= 50) return '#f97316';
  if (score >= 25) return '#eab308';
  return '#10b981';
}

interface RiskRingProps {
  score: number;
}
function RiskRing({ score }: RiskRingProps) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(Math.max(score, 0), 100) / 100) * circumference;
  const color = scoreColor(score);
  return (
    <div className="relative h-[180px] w-[180px]">
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="hsl(214 32% 91%)" strokeWidth="14" />
        <circle
          cx="100" cy="100" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-5xl font-extrabold tracking-tight tabular-nums" style={{ color }}>{score}</div>
        <div className="mt-1 text-xs text-muted-foreground">out of 100</div>
      </div>
    </div>
  );
}

interface SeverityDonutInlineProps {
  data: { critical: number; high: number; medium: number; low: number };
}
function SeverityDonutInline({ data }: SeverityDonutInlineProps) {
  const total = data.critical + data.high + data.medium + data.low;
  if (total === 0) {
    return <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">No findings</div>;
  }
  const palette = [
    { key: 'critical', value: data.critical, color: '#dc2626' },
    { key: 'high', value: data.high, color: '#f97316' },
    { key: 'medium', value: data.medium, color: '#eab308' },
    { key: 'low', value: data.low, color: '#3b82f6' },
  ];
  // Render via cumulative stroke-dasharray on a single circle r=15.915 (so circumference ≈ 100)
  let offset = 25; // start at the top
  return (
    <svg viewBox="0 0 42 42" className="h-[160px] w-[160px]">
      <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="hsl(214 32% 91%)" strokeWidth="6" />
      {palette.map((p) => {
        if (p.value === 0) return null;
        const pct = (p.value / total) * 100;
        const el = (
          <circle
            key={p.key}
            cx="21" cy="21" r="15.915"
            fill="transparent"
            stroke={p.color}
            strokeWidth="6"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeDashoffset={offset}
          />
        );
        offset -= pct;
        return el;
      })}
      <text x="21" y="20" textAnchor="middle" fontSize="6" fontWeight="700" fill="hsl(222 47% 11%)">{total}</text>
      <text x="21" y="26" textAnchor="middle" fontSize="2.4" fill="hsl(215 16% 47%)">findings</text>
    </svg>
  );
}

interface ReportOverviewTabProps {
  report: FullReport;
}

export function ReportOverviewTab({ report }: ReportOverviewTabProps) {
  const sev = useMemo(() => severityCounts(report.keyFindings), [report.keyFindings]);
  const totalKeyFindings = sev.critical + sev.high + sev.medium + sev.low;

  const passCount = report.results.filter((r) => r.result === 'pass').length;
  const failCount = report.results.filter((r) => r.result === 'fail').length;
  const partialCount = report.results.filter((r) => r.result === 'partial').length;
  const passRate = report.results.length > 0 ? Math.round((passCount / report.results.length) * 100) : 0;

  // Top critical/high findings (max 5), sorted by severity rank
  const topFindings = useMemo(() => {
    return [...report.keyFindings]
      .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
      .filter((f) => SEVERITY_RANK[f.severity] >= 3)
      .slice(0, 5);
  }, [report.keyFindings]);

  // Index test results by external id for finding → reproducer linkage
  const resultsByExternalId = useMemo(() => {
    const m = new Map<string, TestResultDetail>();
    for (const r of report.results) m.set(r.testCase.externalId.toUpperCase(), r);
    return m;
  }, [report.results]);

  return (
    <div className="space-y-4">
      {/* Top row: risk ring + severity donut + outcomes — all 3 cards share the same
          shell (top-left section label, content area filling the rest, equal height). */}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr_1fr]">
        <Card className="flex h-full flex-col">
          <CardContent className="flex flex-1 flex-col pt-6">
            <SectionLabel>Risk score</SectionLabel>
            <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-3">
              <RiskRing score={report.riskScore} />
              <span className={`inline-block rounded-md px-3 py-1 text-xs font-bold uppercase tracking-wide ring-1 ${ratingTone(report.overallRiskRating)}`}>
                {report.overallRiskRating} risk
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="flex h-full flex-col">
          <CardContent className="flex flex-1 flex-col pt-6">
            <SectionLabel>Findings by severity</SectionLabel>
            <div className="mt-4 flex flex-1 items-center gap-6">
              <SeverityDonutInline data={sev} />
              <div className="flex flex-1 flex-col gap-2">
                <LegendRow label="Critical" value={sev.critical} color="#dc2626" />
                <LegendRow label="High"     value={sev.high}     color="#f97316" />
                <LegendRow label="Medium"   value={sev.medium}   color="#eab308" />
                <LegendRow label="Low"      value={sev.low}      color="#3b82f6" />
                <div className="mt-auto border-t border-border pt-2 text-xs text-muted-foreground">
                  {totalKeyFindings} reported · {report.results.length} tests executed
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex h-full flex-col">
          <CardContent className="flex flex-1 flex-col pt-6">
            <SectionLabel>Test outcomes</SectionLabel>
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border">
              <OutcomeCell value={passCount} label="Passed" tone="text-emerald-600 dark:text-emerald-400" />
              <OutcomeCell value={failCount} label="Failed" tone="text-red-600 dark:text-red-400" />
              <OutcomeCell value={partialCount} label="Partial" tone="text-amber-600 dark:text-amber-400" />
              <OutcomeCell value={report.results.length} label="Total" tone="text-foreground" />
            </div>
            <div className="mt-auto pt-4">
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="text-muted-foreground">Pass rate</span>
                <span className="font-semibold text-foreground tabular-nums">{passRate}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500"
                  style={{ width: `${passRate}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two-col: top findings + category breakdown */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="h-full">
          <CardContent className="pt-6">
            <SectionLabel>Top critical / high findings</SectionLabel>
            {topFindings.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No critical or high-severity findings.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {topFindings.map((f, i) => {
                  const sevKey = (f.severity || 'low').toLowerCase();
                  const repro = (f.related_test_ids ?? [])
                    .map((id) => resultsByExternalId.get(id.toUpperCase()))
                    .filter((r): r is TestResultDetail => !!r);
                  return (
                    <li key={i} className="flex gap-3 py-3">
                      <div className={`w-1 flex-shrink-0 rounded ${SEVERITY_BAR[sevKey] ?? SEVERITY_BAR.low}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="text-sm font-semibold text-foreground">{f.title}</div>
                          <SeverityBadge severity={f.severity} />
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{f.description}</p>
                        {repro.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {repro.slice(0, 4).map((r) => (
                              <span key={r.id} className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {r.testCase.externalId}
                              </span>
                            ))}
                            {repro.length > 4 && (
                              <span className="px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                +{repro.length - 4}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardContent className="pt-6">
            <SectionLabel>Category breakdown</SectionLabel>
            {report.categoryBreakdown.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No category data.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {report.categoryBreakdown.map((c, i) => {
                  const failPct = c.total_tests > 0 ? (c.failures / c.total_tests) * 100 : 0;
                  const passPct = 100 - failPct;
                  return (
                    <li key={i} className="flex items-center gap-3">
                      <div className="w-32 truncate text-xs text-foreground" title={c.category}>{c.category}</div>
                      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="absolute inset-y-0 left-0 bg-red-500" style={{ width: `${failPct}%` }} />
                        <div className="absolute inset-y-0 bg-emerald-500" style={{ left: `${failPct}%`, width: `${passPct}%` }} />
                      </div>
                      <div className="w-20 text-right text-[11px] tabular-nums text-muted-foreground">
                        <span className="font-semibold text-foreground">{c.failures}</span>/{c.total_tests} fail
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Executive summary */}
      <Card>
        <CardContent className="pt-6">
          <SectionLabel>Executive summary</SectionLabel>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground">{report.executiveSummary}</p>
        </CardContent>
      </Card>

      {/* Remediation roadmap */}
      <div>
        <SectionLabel>Remediation roadmap</SectionLabel>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <RoadmapColumn priority="immediate" items={report.remediationRoadmap} />
          <RoadmapColumn priority="short_term" items={report.remediationRoadmap} />
          <RoadmapColumn priority="long_term" items={report.remediationRoadmap} />
        </div>
      </div>

      {/* Technical notes + Conclusion */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="h-full">
          <CardContent className="pt-6">
            <SectionLabel>Technical notes</SectionLabel>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground">{report.technicalNotes}</p>
          </CardContent>
        </Card>
        <Card className="h-full">
          <CardContent className="pt-6">
            <SectionLabel>Conclusion</SectionLabel>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground">{report.conclusion}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{children}</div>
  );
}

function LegendRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: color }} />
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function OutcomeCell({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="bg-card p-3">
      <div className={`text-2xl font-bold tabular-nums tracking-tight ${tone}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
