import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Layers, ChevronRight, ExternalLink } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FullPageLoader } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';

interface VerticalPack {
  id: string;
  slug: string;
  title: string;
  description: string;
  recommendedStrategies: string[];
  probes: { id: string; slug: string; title: string; severity: string; category: string }[];
}

const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 ring-red-200',
  high: 'bg-orange-100 text-orange-800 ring-orange-200',
  medium: 'bg-amber-100 text-amber-900 ring-amber-200',
  low: 'bg-slate-100 text-slate-700 ring-slate-200',
};

export default function Verticals() {
  const [packs, setPacks] = useState<VerticalPack[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const { data } = await api.get<{ verticals: VerticalPack[] }>('/security-engine/verticals');
      setPacks(data.verticals);
    } catch (err) { const m = apiError(err); setLoadError(m); toast.error(m); }
  }
  useEffect(() => { void load(); }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} full />;
  if (!packs) return <FullPageLoader />;

  return (
    <>
      <PageHeader
        title="Vertical packs"
        description="Curated probe bundles for industry / scenario coverage. Use these to seed test suites scoped to a specific deployment context."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {packs.map((pack) => {
          const isOpen = expanded === pack.slug;
          return (
            <Card
              key={pack.id}
              className={`transition-shadow ${isOpen ? 'shadow-md ring-1 ring-indigo-200' : ''}`}
            >
              <CardHeader
                className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : pack.slug)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpanded(isOpen ? null : pack.slug);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Layers className="h-4 w-4 text-indigo-600" /> {pack.title}
                    </CardTitle>
                    <CardDescription className="mt-1">{pack.description}</CardDescription>
                  </div>
                  <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="font-mono text-[10px]">{pack.slug}</Badge>
                  <span className="text-muted-foreground">{pack.probes.length} probes</span>
                  {pack.recommendedStrategies.length > 0 && (
                    <span className="text-muted-foreground">· {pack.recommendedStrategies.length} recommended strategies</span>
                  )}
                </div>
              </CardHeader>
              {isOpen && (
                <CardContent className="space-y-3 border-t pt-4">
                  {pack.recommendedStrategies.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-medium text-foreground">Recommended strategy chain</div>
                      <div className="flex flex-wrap gap-1">
                        {pack.recommendedStrategies.map((s) => (
                          <Badge key={s} variant="outline" className="font-mono text-[10px]">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="mb-1 text-xs font-medium text-foreground">Included probes</div>
                    <div className="space-y-1">
                      {pack.probes.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 rounded border p-2 text-xs">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-[10px] text-muted-foreground">{p.slug}</div>
                            <div className="truncate font-medium text-foreground">{p.title}</div>
                          </div>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ${SEVERITY_TONE[p.severity] ?? SEVERITY_TONE.low}`}>
                            {p.severity}
                          </span>
                          <Badge variant="outline" className="text-[10px]">{p.category}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <Link
                      to={`/agents?verticalPack=${pack.slug}`}
                      className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      Use this pack on a new run
                    </Link>
                    <Link
                      to={`/security-engine/probes?vertical=${pack.slug}`}
                      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                    >
                      View probes in library <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
