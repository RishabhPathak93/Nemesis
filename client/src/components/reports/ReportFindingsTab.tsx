import { useMemo, useState } from 'react';
import { X, Search } from 'lucide-react';
import type { FullReport, TestResultDetail } from '@/types';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const SEVERITY_BAR: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-blue-500',
};

const SEVERITY_TEXT: Record<string, string> = {
  critical: 'text-red-700',
  high: 'text-orange-700',
  medium: 'text-amber-800',
  low: 'text-blue-700',
};

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

interface StatusInfo { label: string; tone: string }
function resultToStatus(result: string): StatusInfo {
  switch (result.toLowerCase()) {
    case 'fail':    return { label: 'Open',     tone: 'bg-red-50 text-red-700 ring-red-200' };
    case 'partial': return { label: 'Open',     tone: 'bg-orange-50 text-orange-700 ring-orange-200' };
    case 'pass':    return { label: 'Closed',   tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
    case 'error':   return { label: 'Error',    tone: 'bg-slate-100 text-slate-700 ring-slate-200' };
    default:        return { label: result,     tone: 'bg-slate-100 text-slate-700 ring-slate-200' };
  }
}

type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type StatusFilter = 'all' | 'open' | 'closed';

interface ReportFindingsTabProps {
  report: FullReport;
}

export function ReportFindingsTab({ report }: ReportFindingsTabProps) {
  // undefined = "auto-pick the first filtered row"; null = "user closed the panel"; string = explicit selection.
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const lc = search.trim().toLowerCase();
    return report.results.filter((r) => {
      if (severityFilter !== 'all' && r.testCase.severity.toLowerCase() !== severityFilter) return false;
      const status = resultToStatus(r.result).label.toLowerCase();
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (lc && ![r.testCase.name, r.testCase.description, r.testCase.externalId, r.testCase.category].some((s) => s.toLowerCase().includes(lc))) return false;
      return true;
    }).sort((a, b) => {
      const sa = SEVERITY_RANK[a.testCase.severity.toLowerCase()] ?? 0;
      const sb = SEVERITY_RANK[b.testCase.severity.toLowerCase()] ?? 0;
      if (sa !== sb) return sb - sa;
      const rOrder = (r: string) => (r === 'fail' ? 0 : r === 'partial' ? 1 : r === 'error' ? 2 : 3);
      return rOrder(a.result) - rOrder(b.result);
    });
  }, [report.results, severityFilter, statusFilter, search]);

  // Resolve the selection:
  //   - explicit id → that finding (if still visible after filtering)
  //   - selectedId === null → the user closed the panel, show the empty state
  //   - selectedId undefined (initial) → auto-pick the first filtered result
  const selected = useMemo(() => {
    if (selectedId === null) return null;
    if (selectedId === undefined) return filtered[0] ?? null;
    return filtered.find((r) => r.id === selectedId) ?? null;
  }, [filtered, selectedId]);

  // Counts for filter chips
  const counts = useMemo(() => {
    const out = { critical: 0, high: 0, medium: 0, low: 0, open: 0, closed: 0 };
    for (const r of report.results) {
      const sv = r.testCase.severity.toLowerCase() as keyof typeof out;
      if (sv in out) out[sv] += 1;
      const st = resultToStatus(r.result).label.toLowerCase() as keyof typeof out;
      if (st in out) out[st] += 1;
    }
    return out;
  }, [report.results]);

  return (
    <div>
      {/* Filter bar */}
      <Card className="mb-3">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search findings, ids, payloads…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <FilterGroup label="Severity">
            <FilterChip active={severityFilter === 'all'} onClick={() => setSeverityFilter('all')}>All</FilterChip>
            <FilterChip
              active={severityFilter === 'critical'}
              tone="text-red-700 bg-red-50 ring-red-200"
              onClick={() => setSeverityFilter('critical')}
            >Critical <Count>{counts.critical}</Count></FilterChip>
            <FilterChip
              active={severityFilter === 'high'}
              tone="text-orange-700 bg-orange-50 ring-orange-200"
              onClick={() => setSeverityFilter('high')}
            >High <Count>{counts.high}</Count></FilterChip>
            <FilterChip
              active={severityFilter === 'medium'}
              tone="text-amber-800 bg-amber-50 ring-amber-200"
              onClick={() => setSeverityFilter('medium')}
            >Medium <Count>{counts.medium}</Count></FilterChip>
            <FilterChip
              active={severityFilter === 'low'}
              tone="text-blue-700 bg-blue-50 ring-blue-200"
              onClick={() => setSeverityFilter('low')}
            >Low <Count>{counts.low}</Count></FilterChip>
          </FilterGroup>
          <FilterGroup label="Status">
            <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All</FilterChip>
            <FilterChip
              active={statusFilter === 'open'}
              tone="text-red-700 bg-red-50 ring-red-200"
              onClick={() => setStatusFilter('open')}
            >Open <Count>{counts.open}</Count></FilterChip>
            <FilterChip
              active={statusFilter === 'closed'}
              tone="text-emerald-700 bg-emerald-50 ring-emerald-200"
              onClick={() => setStatusFilter('closed')}
            >Closed <Count>{counts.closed}</Count></FilterChip>
          </FilterGroup>
          <div className="ml-auto text-xs text-muted-foreground">
            {filtered.length} of {report.results.length}
          </div>
        </div>
      </Card>

      {/* Split view */}
      <div className="grid gap-3 lg:grid-cols-[420px_1fr]">
        {/* Findings list */}
        <Card className="overflow-hidden">
          <ul className="max-h-[calc(100vh-280px)] overflow-y-auto divide-y divide-border">
            {filtered.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">No findings match the current filters.</li>
            ) : (
              filtered.map((r) => {
                const sevKey = r.testCase.severity.toLowerCase();
                const status = resultToStatus(r.result);
                const active = selected?.id === r.id;
                return (
                  <li
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={[
                      'flex cursor-pointer gap-2.5 px-3 py-3 transition-colors',
                      active ? 'bg-muted/60 border-l-[3px] border-l-primary pl-[9px]' : 'hover:bg-muted/40',
                    ].join(' ')}
                  >
                    <div className={`w-1 flex-shrink-0 rounded ${SEVERITY_BAR[sevKey] ?? SEVERITY_BAR.low}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">{r.testCase.externalId}</span>
                        <span className={`text-[11px] font-bold uppercase tracking-wide ${SEVERITY_TEXT[sevKey] ?? 'text-muted-foreground'}`}>
                          {r.testCase.severity}
                        </span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-foreground">
                        {r.testCase.name}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset ${status.tone}`}>
                          {status.label}
                        </span>
                        <span className="truncate text-[10.5px] text-muted-foreground">{r.testCase.category}</span>
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </Card>

        {/* Detail panel */}
        <Card className="overflow-hidden">
          {selected ? (
            <FindingDetailPanel result={selected} onClose={() => setSelectedId(null)} />
          ) : (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
              Pick a finding to inspect.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({
  active, tone, onClick, children,
}: {
  active: boolean; tone?: string; onClick: () => void; children: React.ReactNode;
}) {
  const cls = active
    ? `${tone ?? 'bg-primary text-primary-foreground ring-primary'} ring-1`
    : 'bg-card text-muted-foreground ring-1 ring-border hover:bg-muted/60';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${cls}`}
    >{children}</button>
  );
}
function Count({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-foreground/10 px-1 text-[10px] font-semibold tabular-nums">{children}</span>;
}

interface FindingDetailPanelProps {
  result: TestResultDetail;
  onClose: () => void;
}
function FindingDetailPanel({ result, onClose }: FindingDetailPanelProps) {
  const sevKey = result.testCase.severity.toLowerCase();
  const status = resultToStatus(result.result);
  const sevTone: Record<string, string> = {
    critical: 'bg-red-50 ring-red-200',
    high:     'bg-orange-50 ring-orange-200',
    medium:   'bg-amber-50 ring-amber-200',
    low:      'bg-blue-50 ring-blue-200',
  };
  const sevIconBg: Record<string, string> = {
    critical: 'bg-red-500',
    high:     'bg-orange-500',
    medium:   'bg-amber-500',
    low:      'bg-blue-500',
  };
  return (
    <div className="flex h-[calc(100vh-280px)] flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-card px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {result.testCase.externalId} · Finding
            </div>
            <h2 className="mt-1 text-lg font-bold leading-tight text-foreground">
              {result.testCase.name}
            </h2>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            title="Close"
            aria-label="Close detail"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={`mt-3 flex items-center gap-3 rounded-md p-2.5 ring-1 ring-inset ${sevTone[sevKey] ?? sevTone.low}`}>
          <div className={`flex h-8 w-8 items-center justify-center rounded-md font-bold text-white ${sevIconBg[sevKey] ?? sevIconBg.low}`}>
            {result.testCase.severity.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Severity</div>
            <div className={`text-sm font-semibold ${SEVERITY_TEXT[sevKey] ?? 'text-foreground'}`}>
              {result.testCase.severity[0].toUpperCase() + result.testCase.severity.slice(1)} · {result.testCase.category}
            </div>
          </div>
          <div className="rounded-md bg-white/60 px-3 py-1 text-right ring-1 ring-inset ring-foreground/10">
            <div className={`text-lg font-bold tabular-nums ${SEVERITY_TEXT[sevKey] ?? 'text-foreground'}`}>
              {(result.confidence * 100).toFixed(0)}%
            </div>
            <div className="text-[10px] text-muted-foreground">Judge confidence</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(['Open', 'Confirmed', 'Re-opened', 'Risk accepted', 'Closed'] as const).map((s) => (
            <span
              key={s}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                s === status.label
                  ? 'border-foreground/20 bg-foreground/5 text-foreground'
                  : 'border-border bg-card text-muted-foreground'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  s === 'Open' ? 'bg-red-500' :
                  s === 'Confirmed' ? 'bg-violet-500' :
                  s === 'Re-opened' ? 'bg-orange-500' :
                  s === 'Risk accepted' ? 'bg-blue-500' :
                  'bg-slate-400'
                }`}
              />
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="space-y-5 px-6 py-5">
        <Section title="Description">
          <p className="text-sm leading-relaxed text-foreground">{result.testCase.description}</p>
        </Section>

        <Section title="Metadata">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border md:grid-cols-4">
            <MetaCell label="Category" value={result.testCase.category} />
            <MetaCell label="Severity" value={result.testCase.severity} />
            <MetaCell label="Result" value={result.result} />
            <MetaCell label="Confidence" value={(result.confidence * 100).toFixed(0) + '%'} />
          </div>
        </Section>

        <Section title="Evidence — attack transcript">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="border-b border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-mono">{result.testCase.externalId}</span> · LLM judge confidence {(result.confidence * 100).toFixed(0)}%
            </div>
            <TranscriptTurn role="Attacker" body={result.testCase.attackPrompt} tone="attacker" />
            <TranscriptTurn role="Agent" body={result.agentResponse} tone={result.result === 'fail' || result.result === 'partial' ? 'fail' : 'agent'} />
            {result.reasoning && (
              <TranscriptTurn role="Judge verdict" body={result.reasoning} tone="judge" />
            )}
          </div>
        </Section>

        {result.exploitationEvidence && (
          <Section title="Exploitation evidence">
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              {result.exploitationEvidence}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function TranscriptTurn({ role, body, tone }: { role: string; body: string; tone: 'attacker' | 'agent' | 'fail' | 'judge' }) {
  const roleTone: Record<string, string> = {
    attacker: 'bg-violet-100 text-violet-800',
    agent:    'bg-indigo-100 text-indigo-700',
    fail:     'bg-red-100 text-red-700',
    judge:    'bg-slate-100 text-slate-700',
  };
  const bgTint = tone === 'fail' ? 'bg-red-50/40 border-l-[3px] border-l-red-500' : '';
  return (
    <div className={`border-b border-border px-4 py-3 last:border-b-0 ${bgTint}`}>
      <div className={`mb-2 inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${roleTone[tone]}`}>
        {role}
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground">{body}</pre>
    </div>
  );
}
