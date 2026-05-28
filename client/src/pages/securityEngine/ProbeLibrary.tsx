import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Search, ShieldAlert, ShieldCheck, Library, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';

interface ComplianceMapping {
  id: string;
  framework: string;
  controlId: string;
  notes: string | null;
}

interface Probe {
  id: string;
  slug: string;
  source: string;
  category: string;
  subcategory: string | null;
  severity: string;
  title: string;
  description: string;
  seedPayload: string;
  expectedFailIndicators: string[];
  expectedPassIndicators: string[];
  applicability: string[];
  defaultDetectorIds: string[];
  defaultStrategies: string[];
  enabled: boolean;
  orgDisabled: boolean;
  complianceMappings: ComplianceMapping[];
}

interface ProbePage {
  probes: Probe[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface Facets {
  sources: string[];
  categories: string[];
  frameworks: string[];
}

const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 ring-red-200',
  high: 'bg-orange-100 text-orange-800 ring-orange-200',
  medium: 'bg-amber-100 text-amber-900 ring-amber-200',
  low: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const SOURCE_ICON: Record<string, typeof ShieldAlert> = {
  cortexview_kb: Library,
  cortexview_curated: ShieldCheck,
  cortexview_learned: ShieldAlert,
};

interface VerticalPack { slug: string; title: string; probeIds: string[] }

const PAGE_SIZE = 50;

export default function ProbeLibrary() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pageData, setPageData] = useState<ProbePage | null>(null);
  const [facets, setFacets] = useState<Facets>({ sources: [], categories: [], frameworks: [] });
  const [verticals, setVerticals] = useState<VerticalPack[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [severity, setSeverity] = useState<string>('all');
  const [source, setSource] = useState<string>('all');
  const [category, setCategory] = useState<string>('all');
  const [framework, setFramework] = useState<string>('all');
  const [verticalSlug, setVerticalSlug] = useState<string>(searchParams.get('vertical') ?? 'all');
  const [selected, setSelected] = useState<Probe | null>(null);
  const [page, setPage] = useState(1);

  // Debounce search input to avoid hitting server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Initial-load: fetch facets + verticals once.
  useEffect(() => {
    (async () => {
      try {
        const [f, v] = await Promise.all([
          api.get<Facets>('/security-engine/probes/facets'),
          api.get<{ verticals: VerticalPack[] }>('/security-engine/verticals'),
        ]);
        setFacets(f.data);
        setVerticals(v.data.verticals);
      } catch (err) {
        toast.error(apiError(err));
      }
    })();
  }, []);

  const verticalProbeIds = useMemo(() => {
    if (verticalSlug === 'all') return null;
    return verticals.find((v) => v.slug === verticalSlug)?.probeIds ?? [];
  }, [verticals, verticalSlug]);

  // Reset to page 1 whenever any filter changes.
  // We deliberately exclude `page` from this effect so paging itself doesn't reset.
  const filterKey = `${debouncedSearch}|${severity}|${source}|${category}|${framework}|${verticalSlug}`;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setPage(1);
  }, [filterKey]);

  // Fetch page whenever filters or page change.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (severity !== 'all') params.set('severity', severity);
    if (source !== 'all') params.set('source', source);
    if (category !== 'all') params.set('category', category);
    if (framework !== 'all') params.set('framework', framework);
    if (verticalProbeIds) {
      if (verticalProbeIds.length === 0) {
        // Empty vertical — show nothing rather than hitting server.
        setPageData({ probes: [], total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 });
        return;
      }
      params.set('probeIds', verticalProbeIds.join(','));
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get<ProbePage>(`/security-engine/probes?${params.toString()}`);
        if (!cancelled) setPageData(data);
      } catch (err) {
        if (!cancelled) toast.error(apiError(err));
      }
    })();
    return () => { cancelled = true; };
  }, [page, debouncedSearch, severity, source, category, framework, verticalProbeIds]);

  // Sync verticalSlug → URL so deep links survive refresh.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (verticalSlug === 'all') next.delete('vertical');
    else next.set('vertical', verticalSlug);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verticalSlug]);

  async function reload() {
    // Re-run the same fetch by bumping the effect via a state nudge.
    setPage((p) => p);
    // simplest: refetch current page
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (severity !== 'all') params.set('severity', severity);
    if (source !== 'all') params.set('source', source);
    if (category !== 'all') params.set('category', category);
    if (framework !== 'all') params.set('framework', framework);
    if (verticalProbeIds && verticalProbeIds.length > 0) params.set('probeIds', verticalProbeIds.join(','));
    try {
      const { data } = await api.get<ProbePage>(`/security-engine/probes?${params.toString()}`);
      setPageData(data);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  if (!pageData) return <FullPageLoader />;

  const { probes, total, totalPages } = pageData;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <PageHeader
        title="Probe library"
        description={`${total.toLocaleString()} adversarial probes in the Nemesis AI catalog. Filter, inspect, and disable per-org.`}
      />

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search title, description, slug…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {facets.sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {facets.categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Framework:</span>
            <Button size="sm" variant={framework === 'all' ? 'default' : 'outline'} onClick={() => setFramework('all')}>
              All
            </Button>
            {facets.frameworks.map((fw) => (
              <Button key={fw} size="sm" variant={framework === fw ? 'default' : 'outline'} onClick={() => setFramework(fw)}>
                {fw.replaceAll('_', ' ')}
              </Button>
            ))}
            <span className="ml-auto text-muted-foreground tabular-nums">
              {total === 0 ? '0 probes' : `${from}–${to} of ${total.toLocaleString()}`}
            </span>
          </div>
          {verticals.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Vertical pack:</span>
              <Button size="sm" variant={verticalSlug === 'all' ? 'default' : 'outline'} onClick={() => setVerticalSlug('all')}>
                Any
              </Button>
              {verticals.map((v) => (
                <Button
                  key={v.slug} size="sm"
                  variant={verticalSlug === v.slug ? 'default' : 'outline'}
                  onClick={() => setVerticalSlug(v.slug)}
                >
                  {v.title}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          {probes.map((p) => {
            const Icon = SOURCE_ICON[p.source] ?? ShieldCheck;
            return (
              <Card
                key={p.id}
                className={`cursor-pointer transition-colors hover:border-indigo-300 ${selected?.id === p.id ? 'border-indigo-500 ring-1 ring-indigo-500' : ''}`}
                onClick={() => setSelected(p)}
              >
                <CardContent className="flex items-start gap-3 pt-5">
                  <Icon className="mt-0.5 h-5 w-5 text-indigo-600" />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{p.title}</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ring-1 ${SEVERITY_TONE[p.severity] ?? SEVERITY_TONE.low}`}>
                        {p.severity}
                      </span>
                      <Badge variant="outline" className="text-xs">{p.source}</Badge>
                      <Badge variant="outline" className="text-xs">{p.category}</Badge>
                      {p.orgDisabled && <Badge className="bg-slate-200 text-slate-700">disabled</Badge>}
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!p.orgDisabled && !window.confirm(`Disable "${p.title}" for this organisation?\nFuture test runs will no longer include it.`)) return;
                          try {
                            await api.put(`/security-engine/probes/${p.id}/toggle`, { disabled: !p.orgDisabled });
                            await reload();
                            toast.success(p.orgDisabled ? 'Probe enabled for this org' : 'Probe disabled for this org');
                          } catch (err) { toast.error(apiError(err)); }
                        }}
                        className="ml-auto rounded border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-indigo-300 hover:text-indigo-600"
                      >
                        {p.orgDisabled ? 'Enable' : 'Disable'}
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.applicability.map((a) => (
                        <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>
                      ))}
                      {p.complianceMappings.slice(0, 4).map((m) => (
                        <Badge key={m.id} className="bg-indigo-50 text-indigo-700 text-[10px]">
                          {m.framework}: {m.controlId}
                        </Badge>
                      ))}
                      {p.complianceMappings.length > 4 && (
                        <Badge variant="outline" className="text-[10px]">+{p.complianceMappings.length - 4} more</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {probes.length === 0 && (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No probes match those filters.</CardContent></Card>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="mr-1 h-3 w-3" /> Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next <ChevronRight className="ml-1 h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{selected?.title ?? 'Select a probe'}</CardTitle>
              <CardDescription className="break-all font-mono text-xs">{selected?.slug ?? '—'}</CardDescription>
            </CardHeader>
            <CardContent>
              {selected ? (
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="mb-1 font-medium text-foreground">Seed payload</div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-xs">
                      {selected.seedPayload}
                    </pre>
                  </div>
                  {selected.expectedFailIndicators.length > 0 && (
                    <div>
                      <div className="mb-1 font-medium text-red-700">Expected FAIL indicators</div>
                      <div className="flex flex-wrap gap-1">
                        {selected.expectedFailIndicators.map((s) => (
                          <Badge key={s} className="bg-red-50 text-red-700 text-[10px]">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.expectedPassIndicators.length > 0 && (
                    <div>
                      <div className="mb-1 font-medium text-green-700">Expected PASS indicators</div>
                      <div className="flex flex-wrap gap-1">
                        {selected.expectedPassIndicators.map((s) => (
                          <Badge key={s} className="bg-green-50 text-green-700 text-[10px]">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.defaultDetectorIds.length > 0 && (
                    <div>
                      <div className="mb-1 font-medium text-foreground">Default detectors</div>
                      <div className="flex flex-wrap gap-1">
                        {selected.defaultDetectorIds.map((d) => (
                          <Badge key={d} variant="outline" className="text-[10px] font-mono">{d}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.defaultStrategies.length > 0 && (
                    <div>
                      <div className="mb-1 font-medium text-foreground">Default strategies</div>
                      <div className="flex flex-wrap gap-1">
                        {selected.defaultStrategies.map((d) => (
                          <Badge key={d} variant="outline" className="text-[10px] font-mono">{d}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.complianceMappings.length > 0 && (
                    <div>
                      <div className="mb-1 font-medium text-foreground">Compliance</div>
                      <div className="space-y-1">
                        {selected.complianceMappings.map((m) => (
                          <div key={m.id} className="flex items-baseline gap-2 text-xs">
                            <span className="font-mono text-indigo-700">{m.framework}</span>
                            <span className="text-foreground">{m.controlId}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Click any probe on the left to inspect its payload, indicators, detectors, strategies, and compliance mappings.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
