import { FormEvent, Fragment, useEffect, useMemo, useState } from 'react';
import { Brain, Globe, Trash2, Search, BookOpen, ExternalLink, Library, ChevronRight, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError } from '@/lib/api';
import type { AttackPattern, ResearchSnapshot, KnowledgeStats, KnowledgeArticle, KnowledgeArticleCategory } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { SeverityBadge } from '@/components/shared/SeverityBadge';
import { EmptyState } from '@/components/shared/EmptyState';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { formatDate } from '@/lib/utils';

export default function Knowledge() {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [patterns, setPatterns] = useState<AttackPattern[] | null>(null);
  const [research, setResearch] = useState<ResearchSnapshot[] | null>(null);
  const [topic, setTopic] = useState('');
  const [researching, setResearching] = useState(false);
  const [search, setSearch] = useState('');

  // Reference Library state
  const [articles, setArticles] = useState<KnowledgeArticle[] | null>(null);
  const [articleCategories, setArticleCategories] = useState<KnowledgeArticleCategory[]>([]);
  const [articleSearch, setArticleSearch] = useState('');
  const [articleSeverity, setArticleSeverity] = useState<string>('all');
  const [articleCategory, setArticleCategory] = useState<string>('all');
  const [expandedArticleId, setExpandedArticleId] = useState<string | null>(null);

  async function load() {
    try {
      const [s, p, r, cats] = await Promise.all([
        api.get<KnowledgeStats>('/knowledge/stats'),
        api.get<AttackPattern[]>('/knowledge/patterns'),
        api.get<ResearchSnapshot[]>('/knowledge/research'),
        api.get<KnowledgeArticleCategory[]>('/knowledge/articles/categories'),
      ]);
      setStats(s.data);
      setPatterns(p.data);
      setResearch(r.data);
      setArticleCategories(cats.data);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function loadArticles() {
    try {
      const params = new URLSearchParams();
      if (articleSearch.trim()) params.set('q', articleSearch.trim());
      if (articleSeverity !== 'all') params.set('severity', articleSeverity);
      if (articleCategory !== 'all') params.set('category', articleCategory);
      const { data } = await api.get<KnowledgeArticle[]>(`/knowledge/articles?${params}`);
      setArticles(data);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadArticles(), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleSearch, articleSeverity, articleCategory]);

  const filteredPatterns = useMemo(() => {
    if (!patterns) return [];
    if (!search) return patterns;
    const q = search.toLowerCase();
    return patterns.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.pattern.toLowerCase().includes(q),
    );
  }, [patterns, search]);

  if (!stats || !patterns || !research) return <FullPageLoader />;

  async function runResearch(e: FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;
    setResearching(true);
    try {
      await api.post('/knowledge/research', { topic });
      toast.success('Research saved to knowledge base');
      setTopic('');
      await load();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setResearching(false);
    }
  }

  async function removePattern(id: string) {
    if (!confirm('Delete this learned pattern? Future test generation will no longer include it.')) return;
    try {
      await api.delete(`/knowledge/patterns/${id}`);
      await load();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Learned & research"
        description="Patterns Nemesis AI has learned from past tests, plus current threat research."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatsCard
          label="Reference library"
          value={stats.articleCount}
          icon={<Library className="h-5 w-5" />}
          hint="OWASP / MITRE / NIST aligned"
          accent="bg-violet-50 text-violet-600"
        />
        <StatsCard
          label="Learned attack patterns"
          value={stats.patternCount}
          icon={<Brain className="h-5 w-5" />}
          hint={stats.learningEnabled ? 'Learning enabled' : 'Learning disabled'}
          accent={stats.learningEnabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-muted-foreground'}
        />
        <StatsCard
          label="Research snapshots"
          value={stats.researchCount}
          icon={<Globe className="h-5 w-5" />}
          hint={
            stats.researchReady
              ? `Provider: ${stats.researchProvider}`
              : stats.researchEnabled
                ? 'No search provider configured'
                : 'Research disabled'
          }
          accent={stats.researchReady ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-muted-foreground'}
        />
      </div>

      <Tabs defaultValue="patterns" className="mt-6">
        <TabsList>
          <TabsTrigger value="patterns">Learned patterns ({patterns.length})</TabsTrigger>
          <TabsTrigger value="research">Web research ({research.length})</TabsTrigger>
          <TabsTrigger value="library">Reference library ({stats.articleCount})</TabsTrigger>
        </TabsList>
        {/*
          The Reference library tab is a legacy view on Probe rows from the
          curated Nemesis AI catalog. The full catalog lives in
          /security-engine/probes with comprehensive filters; we keep this tab
          as a stable URL for old deep-links.
        */}

        {/* ───── Reference library (curated KB) ───── */}
        <TabsContent value="library">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by id, title, description, category…"
                value={articleSearch}
                onChange={(e) => setArticleSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={articleSeverity} onValueChange={setArticleSeverity}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={articleCategory} onValueChange={setArticleCategory}>
              <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {articleCategories.map((c) => (
                  <SelectItem key={c.category} value={c.category}>
                    {c.category} ({c.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {articles == null ? (
            <Card className="p-6"><p className="text-sm text-muted-foreground">Loading…</p></Card>
          ) : articles.length === 0 ? (
            <EmptyState
              icon={<Library className="h-7 w-7" />}
              title="No matching articles"
              description="Try clearing the filters above."
            />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="w-28">ID</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead className="text-right">CVSS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {articles.map((a) => {
                    const open = expandedArticleId === a.id;
                    return (
                      <ArticleRow
                        key={a.id}
                        article={a}
                        open={open}
                        onToggle={() => setExpandedArticleId(open ? null : a.id)}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* ───── Patterns ───── */}
        <TabsContent value="patterns">
          <div className="mb-3">
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Filter patterns by name, category, or template…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {patterns.length === 0 ? (
            <EmptyState
              icon={<Brain className="h-7 w-7" />}
              title="No learned patterns yet"
              description={
                stats.learningEnabled
                  ? 'Patterns are extracted automatically when test runs surface successful attacks. Run a test to start building the knowledge base.'
                  : 'Enable learning in Settings to start building this knowledge base from your test runs.'
              }
            />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pattern</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead className="text-right">Effectiveness</TableHead>
                    <TableHead className="text-right">Seen</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPatterns.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.applicableContext}</div>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                            Show template
                          </summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-[11px] text-foreground">
                            {p.pattern}
                          </pre>
                          <p className="mt-1 text-xs italic text-muted-foreground">{p.rationale}</p>
                        </details>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {p.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <SeverityBadge severity={p.severity} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(p.effectiveness * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{p.timesSeen}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => removePattern(p.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* ───── Research ───── */}
        <TabsContent value="research">
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">Run ad-hoc research</CardTitle>
              <CardDescription>
                Query the web for current adversarial techniques. Findings are summarised by Claude and cached for
                future test generation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={runResearch} className="flex flex-wrap gap-2">
                <Input
                  placeholder="e.g. recent prompt-injection techniques against customer-support bots"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="min-w-[320px] flex-1"
                  disabled={!stats.researchReady}
                />
                <Button type="submit" disabled={!stats.researchReady || researching || !topic.trim()}>
                  <Globe className="h-4 w-4" />
                  {researching ? 'Researching…' : 'Research'}
                </Button>
              </form>
              {!stats.researchReady && (
                <p className="mt-2 text-xs text-amber-700">
                  Research is disabled or no search provider is configured. Enable it in Settings.
                </p>
              )}
            </CardContent>
          </Card>

          {research.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-7 w-7" />}
              title="No research yet"
              description="Research is auto-triggered for each agent when you run tests with research enabled, or you can run it manually above."
            />
          ) : (
            <div className="space-y-3">
              {research.map((r) => (
                <Card key={r.id}>
                  <CardContent className="space-y-3 pt-6">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">{r.topic}</h3>
                        <div className="text-xs text-muted-foreground">
                          Query: <span className="italic">{r.query}</span> · {formatDate(r.createdAt)}
                        </div>
                      </div>
                      <Badge variant="secondary">{r.findings.length} sources</Badge>
                    </div>
                    <p className="whitespace-pre-line text-sm text-foreground">{r.summary}</p>
                    <div className="border-t border-slate-100 pt-3">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Sources
                      </div>
                      <ul className="space-y-1.5">
                        {r.findings.slice(0, 6).map((f, i) => (
                          <li key={i} className="text-xs">
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline"
                            >
                              [{i + 1}] {f.title || f.url}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <div className="text-muted-foreground">{f.snippet?.slice(0, 220)}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

function ArticleRow({
  article,
  open,
  onToggle,
}: {
  article: KnowledgeArticle;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Fragment>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="text-slate-400">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">{article.externalId}</TableCell>
        <TableCell>
          <div className="font-medium text-foreground">{article.title}</div>
          {article.subcategory && <div className="text-xs text-muted-foreground">{article.subcategory}</div>}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">{article.category}</TableCell>
        <TableCell><SeverityBadge severity={article.severity} /></TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {article.cvssEstimate != null ? article.cvssEstimate.toFixed(1) : '—'}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="!bg-slate-50">
          <TableCell></TableCell>
          <TableCell colSpan={5} className="space-y-3 py-4">
            <p className="text-sm text-foreground">{article.description}</p>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Targets / vector / preconditions */}
              <div className="space-y-2 text-xs">
                <Field label="Targets">
                  {article.targets.length > 0 ? article.targets.map((t) => (
                    <Badge key={t} variant="outline" className="mr-1 font-mono text-[10px]">{t}</Badge>
                  )) : '—'}
                </Field>
                {article.attackVector && <Field label="Attack vector">{article.attackVector}</Field>}
                {article.preconditions && <Field label="Preconditions">{article.preconditions}</Field>}
                {article.frameworks?.owasp_llm_top10_2025 && (
                  <Field label="OWASP">{article.frameworks.owasp_llm_top10_2025}</Field>
                )}
                {article.frameworks?.mitre_atlas?.length ? (
                  <Field label="MITRE ATLAS">{article.frameworks.mitre_atlas.join(', ')}</Field>
                ) : null}
                {article.frameworks?.nist_ai_100_2?.length ? (
                  <Field label="NIST AI 100-2">{article.frameworks.nist_ai_100_2.join(', ')}</Field>
                ) : null}
              </div>
              {/* Behaviour */}
              <div className="space-y-2 text-xs">
                {article.expectedSafeBehavior && (
                  <Field label="Expected safe behaviour" tone="emerald">{article.expectedSafeBehavior}</Field>
                )}
                {article.expectedVulnerableBehavior && (
                  <Field label="Expected vulnerable behaviour" tone="red">{article.expectedVulnerableBehavior}</Field>
                )}
              </div>
            </div>

            {/* Payloads */}
            {article.payloads.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                  Payloads ({article.payloads.length})
                </div>
                <ul className="mt-1 space-y-1">
                  {article.payloads.map((p, i) => (
                    <li key={i}>
                      <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-[11px] text-foreground ring-1 ring-border">
                        {p}
                      </pre>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Variations */}
            {article.variations.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Variations</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-foreground">
                  {article.variations.map((v) => <li key={v}>{v}</li>)}
                </ul>
              </div>
            )}

            {/* Detection signatures */}
            {article.detectionSignatures && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Detection signatures</div>
                <div className="mt-1 grid gap-2 text-[11px] md:grid-cols-2">
                  {article.detectionSignatures.input_regex?.length ? (
                    <SigBlock label="Input regex" items={article.detectionSignatures.input_regex} mono />
                  ) : null}
                  {article.detectionSignatures.output_regex?.length ? (
                    <SigBlock label="Output regex" items={article.detectionSignatures.output_regex} mono />
                  ) : null}
                  {article.detectionSignatures.output_indicators?.length ? (
                    <SigBlock label="Output indicators" items={article.detectionSignatures.output_indicators} />
                  ) : null}
                  {article.detectionSignatures.behavioral && (
                    <SigBlock label="Behavioural" items={[article.detectionSignatures.behavioral]} />
                  )}
                </div>
              </div>
            )}

            {/* Mitigations */}
            {article.mitigations.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Mitigations</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-foreground">
                  {article.mitigations.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </div>
            )}

            {/* References */}
            {article.referenceUrls.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">References</div>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {article.referenceUrls.map((u, i) => (
                    <li key={i}>
                      <a href={u} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline">
                        {u} <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {article.source && (
              <div className="pt-2 text-[10px] text-slate-400">Source: {article.source}</div>
            )}
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

function Field({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: 'emerald' | 'red';
}) {
  const labelTone =
    tone === 'emerald' ? 'text-emerald-700' : tone === 'red' ? 'text-rose-700' : 'text-muted-foreground';
  return (
    <div>
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${labelTone}`}>{label}</div>
      <div className="text-xs text-foreground">{children}</div>
    </div>
  );
}

function SigBlock({ label, items, mono }: { label: string; items: string[]; mono?: boolean }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <ul className="mt-0.5 space-y-0.5 text-foreground">
        {items.map((s, i) => (
          <li key={i} className={mono ? 'font-mono text-[10px]' : 'text-[11px]'}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
